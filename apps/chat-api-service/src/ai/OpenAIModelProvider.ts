import { BaseAIModelProvider } from './BaseAIModelProvider';
import {
  AIModelRequest,
  AIModelResult,
  AIModelSuccess,
  ModelCapabilities,
  ProviderLimits,
  TokenUsage
} from '../../../../packages/common-types/src/ai-interfaces';
import OpenAI from 'openai';
import { SecretsManagerClient, GetSecretValueCommand, GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';

interface ApiKeys {
  current: string;
  previous?: string;
}

// Use a simple stub for the OpenAI SDK - in production would use the actual OpenAI SDK
// interface OpenAICompletionResponse { // This interface will be replaced by OpenAI.Chat.Completions.ChatCompletion
//   choices: {
//     message: {
//       content: string;
//     };
//     finish_reason: string;
//   }[];
//   usage: {
//     prompt_tokens: number;
//     completion_tokens: number;
//     total_tokens: number;
//   };
//   model: string;
// }

/**
 * Implementation of the AI model provider interface for OpenAI
 */
export class OpenAIModelProvider extends BaseAIModelProvider {
  private currentApiKey?: string;
  private previousApiKey?: string | null = null;
  private openaiClient: OpenAI;
  private clientProvided: boolean;

  private secretsManagerClient: SecretsManagerClient;
  private secretId: string;
  private awsClientRegion: string;
  private keysLoaded: boolean = false;
  private keyFetchPromise: Promise<void> | null = null;
  
  /**
   * Create a new OpenAI provider.
   * API keys are fetched from AWS Secrets Manager on demand if no client is provided.
   * @param secretId The ID or ARN of the secret in AWS Secrets Manager.
   * @param awsClientRegion The AWS region for the Secrets Manager client.
   * @param openAIClientInstance Optional pre-configured OpenAI client instance for testing or specific use cases.
   */
  constructor(secretId: string, awsClientRegion: string, openAIClientInstance?: OpenAI) {
    super('openai');
    this.secretId = secretId;
    this.awsClientRegion = awsClientRegion;
    this.secretsManagerClient = new SecretsManagerClient({ region: this.awsClientRegion });

    if (openAIClientInstance) {
      this.openaiClient = openAIClientInstance;
      this.clientProvided = true;
      this.keysLoaded = true; // Assume keys are effectively loaded if client is provided
    } else {
      // @ts-expect-error - openaiClient will be initialized by _ensureApiKeysLoaded
      this.openaiClient = undefined; // Needs to be initialized later
      this.clientProvided = false;
    }
  }

  private async _fetchAndParseApiKeys(): Promise<void> {
    try {
      const commandOutput: GetSecretValueCommandOutput = await this.secretsManagerClient.send(
        new GetSecretValueCommand({ SecretId: this.secretId })
      );

      if (commandOutput.SecretString) {
        const secretJson = JSON.parse(commandOutput.SecretString) as ApiKeys;
        if (secretJson.current) {
          this.currentApiKey = secretJson.current;
          this.previousApiKey = secretJson.previous || null;
          return; // Successfully fetched and parsed
        } else {
          throw new Error('Fetched secret does not contain a "current" API key.');
        }
      } else {
        throw new Error('SecretString is empty or not found in Secrets Manager response.');
      }
    } catch (error: any) {
      console.error(`Failed to fetch or parse API keys from Secrets Manager (secretId: ${this.secretId}):`, error);
      // Augment the error or re-throw a more specific error if needed
      throw new Error(`Failed to load API keys from Secrets Manager: ${error.message || error}`);
    }
  }

  private async _ensureApiKeysLoaded(): Promise<void> {
    if (this.clientProvided) { // If client was provided, keys are considered loaded
      return;
    }

    if (this.keysLoaded) {
      return;
    }

    if (this.keyFetchPromise) {
      await this.keyFetchPromise;
      return;
    }

    this.keyFetchPromise = (async () => {
      try {
        await this._fetchAndParseApiKeys();
        if (!this.currentApiKey) {
          throw new Error('Current API key is missing after fetch attempt.');
        }
        this.openaiClient = new OpenAI({ apiKey: this.currentApiKey });
        this.keysLoaded = true;
      } catch (error) {
        this.keysLoaded = false; // Ensure keysLoaded is false if fetching fails
        // @ts-expect-error - Client is intentionally undefined if key loading fails
        this.openaiClient = undefined; // Ensure client is not set if keys are not loaded
        console.error('Error ensuring API keys are loaded:', error);
        throw error; // Re-throw to be caught by generateResponse
      } finally {
        this.keyFetchPromise = null;
      }
    })();

    await this.keyFetchPromise;
  }
  
  /**
   * Generate a response using OpenAI API
   */
  async generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    try {
      await this._ensureApiKeysLoaded();
    } catch (keyLoadError: any) {
      return this.createError(
        'AUTH',
        `Failed to load API credentials: ${keyLoadError.message || keyLoadError}`,
        500, // Internal server error type for credential loading failure
        false // Not retryable at this stage from the caller's perspective
      );
    }

    if (!this.openaiClient || (!this.clientProvided && !this.currentApiKey)) {
       // This should ideally be caught by _ensureApiKeysLoaded, but as a safeguard:
      return this.createError('AUTH', 'OpenAI client not initialized due to missing API key or client not provided.', 500, false);
    }

    // Check if we can fulfill this request
    if (!this.canFulfill(request)) {
      return this.createError(
        'CAPABILITY',
        'This provider cannot fulfill the request with the required capabilities',
        400,
        false
      );
    }
    
    // Check token bucket
    const estimatedTokens = this.estimateTokens(request);
    if (!this.consumeTokens(estimatedTokens)) {
      return this.createError(
        'RATE_LIMIT',
        'Rate limit exceeded for this provider',
        429,
        true
      );
    }
    
    const model = request.preferredModel || this.getDefaultModel();
    const startTime = Date.now();
    
    // Define a helper function to create request parameters
    // This ensures it can be called consistently for initial attempt and retry
    const createChatCompletionParams = (currentRequest: AIModelRequest, currentModel: string): OpenAI.Chat.Completions.ChatCompletionCreateParams => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'user', content: currentRequest.prompt }
        // TODO: Add support for conversation history if available in AIModelRequest
      ];
      return {
        model: currentModel,
        messages: messages,
        max_tokens: currentRequest.maxTokens,
        temperature: currentRequest.temperature,
        // stream: currentRequest.streaming // TODO: Enable once streaming flag is confirmed in AIModelRequest and full streaming is implemented
      };
    };

    // Declare completionRequestParams here for the first attempt
    let completionRequestParams = createChatCompletionParams(request, model);

    try {
      const response = await this.openaiClient.chat.completions.create(completionRequestParams) as OpenAI.Chat.Completions.ChatCompletion;

      const endTime = Date.now();
      const latency = endTime - startTime;
      
      // Update health metrics
      this.updateHealthMetrics(true, latency);
      
      if (!response.choices || response.choices.length === 0 || !response.choices[0].message || !response.choices[0].message.content) {
        return this.createError('UNKNOWN', 'OpenAI response format error: No content.', 500, true);
      }
      if (!response.usage) {
        return this.createError('UNKNOWN', 'OpenAI response format error: No usage data.', 500, true);
      }

      // Convert to our standard response format
      const tokenUsage: TokenUsage = {
        prompt: response.usage.prompt_tokens,
        completion: response.usage.completion_tokens,
        total: response.usage.total_tokens
      };
      
      const result: AIModelSuccess = {
        ok: true,
        text: response.choices[0].message.content,
        tokens: tokenUsage,
        meta: {
          provider: this.providerName,
          model: response.model,
          features: this.getModelCapabilities(model).functionCalling ? ['function_calling'] : [], // This should adapt based on actual features used/requested
          region: request.context.region,
          latency,
          timestamp: endTime
        }
        // stream: undefined // TODO: Add stream if streaming response
      };
      
      return result;
    } catch (error: unknown) {
      const endTime = Date.now();
      const latency = endTime - startTime;
      
      // Update health metrics
      this.updateHealthMetrics(false, latency);
      
      // Handle specific OpenAI errors
      // In a real implementation, we would parse the error from the OpenAI SDK
      // Need to check the error type before accessing properties like status
      // let errorStatus = 500; // Default to 500 for unknown errors
      // let errorMessage = 'Unknown error';
      // if (typeof error === 'object' && error !== null) {
      //   // Basic check if it looks like an error object with status/message
      //   if ('status' in error && typeof error.status === 'number') {
      //     errorStatus = error.status;
      //   }
      //   if ('message' in error && typeof error.message === 'string') {
      //     errorMessage = error.message;
      //   }
      // } else if (typeof error === 'string') {
      //   errorMessage = error;
      // }

      if (error instanceof OpenAI.APIError) {
        const errorStatus = error.status || 500;
        const errorMessage = error.message || 'Unknown OpenAI API Error';
        const errorCode = error.code;

        if (errorStatus === 401) { // Authentication error
         // Try with previous key if available
          if (this.previousApiKey && this.currentApiKey !== this.previousApiKey) {
            console.warn('OpenAI API key authentication failed. Attempting to switch to previous key.');
            this.currentApiKey = this.previousApiKey;
            this.previousApiKey = null; // Only try previous key once
            this.openaiClient = new OpenAI({ apiKey: this.currentApiKey }); // Re-initialize client with new key
            
            // Retry the request with the new (previous) key
            // Re-create params as the request object might have been mutated or for clarity
            completionRequestParams = createChatCompletionParams(request, model); 
            const retryResponse = await this.openaiClient.chat.completions.create(completionRequestParams)  as OpenAI.Chat.Completions.ChatCompletion;
            
            // If retry is successful, update health and return result
            const retryEndTime = Date.now();
            const retryLatency = retryEndTime - startTime; // Recalculate latency for this attempt
            this.updateHealthMetrics(true, retryLatency);

            if (!retryResponse.choices || retryResponse.choices.length === 0 || !retryResponse.choices[0].message || !retryResponse.choices[0].message.content) {
              return this.createError('UNKNOWN', 'OpenAI retry response format error: No content.', 500, true);
            }
            if (!retryResponse.usage) {
              return this.createError('UNKNOWN', 'OpenAI retry response format error: No usage data.', 500, true);
            }

            const retryTokenUsage: TokenUsage = {
              prompt: retryResponse.usage.prompt_tokens,
              completion: retryResponse.usage.completion_tokens,
              total: retryResponse.usage.total_tokens
            };
      
            const retryResult: AIModelSuccess = {
              ok: true,
              text: retryResponse.choices[0].message.content,
              tokens: retryTokenUsage,
              meta: {
                provider: this.providerName,
                model: retryResponse.model,
                features: this.getModelCapabilities(model).functionCalling ? ['function_calling'] : [],
                region: request.context.region,
                latency: retryLatency,
                timestamp: retryEndTime
              }
            };
            console.log('Successfully used previous OpenAI API key.');
            return retryResult;

          }
          return this.createError('AUTH', `OpenAI Authentication Failed: ${errorMessage}`, 401, false);
        }

        if (errorStatus === 429 || errorCode === 'rate_limit_exceeded') { // Rate limit error
          return this.createError('RATE_LIMIT', `OpenAI Rate Limit Exceeded: ${errorMessage}`, 429, true);
        }

        if (errorStatus === 400 || errorCode === 'invalid_request_error') { // Bad request (e.g. content policy, bad input)
          // OpenAI uses 400 for content policy violations too.
          // Example: error.code === 'content_policy_violation'
          if (errorCode === 'content_policy_violation') {
             return this.createError('CONTENT', `OpenAI Content Policy Violation: ${errorMessage}`, 400, false);
          }
          return this.createError('CAPABILITY', `OpenAI Invalid Request: ${errorMessage}`, 400, false); // Or 'UNKNOWN' or 'CONTENT' depending on specifics
        }
        
        // Default to UNKNOWN for other OpenAI API errors
        return this.createError('UNKNOWN', `OpenAI API Error: ${errorMessage} (Status: ${errorStatus}, Code: ${errorCode})`, errorStatus, errorStatus >= 500);

      } else if (error instanceof Error) { // Handle generic JS errors
        return this.createError('UNKNOWN', `Unexpected error: ${error.message}`, 500, true);
      }

      // For all other errors
      return this.createError(
        'UNKNOWN',
        `OpenAI error: ${error instanceof Error ? error.message : String(error)}`,
        500, // Default status for truly unknown non-API errors
        true // Retry unknown server-side issues
      );
    }
  }
  
  /**
   * Get the capabilities of a specific OpenAI model
   */
  getModelCapabilities(modelName: string): ModelCapabilities {
    // In a real implementation, this would be driven by configuration
    switch (modelName) {
      case 'gpt-4o':
        return {
          reasoning: 5,
          creativity: 5,
          coding: 5,
          retrieval: false,
          functionCalling: true,
          contextSize: 128000,
          streamingSupport: true
        };
      case 'gpt-4':
        return {
          reasoning: 5,
          creativity: 4,
          coding: 4,
          retrieval: false,
          functionCalling: true,
          contextSize: 8192,
          streamingSupport: true
        };
      case 'gpt-3.5-turbo':
        return {
          reasoning: 3,
          creativity: 3,
          coding: 3,
          retrieval: false,
          functionCalling: true,
          contextSize: 4096,
          streamingSupport: true
        };
      default:
        // Return an empty object or a capabilities object indicating no specific capabilities
        // for unknown models. This helps canFulfill correctly identify unsupported models.
        return {} as ModelCapabilities; 
    }
  }
  
  /**
   * Get the rate limits for OpenAI
   */
  getProviderLimits(): ProviderLimits {
    // In a real implementation, this would be driven by configuration
    return {
      rpm: 20,
      tpm: 80000
    };
  }
  
  /**
   * Get the default model for OpenAI
   */
  protected getDefaultModel(): string {
    return 'gpt-3.5-turbo';
  }
  
  /**
   * Estimate tokens for OpenAI models
   * This is a very basic estimation, real implementation would use a tokenizer like tiktoken
   */
  // protected estimateTokens(request: AIModelRequest): number {
  //   // Rough estimate: 1 token per 4 characters for English text
  //   return Math.ceil((request.prompt.length / 4) + (request.maxTokens || 256));
  // }

  /**
   * Simulate a call to OpenAI API - This method will be removed
   */
  // private async callOpenAI(request: AIModelRequest, model: string): Promise<OpenAICompletionResponse> {
  //   // Simulate API call delay
  //   await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

  //   // Simulate potential errors based on request
  //   if (request.prompt.includes("error_auth")) {
  //     const error: any = new Error("Simulated OpenAI Auth Error");
  //     error.status = 401;
  //     throw error;
  //   }
  //   if (request.prompt.includes("error_rate_limit")) {
  //     const error: any = new Error("Simulated OpenAI Rate Limit Error");
  //     error.status = 429;
  //     throw error;
  //   }
  //   if (request.prompt.includes("error_content")) {
  //     const error: any = new Error("Simulated OpenAI Content Filter Error");
  //     error.status = 400;
  //     throw error;
  //   }
  //   if (request.prompt.includes("error_server")) {
  //     const error: any = new Error("Simulated OpenAI Server Error");
  //     error.status = 500;
  //     throw error;
  //   }
    
  //   // Simulate a successful response
  //   const completionText = `Mocked OpenAI response for model ${model} to prompt: "${request.prompt}"`;
  //   const promptTokens = Math.ceil(request.prompt.length / 4); // Rough estimate
  //   const completionTokens = Math.ceil(completionText.length / 4); // Rough estimate

  //   return {
  //     choices: [
  //       {
  //         message: {
  //           content: completionText,
  //         },
  //         finish_reason: "stop",
  //       },
  //     ],
  //     usage: {
  //       prompt_tokens: promptTokens,
  //       completion_tokens: completionTokens,
  //       total_tokens: promptTokens + completionTokens,
  //     },
  //     model: model,
  //   };
  // }
} 