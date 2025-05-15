import { SecretsManagerClient, GetSecretValueCommand, GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import Anthropic, {
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  InternalServerError,
  RateLimitError
} from '@anthropic-ai/sdk'; // Official Anthropic SDK
import { BaseAIModelProvider } from './BaseAIModelProvider';
import {
  AIModelRequest,
  AIModelResult,
  ModelCapabilities,
  ProviderHealthStatus,
  AIModelError,
  ProviderLimits,
  TokenUsage,
  ChatMessage
} from '../../../../packages/common-types/src/ai-interfaces';
import { ProviderConfig } from '../../../../packages/common-types/src/config-schema';
import { IDatabaseProvider } from '../../../../packages/common-types/src/core-interfaces';
import { standardizeError as sharedStandardizeError } from './standardizeError';

const ANTHROPIC_PROVIDER_ID = 'anthropic';

interface ApiKeys { // Define a simple interface for the expected secret structure
  current: string;
  previous?: string; // Optional, though Anthropic provider might only use current
}

export class AnthropicModelProvider extends BaseAIModelProvider {
  private secretId: string;
  private awsRegion: string;
  private providerConfig: ProviderConfig | null = null;
  private secretsManagerClient: SecretsManagerClient; // Add SecretsManagerClient instance
  private currentApiKey?: string;
  private anthropicClient: Anthropic | null = null;
  private clientProvided: boolean; // If an Anthropic client is injected directly
  private keysLoaded: boolean = false;
  private keyFetchPromise: Promise<void> | null = null;
  private dbProviderForConfig: IDatabaseProvider; // Keep for config, not for BaseAIModelProvider's circuit breaker

  constructor(
    secretId: string, 
    awsRegion: string, 
    dbProvider: IDatabaseProvider, // This dbProvider is for config/secrets, not Base's (now removed) circuit breaker
    defaultModel: string = "claude-3-opus-20240229"
  ) {
    super("anthropic", defaultModel /*, dbProvider -- REMOVED from super call */);
    this.secretId = secretId;
    this.awsRegion = awsRegion;
    this.secretsManagerClient = new SecretsManagerClient({ region: this.awsRegion }); // Initialize client
    this.dbProviderForConfig = dbProvider; // Store for its own needs
    this.clientProvided = false;
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
        request.context.conversationHistory.forEach((histMsg: ChatMessage) => {
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

      const anthropicTokenUsage: TokenUsage = {
        prompt: response.usage.input_tokens,
        completion: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      };

      return {
        ok: true,
        text: textResponse,
        tokens: anthropicTokenUsage,
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

      if (error instanceof APIError) {
        let errorCode: AIModelError['code'] = 'UNKNOWN';
        let retryable = true;
        const status = error.status;

        if (error instanceof RateLimitError) {
          errorCode = 'RATE_LIMIT';
        } else if (error instanceof AuthenticationError) {
          errorCode = 'AUTH';
          retryable = false;
        } else if (error instanceof PermissionDeniedError) {
          errorCode = 'AUTH';
          retryable = false;
        } else if (error instanceof NotFoundError) {
            errorCode = 'CAPABILITY';
            retryable = false;
        } else if (error instanceof ConflictError || error instanceof UnprocessableEntityError) {
            errorCode = 'CONTENT';
            retryable = false;
        } else if (error instanceof InternalServerError) {
            errorCode = 'TIMEOUT';
            retryable = true;
        } else {
            if (status === 401 || status === 403) {
                errorCode = 'AUTH';
                retryable = false;
            } else if (status === 429) {
                errorCode = 'RATE_LIMIT';
                retryable = true;
            } else if (status === 404) {
                errorCode = 'CAPABILITY';
                retryable = false;
            } else if (status === 409 || status === 422) {
                errorCode = 'CONTENT';
                retryable = false;
            } else if (status && status >= 500) {
                errorCode = 'TIMEOUT';
                retryable = true;
            } else {
                retryable = status && status >=500 ? true : false; 
            }
        }
        return this.createError(errorCode, `[AnthropicModelProvider] API Error: ${error.message}`, status, retryable);
      } else {
        return this.standardizeError(error);
      }
    }
  }

  protected standardizeError(error: any): AIModelError {
    return sharedStandardizeError(error, this.providerName);
  }

  public async canFulfill(request: AIModelRequest): Promise<boolean> {
    const baseCanFulfill = await super.canFulfill(request);
    if (!baseCanFulfill) return false;
    return this.providerConfig?.active || false;
  }

  public getModelCapabilities(modelName: string): ModelCapabilities {
    const modelConfig = this.providerConfig?.models?.[modelName];

    if (modelConfig) {
      return {
        contextSize: modelConfig.contextSize,
        streamingSupport: modelConfig.streamingSupport !== undefined ? modelConfig.streamingSupport : (modelName.includes('claude-3') ? true : false),
        functionCalling: modelConfig.functionCalling !== undefined ? modelConfig.functionCalling : (modelName.includes('opus') || modelName.includes('sonnet')),
        vision: (modelConfig as any).vision !== undefined ? (modelConfig as any).vision : (modelName.includes('claude-3')),
        toolUse: (modelConfig as any).toolUse !== undefined ? (modelConfig as any).toolUse : false, 
        configurable: true,
        inputCost: typeof modelConfig.tokenCost === 'number' ? modelConfig.tokenCost : ((modelConfig.tokenCost as any)?.prompt || 0),
        outputCost: typeof modelConfig.tokenCost === 'number' ? modelConfig.tokenCost : ((modelConfig.tokenCost as any)?.completion || 0),
        maxOutputTokens: (modelConfig as any).maxOutputTokens,
        reasoning: (modelConfig as any).reasoning || 0, 
        creativity: (modelConfig as any).creativity || 0,
        coding: (modelConfig as any).coding || 0,
        retrieval: (modelConfig as any).retrieval || false,
    };
    }

    // If not in config, check hardcoded known Anthropic models
    switch (modelName) {
        case 'claude-3-opus-20240229':
            return {
                contextSize: 200000,
                streamingSupport: true,
                functionCalling: true,
                vision: true,
                toolUse: true, 
                configurable: true,
                inputCost: 15/1_000_000, 
                outputCost: 75/1_000_000,
                maxOutputTokens: 4096,
                reasoning: 5, creativity: 5, coding: 5, retrieval: true,
            };
        case 'claude-3-sonnet-20240229':
            return {
                contextSize: 200000,
                streamingSupport: true,
                functionCalling: true,
                vision: true,
                toolUse: true, 
                configurable: true,
                inputCost: 3/1_000_000,
                outputCost: 15/1_000_000,
                maxOutputTokens: 4096,
                reasoning: 4, creativity: 4, coding: 4, retrieval: true,
            };
        case 'claude-3-haiku-20240307':
            return {
                contextSize: 200000,
                streamingSupport: true,
                functionCalling: true, 
                vision: true,
                toolUse: true, 
                configurable: true,
                inputCost: 0.25/1_000_000,
                outputCost: 1.25/1_000_000,
                maxOutputTokens: 4096,
                reasoning: 3, creativity: 3, coding: 3, retrieval: false,
            };
        case 'claude-2.1':
        return {
            contextSize: 200000,
            streamingSupport: true,
            functionCalling: false, 
            vision: false,
            toolUse: false,
            configurable: true,
            inputCost: 8/1_000_000, 
            outputCost: 24/1_000_000,
            maxOutputTokens: 4096, 
            reasoning: 2, creativity: 2, coding: 2, retrieval: false,
        };
        case 'claude-2.0':
            return {
            contextSize: 100000,
            streamingSupport: true,
            functionCalling: false,
            vision: false,
            toolUse: false,
            configurable: true,
            inputCost: 8/1_000_000,
            outputCost: 24/1_000_000,
            maxOutputTokens: 4096, 
            reasoning: 2, creativity: 2, coding: 1, retrieval: false,
            };
        case 'claude-instant-1.2':
            return {
                contextSize: 100000,
                streamingSupport: true,
                functionCalling: false,
                vision: false,
                toolUse: false,
                configurable: true,
                inputCost: 0.8/1_000_000,
                outputCost: 2.4/1_000_000,
                maxOutputTokens: 4096, 
                reasoning: 1, creativity: 1, coding: 1, retrieval: false,
            };
        default:
        console.warn(`[AnthropicModelProvider] Unknown modelName: ${modelName} in getModelCapabilities. Returning default capabilities.`);
        return {
            contextSize: 0,
            streamingSupport: false,
            functionCalling: false,
            vision: false,
            toolUse: false,
            configurable: false,
            inputCost: 0,
            outputCost: 0,
            maxOutputTokens: undefined, 
            reasoning: 0, 
            creativity: 0, 
            coding: 0, 
            retrieval: false,
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