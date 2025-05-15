import { SecretsManagerClient, GetSecretValueCommand, GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import Anthropic from '@anthropic-ai/sdk'; // Official Anthropic SDK
import { BaseAIModelProvider } from './BaseAIModelProvider';
import {
  AIModelRequest,
  AIModelResult,
  ModelCapabilities,
  ProviderHealthStatus,
  AIModelError,
  ProviderLimits,
} from '../../../../packages/common-types/src/ai-interfaces';
import { ProviderConfig } from '../../../../packages/common-types/src/config-schema';
import { IDatabaseProvider } from '../../../../packages/common-types/src/core-interfaces';

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
  private anthropicClient!: Anthropic; // Definite assignment assertion if _ensureApiKeysLoaded guarantees it or throws
  private clientProvided: boolean; // If an Anthropic client is injected directly
  private keysLoaded: boolean = false;
  private keyFetchPromise: Promise<void> | null = null;

  constructor(
    secretId: string, 
    awsClientRegion: string, 
    dbProviderInstance: IDatabaseProvider,
    defaultModel: string,
    anthropicClientInstance?: Anthropic
  ) {
    super(ANTHROPIC_PROVIDER_ID, defaultModel, dbProviderInstance);
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

  protected async _generateResponse(request: AIModelRequest): Promise<AIModelResult> {
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

    const modelToUse = request.preferredModel || this.getDefaultModel();
    
    const startTime = Date.now();
    let latencyMs = 0;

    try {
      const messages: Anthropic.Messages.MessageParam[] = [];
      if (request.context.conversationHistory && request.context.conversationHistory.length > 0) {
        request.context.conversationHistory.forEach(histMsg => {
          if (histMsg.role === 'user' || histMsg.role === 'assistant') {
            messages.push({ role: histMsg.role, content: histMsg.content });
          }
        });
      }
      messages.push({ role: 'user', content: request.prompt });

      const anthropicRequestParams: Anthropic.Messages.MessageCreateParams = {
        model: modelToUse,
        messages: messages,
        max_tokens: request.maxTokens || 1024, 
        temperature: request.temperature,
      };

      const systemPromptMessage = request.context.conversationHistory?.find(m => m.role === 'system');
      if (systemPromptMessage) {
        anthropicRequestParams.system = systemPromptMessage.content;
      } else {
        anthropicRequestParams.system = undefined;
      }
      
      if (request.streaming) {
        console.warn('[AnthropicModelProvider] Streaming requested but not yet implemented. Proceeding with non-streaming.');
      }

      const response: Anthropic.Messages.Message = await this.anthropicClient.messages.create(anthropicRequestParams);
      latencyMs = Date.now() - startTime;

      if (!response.content || response.content.length === 0) {
        throw new Error('Anthropic response format error: No content found.');
      }
      if (!response.usage) {
        throw new Error('Anthropic response format error: No usage data.');
      }

      const textResponse = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as Anthropic.TextBlock).text)
        .join('');

      if (!textResponse && response.content.some(block => block.type !== 'text')) {
        console.warn('[AnthropicModelProvider] Response contained content blocks, but no usable text was extracted.', response.content);
      }

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
          model: response.model || modelToUse,
          region: request.context.region,
          timestamp: Date.now(),
          latency: latencyMs,
          features: []
        },
      };
    } catch (error: any) {
      latencyMs = Date.now() - startTime;

      if (error instanceof Anthropic.APIError) {
        let errorCode: AIModelError['code'] = 'UNKNOWN';
        let retryable = true;
        const status = error.status;

        if (error instanceof Anthropic.RateLimitError) {
          errorCode = 'RATE_LIMIT';
        } else if (error instanceof Anthropic.AuthenticationError) {
          errorCode = 'AUTH';
          retryable = false;
        } else if (error instanceof Anthropic.PermissionDeniedError) {
          errorCode = 'AUTH';
          retryable = false;
        } else if (error instanceof Anthropic.NotFoundError) {
            errorCode = 'CAPABILITY';
            retryable = false;
        } else if (error instanceof Anthropic.ConflictError || error instanceof Anthropic.UnprocessableEntityError) {
            errorCode = 'UNKNOWN';
            retryable = false;
        } else if (error instanceof Anthropic.InternalServerError) {
            errorCode = 'UNKNOWN';
            retryable = true;
        } else {
            if (status && status >= 500) {
                errorCode = 'UNKNOWN';
                retryable = true;
            } else if (status && status >= 400 && status < 500) {
                errorCode = 'CAPABILITY';
                retryable = false;
            } else {
                errorCode = 'UNKNOWN';
                retryable = false;
            }
        }
        return this.createError(errorCode, `[AnthropicModelProvider] API Error: ${error.message}`, status, retryable);
      } else {
        return this.createError('UNKNOWN', `[AnthropicModelProvider] Error generating response: ${error.message || 'Unknown internal error'}`, undefined, true);
      }
    }
  }

  protected standardizeError(error: any): AIModelError {
    let errorCode: AIModelError['code'] = 'UNKNOWN';
    let retryable = true;
    let status: number | undefined = undefined;
    let detail = `[${this.providerName}] Error: ${error.message || 'Unknown internal error'}`;

    if (error instanceof Anthropic.APIError) {
      status = error.status;
      detail = `[${this.providerName}] API Error: ${error.message}`;

      if (error instanceof Anthropic.RateLimitError) {
        errorCode = 'RATE_LIMIT';
      } else if (error instanceof Anthropic.AuthenticationError) {
        errorCode = 'AUTH';
        retryable = false;
      } else if (error instanceof Anthropic.PermissionDeniedError) {
        errorCode = 'AUTH';
        retryable = false;
      } else if (error instanceof Anthropic.NotFoundError) {
        errorCode = 'CAPABILITY'; // Or UNKNOWN, depending on context. NotFound often means model not found.
        retryable = false;
      } else if (error instanceof Anthropic.ConflictError || error instanceof Anthropic.UnprocessableEntityError) {
        errorCode = 'UNKNOWN'; // Could be CAPABILITY if it relates to invalid input for the model
        retryable = false;
      } else if (error instanceof Anthropic.InternalServerError) {
        errorCode = 'UNKNOWN'; // Provider-side server error
        retryable = true;
      } else {
        // Generic APIError classification based on status code
        if (status && status >= 500) {
          errorCode = 'UNKNOWN'; // Server-side error at Anthropic
          retryable = true;
        } else if (status && status === 429) {
          errorCode = 'RATE_LIMIT';
          retryable = true; // Anthropic SDK might not throw RateLimitError for all 429s
        } else if (status && status === 401 || status === 403) {
          errorCode = 'AUTH';
          retryable = false;
        } else if (status && status >= 400 && status < 500) {
          errorCode = 'CAPABILITY'; // Likely bad request, invalid model, etc.
          retryable = false;
        } else {
          // Default for unclassified APIError or non-HTTP errors from APIError constructor
          errorCode = 'UNKNOWN';
          retryable = false; 
        }
      }
    } else if (error.name === 'TimeoutError' || (error.message && error.message.toLowerCase().includes('timeout'))) {
        errorCode = 'TIMEOUT';
        retryable = true;
        detail = `[${this.providerName}] Request timed out: ${error.message}`;
    } else {
      // Non-Anthropic.APIError, could be network issue, programming error, etc.
      // These are generally treated as unknown and potentially retryable by the circuit breaker
      // unless specific checks are added (e.g., for network offline errors).
      retryable = true; // Default to retryable for truly unknown errors passed to standardizeError
    }
    return this.createError(errorCode, detail, status, retryable);
  }

  public async canFulfill(request: AIModelRequest): Promise<boolean> {
    const baseCanFulfill = await super.canFulfill(request);
    if (!baseCanFulfill) return false;
    return this.providerConfig?.active || false;
  }

  public getModelCapabilities(modelName: string): ModelCapabilities {
    console.log(`[AnthropicModelProvider] getModelCapabilities called for model: ${modelName}`);
    
    const capabilitiesBase: ModelCapabilities = {
        reasoning: 0, 
        creativity: 0, 
        coding: 0, 
        retrieval: false, 
        functionCalling: false,
        contextSize: 0,
        streamingSupport: false,
    };

    switch (modelName) {
        case 'claude-3-opus-20240229':
            return {
                ...capabilitiesBase,
                contextSize: 200000,
                functionCalling: true,
                streamingSupport: true,
                reasoning: 5, creativity: 4, coding: 4, retrieval: true, 
            };

        case 'claude-3-5-sonnet-20240620':
             return {
                ...capabilitiesBase,
                contextSize: 200000,
                functionCalling: true,
                streamingSupport: true,
                reasoning: 4, creativity: 4, coding: 3, retrieval: true, 
            };

        case 'claude-3-sonnet-20240229':
            return {
                ...capabilitiesBase,
                contextSize: 200000,
                functionCalling: true,
                streamingSupport: true,
                reasoning: 4, creativity: 3, coding: 3, retrieval: true, 
            };

        case 'claude-3-haiku-20240307':
            return {
                ...capabilitiesBase,
                contextSize: 200000,
                functionCalling: true,
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
                ...capabilitiesBase,
            }; 
    }
  }

  public async getProviderHealth(): Promise<ProviderHealthStatus> {
    return super.getProviderHealth(); 
  }

  public getProviderLimits(): ProviderLimits {
    return this.providerConfig?.rateLimits || { rpm: 100, tpm: 40000 }; 
  }

  protected getDefaultModel(): string {
    return this.providerConfig?.defaultModel || 'claude-3-haiku-20240307'; 
  }
} 