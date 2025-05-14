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
  ProviderLimits
} from '../../../../packages/common-types/src/ai-interfaces';
import { ProviderConfig } from '../../../../packages/common-types/src/config-schema';

const ANTHROPIC_PROVIDER_ID = 'anthropic';

interface ApiKeys { // Define a simple interface for the expected secret structure
  current: string;
  previous?: string; // Optional, though Anthropic provider might only use current
}

export class AnthropicModelProvider extends BaseAIModelProvider implements IAIModelProvider {
  private anthropicClient: Anthropic | null = null;
  private apiKey: string | null = null;
  private secretId: string;
  private awsClientRegion: string;
  private providerConfig: ProviderConfig | null = null;
  private secretsManagerClient: SecretsManagerClient; // Add SecretsManagerClient instance

  constructor(secretId: string, awsClientRegion: string, providerConfig?: ProviderConfig) {
    super(ANTHROPIC_PROVIDER_ID);
    this.secretId = secretId;
    this.awsClientRegion = awsClientRegion;
    this.secretsManagerClient = new SecretsManagerClient({ region: this.awsClientRegion }); // Initialize client
    if (providerConfig) {
      this.providerConfig = providerConfig;
    }
  }

  public async initialize(): Promise<void> {
    if (this.anthropicClient && this.apiKey) return; // Ensure API key is also checked

    try {
      this.apiKey = await this.loadApiKeyFromSecretsManager();
      if (!this.apiKey) {
        // Error already logged by loadApiKeyFromSecretsManager if it returns null due to fetch/parse error
        // Throw a new error here to be caught by the surrounding try-catch for health status update
        throw new Error('Anthropic API key could not be loaded from Secrets Manager.');
      }
      this.anthropicClient = new Anthropic({
        apiKey: this.apiKey,
      });
      this.healthStatus = { ...this.healthStatus, available: true, lastChecked: Date.now(), errorRate: 0, latencyP95: 0 };
    } catch (error: any) {
      this.healthStatus = { ...this.healthStatus, available: false, lastChecked: Date.now(), errorRate: 1, latencyP95: -1 };
      console.error(`[AnthropicModelProvider] Initialization failed: ${error.message}`);
      // Do not re-throw here, let healthStatus reflect the issue.
      // generateResponse will check healthStatus.
    }
  }

  private async loadApiKeyFromSecretsManager(): Promise<string | null> {
    try {
      const commandOutput: GetSecretValueCommandOutput = await this.secretsManagerClient.send(
        new GetSecretValueCommand({ SecretId: this.secretId })
      );

      if (commandOutput.SecretString) {
        const secretJson = JSON.parse(commandOutput.SecretString) as ApiKeys;
        if (secretJson.current) {
          return secretJson.current; // Successfully fetched and parsed the current key
        }
        // Consider if we need previous key logic like OpenAI for rotation, for now, just current.
        console.error(`[AnthropicModelProvider] Fetched secret (SecretId: ${this.secretId}) does not contain a "current" API key.`);
        throw new Error('Fetched secret does not contain a "current" API key.');
      } else {
        console.error(`[AnthropicModelProvider] SecretString is empty or not found (SecretId: ${this.secretId}).`);
        throw new Error('SecretString is empty or not found in Secrets Manager response.');
      }
    } catch (error: any) {
      console.error(`[AnthropicModelProvider] Failed to load or parse API key from Secrets Manager (SecretId: ${this.secretId}): ${error.message || error}`);
      // Return null to indicate failure to the initialize method
      // The initialize method will then throw a new error to be caught for health status update.
      return null;
    }
  }

  public setProviderConfig(providerConfig: ProviderConfig): void {
    this.providerConfig = providerConfig;
  }

  public async generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    if (!this.anthropicClient || !this.apiKey) {
      await this.initialize();
      if (!this.anthropicClient || !this.apiKey) {
        return this.createError(
          'AUTH',
          'Client not initialized. API key might be missing or failed to load.',
          undefined,
          true
        );
      }
    }
    if (!this.healthStatus.available) {
        return this.createError('UNKNOWN', `Provider not available. ErrorRate: ${this.healthStatus.errorRate.toFixed(2)}, LastCheck: ${new Date(this.healthStatus.lastChecked).toISOString()}`, undefined, false);
    }

    const modelToUse = request.preferredModel || this.getDefaultModel();
    const estimatedPromptTokens = Math.ceil((request.prompt.length / 4)); // Very rough estimate
    const estimatedTotalTokens = estimatedPromptTokens + (request.maxTokens || (this.providerConfig?.models[modelToUse]?.contextSize || 1024) / 2); // Estimate based on maxTokens or half context

    if (!this.consumeTokens(estimatedTotalTokens)) { // Check against a rough estimate of total tokens for TPM
        this.updateHealthMetrics(false, 0); // Failed due to rate limit
        return this.createError(
            'RATE_LIMIT',
            'Estimated token consumption exceeds provider TPM/RPM limits.',
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
        return this.createError(errorCode, `Anthropic API Error: ${error.message}`, status, retryable);
      } else {
        // Non-Anthropic SDK errors (e.g., network issues before request, our internal errors)
        return this.createError('UNKNOWN', `Error generating response from Anthropic: ${error.message || 'Unknown error'}`, undefined, true);
      }
    }
  }

  public canFulfill(request: AIModelRequest): boolean {
    if (!super.canFulfill(request)) return false;
    return this.providerConfig?.active || false;
  }

  public getModelCapabilities(modelName: string): ModelCapabilities {
    const modelConf = this.providerConfig?.models[modelName];
    if (modelConf) {
        return {
            reasoning: modelConf.capabilities?.includes('reasoning_high') ? 5 : modelConf.capabilities?.includes('reasoning_medium') ? 3 : 1,
            creativity: modelConf.capabilities?.includes('creativity_high') ? 5 : modelConf.capabilities?.includes('creativity_medium') ? 3 : 1,
            coding: modelConf.capabilities?.includes('coding_proficient') ? 4 : modelConf.capabilities?.includes('coding_basic') ? 2 : 0,
            retrieval: modelConf.capabilities?.includes('retrieval_augmented') || false,
            functionCalling: modelConf.functionCalling || false,
            contextSize: modelConf.contextSize || 0,
            streamingSupport: modelConf.streamingSupport || false,
        };
    }
    return {
        reasoning: 0,
        creativity: 0,
        coding: 0,
        retrieval: false,
        functionCalling: false,
        contextSize: 0,
        streamingSupport: false,
    };
  }

  public getProviderHealth(): ProviderHealthStatus {
    return this.healthStatus;
  }

  public getProviderLimits(): ProviderLimits {
    return this.providerConfig?.rateLimits || { rpm: 10, tpm: 10000 };
  }

  public getDefaultModel(): string {
    return this.providerConfig?.defaultModel || 'claude-3-5-haiku-latest';
  }
} 