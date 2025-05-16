import { BaseAIModelProvider } from './BaseAIModelProvider';
import {
  AIModelRequest,
  AIModelResult,
  ProviderHealthStatus,
  AIModelError,
  ProviderLimits,
  TokenUsage,
  ChatMessage
} from '@kinable/common-types';
import { ModelConfig, ProviderConfig } from '@kinable/common-types';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import Anthropic from '@anthropic-ai/sdk';
import { IDatabaseProvider } from '@kinable/common-types';
import { standardizeError as sharedStandardizeError } from './standardizeError';

interface ApiKeys { // Define a simple interface for the expected secret structure
  current: string;
  previous?: string; // Optional, though Anthropic provider might only use current
}

export class AnthropicModelProvider extends BaseAIModelProvider {
  private secretId: string;
  private readonly awsRegion: string;
  private currentApiKey?: string;
  private anthropicClient?: Anthropic;
  private keysLoaded: boolean = false;
  private keyFetchPromise: Promise<string | null> | null = null;

  constructor(
    secretId: string,
    awsRegion: string,
    _dbProvider: IDatabaseProvider,
    defaultModelName: string,
    providerConfig: ProviderConfig,
    private secretsManager?: SecretsManagerClient
  ) {
    super('anthropic', defaultModelName, providerConfig);
    this.secretId = secretId;
    this.awsRegion = awsRegion;

    if (!this.secretsManager) {
      this.secretsManager = new SecretsManagerClient({ region: this.awsRegion });
    }
  }

  private async _fetchAndParseApiKeys(): Promise<string | null> {
    if (!this.secretsManager) {
      throw new Error('SecretsManagerClient not initialized in AnthropicModelProvider');
    }
    try {
      const command = new GetSecretValueCommand({ SecretId: this.secretId });
      console.log(`DEBUG: AnthropicProvider about to call secretsManager.send() for SecretId: ${this.secretId}`);
      const commandOutput = await this.secretsManager.send(command);
      console.log('DEBUG: AnthropicProvider secretsManager.send() call completed. Output:', commandOutput);

      if (commandOutput.SecretString) {
        const secretJson = JSON.parse(commandOutput.SecretString) as ApiKeys;
        if (secretJson.current) {
          this.currentApiKey = secretJson.current;
          return this.currentApiKey;
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

  private _ensureApiKeysLoaded(): Promise<string | null> {
    if (this.keysLoaded && this.currentApiKey) {
      return Promise.resolve(this.currentApiKey);
    }

    if (!this.keyFetchPromise) {
      this.keyFetchPromise = (async (): Promise<string | null> => {
        try {
          const apiKey = await this._fetchAndParseApiKeys();
          if (!apiKey) {
            throw new Error('Current API key is missing after fetch attempt.');
          }
          this.anthropicClient = this._createAnthropicClient(apiKey);
          this.keysLoaded = true;
          this.currentApiKey = apiKey;
          return apiKey;
        } catch (error) {
          this.keysLoaded = false;
          this.currentApiKey = undefined;
          this.anthropicClient = undefined;
          console.error('Error ensuring Anthropic API keys are loaded:', error);
          throw error;
        } finally {
          this.keyFetchPromise = null;
        }
      })();
    }
    return this.keyFetchPromise;
  }

  protected async _generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    try {
      await this._ensureApiKeysLoaded();
    } catch (error: any) {
      throw error;
    }

    if (!this.anthropicClient) {
      console.error('[AnthropicProvider._generateResponse] Anthropic client not initialized after attempting to load keys.');
      return this.createError('UNKNOWN', 'Anthropic client not initialized', 500, false);
    }

    const { prompt, context, preferredModel, maxTokens, temperature, conversationId: _conversationId, tools: _tools } = request;
    
    const startTime = Date.now();
    let latencyMs = 0;

    try {
      const messages: Anthropic.Messages.MessageParam[] = [];
      if (context.history && context.history.length > 0) {
        context.history.forEach((histMsg: ChatMessage) => {
          if (histMsg.role === 'user' || histMsg.role === 'assistant') {
            messages.push({ role: histMsg.role, content: histMsg.content });
          }
        });
      }
      messages.push({ role: 'user', content: prompt });

      const anthropicRequestParams: Anthropic.Messages.MessageCreateParams = {
        model: preferredModel || this.getDefaultModel(),
        messages: messages,
        max_tokens: maxTokens || 1024, 
        temperature: temperature,
      };

      // Use systemPrompt from the request if provided
      if (request.systemPrompt) {
        anthropicRequestParams.system = request.systemPrompt;
      } else {
        // Ensure it's explicitly undefined if not provided, rather than relying on previous history search
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
          model: response.model || preferredModel || this.getDefaultModel(),
          region: context.region,
          timestamp: Date.now(),
          latency: latencyMs,
          features: this.getModelCapabilities(preferredModel || this.getDefaultModel()).functionCallingSupport ? ['function_calling'] : []
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
    
    // If sharedStandardizeError already mapped it correctly (e.g., from a structured Anthropic error type it recognizes)
    if (stdError.code !== 'UNKNOWN') {
      return stdError;
    }

    const errorMessage = error?.message?.toLowerCase() || 'unknown error';

    // Custom check for our specific key loading errors
    if (errorMessage.includes('failed to load api keys') || 
        errorMessage.includes('secret does not contain a "current" api key') || 
        errorMessage.includes('secretstring is empty or not found') ||
        errorMessage.includes('current api key is missing after fetch attempt') ||
        errorMessage.includes('secretsmanagerclient not initialized')) {
      return this.createError('AUTH', `Anthropic key/initialization error: ${error?.message || errorMessage}`, error?.status || 500, false);
      // Using 'AUTH' as per previous expectation for PROVIDER_KEY_ERROR, and making it not retryable.
    }
    
    // Fallback error handling for Anthropic-specific errors OR errors not caught by sharedStandardizeError
    const errorStatus = error?.status; 

    // Check based on status or message patterns
    if (errorStatus === 429 || errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
      return this.createError('RATE_LIMIT', `Anthropic rate limit error: ${error?.message || errorMessage}`, errorStatus, true);
    } else if (errorStatus === 401 || errorMessage.includes('authentication') || errorMessage.includes('invalid api key')) {
      return this.createError('AUTH', `Anthropic authentication error: ${error?.message || errorMessage}`, errorStatus, false);
    } else if (errorStatus === 403 || errorMessage.includes('permission denied') || errorMessage.includes('unauthorized')) {
      return this.createError('AUTH', `Anthropic permission error: ${error?.message || errorMessage}`, errorStatus, false);
    } else if (errorStatus === 404 || errorMessage.includes('not found')) {
        return this.createError('CAPABILITY', `Anthropic resource not found: ${error?.message || errorMessage}`, errorStatus, false);
    } else if (errorStatus === 400 || errorStatus === 422 || errorMessage.includes('invalid request') || errorMessage.includes('unprocessable')) {
        // Note: Anthropic often uses 400 for various invalid requests, including content issues or malformed bodies.
        return this.createError('CONTENT', `Anthropic invalid request: ${error?.message || errorMessage}`, errorStatus, false);
    } else if (errorStatus && errorStatus >= 500 || errorMessage.includes('server error') || errorMessage.includes('api error') || errorMessage.includes('overloaded')) {
        return this.createError('UNKNOWN', `Anthropic server error: ${error?.message || errorMessage}`, errorStatus, true);
    }

    // Default: if no specific mapping, use the already determined stdError (which would be code: UNKNOWN)
    return stdError;
  }

  public async canFulfill(request: AIModelRequest): Promise<boolean> {
    const baseCanFulfill = await super.canFulfill(request);
    if (!baseCanFulfill) return false;
    return this.configForProvider.models[request.preferredModel || this.getDefaultModel()]?.active || false;
  }

  public getModelCapabilities(modelName: string): ModelConfig {
    const modelCfg = this.configForProvider.models[modelName];
    if (!modelCfg) {
      console.error(`[${this.providerName}] Model configuration for "${modelName}" not found.`);
      throw new Error(`[${this.providerName}] Model configuration for "${modelName}" not found.`);
    }
    return modelCfg;
  }

  public async getProviderHealth(): Promise<ProviderHealthStatus> {
    this.healthStatus.lastChecked = Date.now();
    try {
      await this._ensureApiKeysLoaded(); 
      if (this.anthropicClient && this.keysLoaded) {
        this.healthStatus.available = true;
        // this.healthStatus.details = 'API keys loaded and client initialized.'; // Details not part of type
      } else {
        this.healthStatus.available = false;
        // this.healthStatus.details = 'API keys not loaded or client not initialized.';
      }
    } catch (error: any) {
      this.healthStatus.available = false;
      // this.healthStatus.details = `Failed to load API keys: ${error.message}`;
      console.error(`[AnthropicModelProvider] Error during health check key loading: ${error.message}`);
    }
    return { ...this.healthStatus };
  }

  public getProviderLimits(): ProviderLimits {
    const defaultLimits: ProviderLimits = { rpm: 100, tpm: 40000 }; // Default Anthropic limits if not in config
    if (this.configForProvider.rateLimits) {
      return {
        rpm: this.configForProvider.rateLimits.rpm ?? defaultLimits.rpm,
        tpm: this.configForProvider.rateLimits.tpm ?? defaultLimits.tpm,
      };
    }
    return defaultLimits;
  }

  protected getDefaultModel(): string {
    return this.configForProvider.defaultModel || 'claude-3-haiku-20240307'; 
  }

  // --- Protected methods ---
  protected _createAnthropicClient(apiKey: string): Anthropic {
    return new Anthropic({ apiKey });
  }
}
