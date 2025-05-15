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
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Anthropic } from '@anthropic-ai/sdk';
import { IDatabaseProvider } from '../../../../packages/common-types/src/core-interfaces';
import { standardizeError as sharedStandardizeError } from './standardizeError';

interface ApiKeys { // Define a simple interface for the expected secret structure
  current: string;
  previous?: string; // Optional, though Anthropic provider might only use current
}

export class AnthropicModelProvider extends BaseAIModelProvider {
  private secretId: string;
  private awsRegion: string;
  private providerConfig: ProviderConfig | null = null;
  private secretsManagerClient: SecretsManagerClient;
  private currentApiKey?: string;
  private anthropicClient: Anthropic | null = null;
  private clientProvided: boolean; // If an Anthropic client is injected directly
  private keysLoaded: boolean = false;
  private keyFetchPromise: Promise<void> | null = null;

  constructor(
    secretId: string, 
    awsRegion: string, 
    _dbProvider: IDatabaseProvider, // Renamed to _dbProvider to indicate it's not used
    defaultModelName: string = "claude-3-haiku-20240307"
  ) {
    super("anthropic", defaultModelName);
    this.secretId = secretId;
    this.awsRegion = awsRegion;
    this.secretsManagerClient = new SecretsManagerClient({ region: this.awsRegion });
    this.clientProvided = false;
  }

  private async _fetchAndParseApiKeys(): Promise<void> {
    try {
      const commandOutput = await this.secretsManagerClient.send(
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

      const errorMessage = error?.message || 'Unknown error';
      const errorStatus = error?.status || 500;

      // Handle based on error status code and message patterns
      if (errorStatus === 429 || errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
        // Rate limit error handling
        return this.createError('RATE_LIMIT', `Anthropic rate limit error: ${errorMessage}`, errorStatus, true);
      } else if (errorStatus === 401 || errorMessage.includes('authentication') || errorMessage.includes('api key')) {
        // Auth error handling
        return this.createError('AUTH', `Anthropic authentication error: ${errorMessage}`, errorStatus, false);
      } else if (errorStatus === 403 || errorMessage.includes('permission denied') || errorMessage.includes('unauthorized')) {
        // Permission denied error handling
        return this.createError('AUTH', `Anthropic permission error: ${errorMessage}`, errorStatus, false);
      } else if (errorStatus === 404 || errorMessage.includes('not found')) {
        // Not found error handling
        return this.createError('CAPABILITY', `Anthropic resource not found: ${errorMessage}`, errorStatus, false);
      } else if (errorStatus === 422 || errorMessage.includes('conflict') || errorMessage.includes('unprocessable')) {
        // Conflict or unprocessable error handling
        return this.createError('CONTENT', `Anthropic invalid request: ${errorMessage}`, errorStatus, false);
      } else if (errorStatus === 500 || errorMessage.includes('server error')) {
        // Server error handling
        return this.createError('UNKNOWN', `Anthropic server error: ${errorMessage}`, errorStatus, true);
      }
      
      // Default error case
      return this.standardizeError(error);
    }
  }

  /**
   * Standardize Anthropic errors into our common error format
   */
  protected standardizeError(error: any): AIModelError {
    // Use the shared standardizeError function as a base
    const stdError = sharedStandardizeError(error, 'anthropic');
    
    // If we were able to determine specific error types from the shared function, use that
    if (stdError.code !== 'UNKNOWN') {
      return stdError;
    }
    
    // Fallback error handling for Anthropic-specific errors
    const errorMessage = error?.message || 'Unknown error';
    
    // Check error message patterns instead of instanceof checks
    if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
      return {
        ok: false,
        code: 'RATE_LIMIT',
        provider: 'anthropic',
        status: error?.status || 429,
        retryable: true,
        detail: `Anthropic rate limit error: ${errorMessage}`
      };
    } else if (errorMessage.includes('authentication') || errorMessage.includes('invalid api key')) {
      return {
        ok: false,
        code: 'AUTH',
        provider: 'anthropic',
        status: error?.status || 401,
        retryable: false,
        detail: `Anthropic authentication error: ${errorMessage}`
      };
    } else if (errorMessage.includes('permission denied') || errorMessage.includes('unauthorized')) {
      return {
        ok: false,
        code: 'AUTH',
        provider: 'anthropic',
        status: error?.status || 403,
        retryable: false,
        detail: `Anthropic permission error: ${errorMessage}`
      };
    } else if (errorMessage.includes('not found')) {
      return {
        ok: false,
        code: 'CAPABILITY',
        provider: 'anthropic',
        status: error?.status || 404,
        retryable: false,
        detail: `Anthropic resource not found: ${errorMessage}`
      };
    } else if (errorMessage.includes('conflict') || errorMessage.includes('unprocessable')) {
      return {
        ok: false,
        code: 'CONTENT',
        provider: 'anthropic',
        status: error?.status || 422,
        retryable: false,
        detail: `Anthropic invalid request: ${errorMessage}`
      };
    } else if (errorMessage.includes('server error') || errorMessage.includes('500')) {
      return {
        ok: false,
        code: 'UNKNOWN',
        provider: 'anthropic',
        status: error?.status || 500,
        retryable: true,
        detail: `Anthropic server error: ${errorMessage}`
      };
    }
    
    // Default error case
    return {
      ok: false,
      code: 'UNKNOWN',
      provider: 'anthropic',
      status: error?.status || 500,
      retryable: true,
      detail: `Anthropic error: ${errorMessage}`
    };
  }

  public async canFulfill(request: AIModelRequest): Promise<boolean> {
    const baseCanFulfill = await super.canFulfill(request);
    if (!baseCanFulfill) return false;
    return this.providerConfig?.active || false;
  }

  public getModelCapabilities(modelName: string): ModelCapabilities {
    // Return capabilities based on model with type assertion
    // Different capabilities for different models
    if (modelName.includes('opus')) {
      return {
        reasoning: 5,
        creativity: 4,
        coding: 5,
        contextSize: 100000,
        retrieval: false,
        functionCalling: true,
        streamingSupport: true,
        vision: true,
        toolUse: true,
        maxOutputTokens: 4000,
        inputCost: 0.00025,
        outputCost: 0.00125
      } as ModelCapabilities;
    } else if (modelName.includes('sonnet')) {
      return {
        reasoning: 4,
        creativity: 3,
        coding: 4,
        contextSize: 100000,
        retrieval: false,
        functionCalling: true,
        streamingSupport: true,
        vision: true,
        toolUse: true,
        maxOutputTokens: 4000,
        inputCost: 0.00025,
        outputCost: 0.00125
      } as ModelCapabilities;
    } else {
      // Default capabilities for haiku or other models
      return {
        reasoning: 3,
        creativity: 3,
        coding: 3,
        contextSize: 100000,
        retrieval: false,
        functionCalling: true,
        streamingSupport: true,
        vision: true,
        toolUse: true,
        maxOutputTokens: 4000,
        inputCost: 0.00025,
        outputCost: 0.00125
      } as ModelCapabilities;
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