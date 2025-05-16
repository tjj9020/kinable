import { BaseAIModelProvider } from './BaseAIModelProvider';
import {
  AIModelRequest,
  AIModelResult,
  AIModelSuccess,
  ProviderLimits,
  TokenUsage,
  AIModelError
} from '@kinable/common-types';
import { ModelConfig, ProviderConfig } from '@kinable/common-types';
import OpenAI from 'openai';
import { SecretsManagerClient, GetSecretValueCommand, GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import { IDatabaseProvider } from '@kinable/common-types';
import { standardizeError as sharedStandardizeError } from './standardizeError';

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
  private openaiClient: OpenAI;
  private clientProvided: boolean;

  private secretsManagerClient: SecretsManagerClient;
  private secretId: string;
  private awsRegion: string;
  private keysLoaded: boolean = false;
  private keyFetchPromise: Promise<void> | null = null;
  // @ts-ignore - Keep for future config needs
  private dbProviderForConfig: IDatabaseProvider;
  private providerConfig: ProviderConfig;
  
  /**
   * Create a new OpenAI provider.
   * API keys are fetched from AWS Secrets Manager on demand if no client is provided.
   * @param secretId The ID or ARN of the secret in AWS Secrets Manager.
   * @param awsRegion The AWS region for the Secrets Manager client.
   * @param dbProvider This dbProvider is for config/secrets, not Base's (now removed) circuit breaker
   * @param defaultModel The default model identifier to use for this provider.
   * @param providerConfig The provider configuration.
   * @param openAIClientInstance Optional pre-configured OpenAI client instance for testing or specific use cases.
   */
  constructor(
    secretId: string, 
    awsRegion: string, 
    dbProvider: IDatabaseProvider, // This dbProvider is for config/secrets, not Base's (now removed) circuit breaker
    defaultModel: string = "gpt-4o", // Default to a known model
    providerConfig: ProviderConfig, // Added providerConfig
    openAIClientInstance?: OpenAI
  ) {
    super("openai", defaultModel, providerConfig); // Pass providerConfig to super
    this.secretId = secretId;
    this.awsRegion = awsRegion;
    this.secretsManagerClient = new SecretsManagerClient({ region: this.awsRegion });
    this.dbProviderForConfig = dbProvider; // Store for its own needs
    this.providerConfig = providerConfig;

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
  protected async _generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    try {
      await this._ensureApiKeysLoaded();
    } catch (keyLoadError: any) {
      return this.createError(
        'AUTH',
        `Failed to load API credentials: ${keyLoadError.message || keyLoadError}`,
        500, // status
        false
      );
    }

    if (!this.openaiClient || (!this.clientProvided && !this.currentApiKey)) {
      return this.createError('AUTH', 'OpenAI client not initialized due to missing API key or client not provided.', 500, false);
    }

    // Token consumption and canFulfill checks are now handled by the public generateResponse in BaseAIModelProvider.
    // This method should focus on the actual API call.

    const model = request.preferredModel || this.defaultModel; // Use this.defaultModel from base
    const startTime = Date.now(); // Define startTime here to calculate latency for the API call
    
    // Define a helper function to create request parameters
    const createChatCompletionParams = (currentRequest: AIModelRequest, currentModel: string): OpenAI.Chat.Completions.ChatCompletionCreateParams => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      // Add system message first, if present in history
      const systemMessage = currentRequest.context.history?.find(m => m.role === 'system');
      if (systemMessage) {
        messages.push({ role: 'system', content: systemMessage.content });
      }

      // Add other user/assistant messages from history, filtering out any additional system messages
      currentRequest.context.history?.forEach(histMsg => {
        if (histMsg.role === 'user' || histMsg.role === 'assistant') {
          messages.push({ role: histMsg.role, content: histMsg.content });
        }
      });

      // Add current user prompt as the last message
      messages.push({ role: 'user', content: currentRequest.prompt });
      
      return {
        model: currentModel,
        messages: messages,
        max_tokens: currentRequest.maxTokens,
        temperature: currentRequest.temperature,
        // stream: currentRequest.streaming // TODO: Enable once streaming flag is confirmed and full streaming is implemented
      };
    };

    let completionRequestParams = createChatCompletionParams(request, model);

    try {
      const response = await this.openaiClient.chat.completions.create(completionRequestParams) as OpenAI.Chat.Completions.ChatCompletion;
      const endTime = Date.now(); // Define endTime
      const latency = endTime - startTime; // Calculate latency
      
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
          features: this.getModelCapabilities(model).functionCallingSupport ? ['function_calling'] : [],
          region: request.context.region,
          latency,
          timestamp: endTime 
        }
      };
      return result;
    } catch (error: any) {
      console.error(`[OpenAIModelProvider] Error calling OpenAI API (model: ${model}):`, error);
      if (error instanceof OpenAI.APIError) {
        return this.standardizeError(error);
      } else if (error.code === 'ECONNABORTED' || (error.message && error.message.toLowerCase().includes('timeout'))) {
        return this.standardizeError(error);
      }
      return this.createError(
        'UNKNOWN',
        `Unhandled error in OpenAI provider: ${error.message || error}`,
        error.status || 500,
        true 
      );
    }
  }

  /**
   * Get the capabilities of a specific OpenAI model
   */
  getModelCapabilities(modelName: string): ModelConfig {
    const modelCfg = this.providerConfig.models[modelName];
    if (!modelCfg) {
      console.error(`[${this.providerName}] Model configuration for "${modelName}" not found.`);
      throw new Error(`[${this.providerName}] Model configuration for "${modelName}" not found.`);
    }
    return modelCfg;
  }
  
  /**
   * Get the rate limits for OpenAI
   */
  getProviderLimits(): ProviderLimits {
    const defaultLimits: ProviderLimits = { rpm: 20, tpm: 80000 }; 
    if (this.configForProvider.rateLimits) {
      return {
        rpm: this.configForProvider.rateLimits.rpm ?? defaultLimits.rpm,
        tpm: this.configForProvider.rateLimits.tpm ?? defaultLimits.tpm,
      };
    }
    return defaultLimits;
  }
  
  /**
   * Get the default model for OpenAI
   */
  protected getDefaultModel(): string {
    return this.defaultModel;
  }
  
  /**
   * Standardizes an error from this provider into the common AIModelError format.
   * This method implements the abstract method from BaseAIModelProvider.
   * @param error The error object from the provider.
   * @returns An AIModelError object.
   */
  protected standardizeError(error: any): AIModelError {
    return sharedStandardizeError(error, this.providerName);
  }
}
