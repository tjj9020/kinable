import { SecretsManagerClient, GetSecretValueCommand, GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import Anthropic from '@anthropic-ai/sdk'; // Official Anthropic SDK
import { BaseAIModelProvider } from './BaseAIModelProvider';
import {
  IAIModelProvider,
  AIModelRequest,
  AIModelResult,
  ModelCapabilities,
  ProviderHealthStatus,
  AIModelError,
  AIModelSuccess,
  ProviderLimits,
  TokenUsage
} from '../../../../packages/common-types/src/ai-interfaces';
import { ProviderConfig } from '../../../../packages/common-types/src/config-schema';

const ANTHROPIC_PROVIDER_ID = 'anthropic';

interface ApiKeys { // Define a simple interface for the expected secret structure
  current: string;
  previous?: string; // Optional, though Anthropic provider might only use current
}

export class AnthropicModelProvider extends BaseAIModelProvider {
  private secretId: string;
  private awsClientRegion: string;
  private providerConfig: ProviderConfig | null = null;
  private secretsManagerClient: SecretsManagerClient; // Add SecretsManagerClient instance
  private currentApiKey?: string;
  private previousApiKey?: string | null = null;
  private anthropicClient!: Anthropic; // Definite assignment assertion if _ensureApiKeysLoaded guarantees it or throws
  private clientProvided: boolean; // If an Anthropic client is injected directly
  private keysLoaded: boolean = false;
  private keyFetchPromise: Promise<void> | null = null;

  constructor(secretId: string, awsClientRegion: string, anthropicClientInstance?: Anthropic) {
    super(ANTHROPIC_PROVIDER_ID);
    this.secretId = secretId;
    this.awsClientRegion = awsClientRegion;
    this.secretsManagerClient = new SecretsManagerClient({ region: this.awsClientRegion }); // Initialize client
    if (anthropicClientInstance) {
      this.anthropicClient = anthropicClientInstance;
      this.clientProvided = true;
      this.keysLoaded = true; 
    } else {
      // @ts-expect-error - anthropicClient will be initialized by _ensureApiKeysLoaded
      this.anthropicClient = undefined; 
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
          return;
        } else {
          throw new Error('Fetched secret does not contain a "current" API key.');
        }
      } else {
        throw new Error('SecretString is empty or not found in Secrets Manager response.');
      }
    } catch (error: any) {
      console.error(`Failed to fetch or parse API keys from Secrets Manager (secretId: ${this.secretId}):`, error);
      throw new Error(`Failed to load API keys from Secrets Manager: ${error.message || error}`);
    }
  }

  private async _ensureApiKeysLoaded(): Promise<void> {
    if (this.clientProvided) {
      if (!this.anthropicClient) throw new Error('[AnthropicModelProvider] Client was marked as provided, but is missing.');
      return;
    }
    if (this.keysLoaded && this.anthropicClient) {
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
        // Initialize Anthropic client with the fetched API key
        this.anthropicClient = new Anthropic({ apiKey: this.currentApiKey });
        this.keysLoaded = true;
      } catch (error) {
        this.keysLoaded = false;
        // @ts-expect-error - Client is intentionally undefined if key loading fails
        this.anthropicClient = undefined;
        console.error('Error ensuring Anthropic API keys are loaded:', error);
        throw error;
      } finally {
        this.keyFetchPromise = null;
      }
    })();
    await this.keyFetchPromise;
  }

  public setProviderConfig(providerConfig: ProviderConfig): void {
    this.providerConfig = providerConfig;
  }

  public async generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    try {
      await this._ensureApiKeysLoaded();
    } catch (keyLoadError: any) {
      return this.createError(
        'AUTH',
        `[AnthropicModelProvider] Failed to initialize client or load API credentials: ${keyLoadError.message || keyLoadError}`,
        500,
        false 
      );
    }
    
    if (!this.anthropicClient) {
        return this.createError('AUTH', '[AnthropicModelProvider] Client not initialized despite key loading attempt.', 500, false);
    }

    if (!this.healthStatus.available) {
        return this.createError('UNKNOWN', `[AnthropicModelProvider] Provider not available. ErrorRate: ${this.healthStatus.errorRate.toFixed(2)}, LastCheck: ${new Date(this.healthStatus.lastChecked).toISOString()}`, undefined, false);
    }

    if (!this.canFulfill(request)) {
      return this.createError('CAPABILITY', '[AnthropicModelProvider] Cannot fulfill the request with the required capabilities', 400, false);
    }

    const modelToUse = request.preferredModel || this.getDefaultModel();
    const estimatedPromptTokens = Math.ceil((request.prompt.length / 4));
    const estimatedTotalTokens = estimatedPromptTokens + (request.maxTokens || (this.providerConfig?.models[modelToUse]?.contextSize || 1024) / 2);

    if (!this.consumeTokens(estimatedTotalTokens)) {
        this.updateHealthMetrics(false, 0);
        return this.createError(
            'RATE_LIMIT',
            '[AnthropicModelProvider] Estimated token consumption exceeds provider TPM/RPM limits.',
            429,
            true
        );
    }

    const startTime = Date.now();
    let latencyMs = 0;

    try {
      const messages: Anthropic.Messages.MessageParam[] = [
        { role: 'user', content: request.prompt }
        // TODO: Add support for conversation history if available in AIModelRequest
      ];

      // stream: request.streaming, // TODO: Full streaming support
      const anthropicRequestParams: Anthropic.Messages.MessageCreateParams = {
        model: modelToUse,
        messages: messages,
        max_tokens: request.maxTokens || 1024, // Anthropic requires max_tokens
        temperature: request.temperature,
        // system: "System prompt if needed", // TODO: Add if system prompt becomes part of AIModelRequest
        // tools: mappedTools, // TODO: Implement tool mapping
      };
      
      if (request.streaming) {
        // TODO: Implement streaming response handling for Anthropic
        // For now, we'll return an error or ignore streaming for non-streaming implementation
        console.warn('[AnthropicModelProvider] Streaming requested but not yet implemented. Proceeding with non-streaming.');
        // To strictly enforce, you might return an error:
        // return this.createError('CAPABILITY', 'Streaming not implemented for Anthropic yet', 501, false);
      }

      const response: Anthropic.Messages.Message = await this.anthropicClient.messages.create(anthropicRequestParams);
      latencyMs = Date.now() - startTime;
      this.updateHealthMetrics(true, latencyMs);

      if (!response.content || response.content.length === 0 || response.content[0].type !== 'text') {
        throw new Error('Anthropic response format error: No text content found or unexpected content type.');
      }
      if (!response.usage) {
        throw new Error('Anthropic response format error: No usage data.');
      }

      const textResponse = response.content[0].text;

      return {
        ok: true,
        text: textResponse,
        tokens: {
          prompt: response.usage.input_tokens,
          completion: response.usage.output_tokens,
          total: response.usage.input_tokens + response.usage.output_tokens,
        },
        meta: {
          provider: this.providerName,
          model: response.model || modelToUse, // Use model from response if available
          region: this.awsClientRegion,
          timestamp: Date.now(),
          latency: latencyMs,
          features: [] // TODO: Populate based on actual model used/features requested
        },
      };
    } catch (error: any) {
      latencyMs = Date.now() - startTime;
      this.updateHealthMetrics(false, latencyMs);

      if (error instanceof Anthropic.APIError) {
        // Map Anthropic-specific errors
        let errorCode: AIModelError['code'] = 'UNKNOWN';
        let retryable = true;
        const status = error.status;

        if (error instanceof Anthropic.RateLimitError) {
          errorCode = 'RATE_LIMIT';
        } else if (error instanceof Anthropic.AuthenticationError) {
          errorCode = 'AUTH';
          retryable = false; // Auth errors usually not retryable with same creds
        } else if (error instanceof Anthropic.PermissionDeniedError) {
          errorCode = 'AUTH'; // Or a more specific 'PERMISSION_DENIED' if we add it
          retryable = false;
        } else if (error instanceof Anthropic.NotFoundError) {
            // Could be model not found or other resource
            errorCode = 'CAPABILITY'; // Treat as capability issue if model not found
            retryable = false;
        } else if (error instanceof Anthropic.ConflictError || error instanceof Anthropic.UnprocessableEntityError) {
            errorCode = 'UNKNOWN'; // Or map to specific content/request format error
            retryable = false; // Usually indicates bad request input
        } else if (error instanceof Anthropic.InternalServerError) {
            errorCode = 'UNKNOWN'; // Could be retryable
        } else {
            // Other Anthropic.APIError subtypes or generic APIError
            retryable = status >= 500; // Crude retry logic for server-side errors
        }
        return this.createError(errorCode, `[AnthropicModelProvider] API Error: ${error.message}`, status, retryable);
      } else {
        // Non-Anthropic SDK errors (e.g., network issues before request, our internal errors)
        return this.createError('UNKNOWN', `[AnthropicModelProvider] Error generating response: ${error.message || 'Unknown internal error'}`, undefined, true);
      }
    }
  }

  public canFulfill(request: AIModelRequest): boolean {
    if (!super.canFulfill(request)) return false;
    return this.providerConfig?.active || false;
  }

  public getModelCapabilities(modelName: string): ModelCapabilities {
    console.log(`[AnthropicModelProvider] getModelCapabilities called for model: ${modelName}`);
    
    // Base capabilities to ensure all fields are present, even if with default values
    const capabilitiesBase: ModelCapabilities = {
        reasoning: 0, 
        creativity: 0, 
        coding: 0, 
        retrieval: false, 
        functionCalling: false, // Corrected name
        contextSize: 0,
        streamingSupport: false, // Corrected name
        // Other fields like provider, model name, active status, costs, subjective scores (qualityScore)
        // are NOT part of the ModelCapabilities interface itself based on common-types.
    };

    switch (modelName) {
        case 'claude-3-opus-20240229':
            return {
                ...capabilitiesBase,
                contextSize: 200000,
                functionCalling: true, // Corrected name
                streamingSupport: true,
                reasoning: 5, creativity: 4, coding: 4, retrieval: true, 
            };

        case 'claude-3-5-sonnet-20240620':
             return {
                ...capabilitiesBase,
                contextSize: 200000,
                functionCalling: true, // Corrected name
                streamingSupport: true,
                reasoning: 4, creativity: 4, coding: 3, retrieval: true, 
            };

        case 'claude-3-sonnet-20240229':
            return {
                ...capabilitiesBase,
                contextSize: 200000,
                functionCalling: true, // Corrected name
                streamingSupport: true,
                reasoning: 4, creativity: 3, coding: 3, retrieval: true, 
            };

        case 'claude-3-haiku-20240307':
            return {
                ...capabilitiesBase,
                contextSize: 200000,
                functionCalling: true, // Corrected name
                streamingSupport: true,
                reasoning: 3, creativity: 3, coding: 2, retrieval: false, 
            };

        case 'claude-2.1':
        case 'claude-2.0':
            return {
                ...capabilitiesBase,
                contextSize: 200000, 
                functionCalling: false,
                streamingSupport: true,
                reasoning: 3, creativity: 2, coding: 1, retrieval: false, 
            };

        case 'claude-instant-1.2':
            return {
                ...capabilitiesBase,
                contextSize: 100000,
                functionCalling: false,
                streamingSupport: true,
                reasoning: 2, creativity: 2, coding: 1, retrieval: false, 
            };
            
        default:
            console.warn(`[AnthropicModelProvider] Unknown modelName: ${modelName} in getModelCapabilities. Returning default minimal capabilities.`);
            return {
                ...capabilitiesBase, // Returns the default minimal set defined above
            }; 
    }
  }

  public getProviderHealth(): ProviderHealthStatus {
    return this.healthStatus; 
  }

  public getProviderLimits(): ProviderLimits {
    // Rate limits can be at the provider level in ProviderConfig,
    // or sometimes specified per model. For simplicity, using provider-level config first.
    return this.providerConfig?.rateLimits || { rpm: 100, tpm: 40000 }; 
  }

  protected getDefaultModel(): string {
    return this.providerConfig?.defaultModel || 'claude-3-haiku-20240307'; 
  }
} 