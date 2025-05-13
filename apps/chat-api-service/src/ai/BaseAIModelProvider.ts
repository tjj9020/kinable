import {
  IAIModelProvider,
  AIModelRequest,
  AIModelResult,
  AIModelError,
  ModelCapabilities,
  ProviderHealthStatus,
  ProviderLimits
} from '../../../../packages/common-types/src/ai-interfaces';

/**
 * Base abstract class for AI model providers with shared functionality
 */
export abstract class BaseAIModelProvider implements IAIModelProvider {
  protected readonly providerName: string;
  protected healthStatus: ProviderHealthStatus;
  protected readonly tokenBucket: { tokens: number; lastRefill: number };
  
  constructor(providerName: string) {
    this.providerName = providerName;
    this.healthStatus = {
      available: true,
      errorRate: 0,
      latencyP95: 0,
      lastChecked: Date.now()
    };
    this.tokenBucket = {
      tokens: this.getProviderLimits().tpm,
      lastRefill: Date.now()
    };
  }
  
  /**
   * Generate a response using the AI model
   * This method is implemented by concrete provider classes
   */
  abstract generateResponse(request: AIModelRequest): Promise<AIModelResult>;
  
  /**
   * Check if this provider can fulfill the request
   * @param request The request to check
   */
  canFulfill(request: AIModelRequest): boolean {
    // Basic availability check
    if (!this.healthStatus.available) {
      return false;
    }
    
    // Check if we have capacity in our token bucket
    this.refillTokenBucket();
    const estimatedTokens = this.estimateTokens(request);
    if (this.tokenBucket.tokens < estimatedTokens) {
      return false;
    }
    
    // Check if tools are provided but not supported
    if (request.tools && request.tools.length > 0) {
      const modelName = request.preferredModel || this.getDefaultModel();
      const capabilities = this.getModelCapabilities(modelName);
      
      if (!capabilities.functionCalling) {
        return false;
      }
    }
    
    // Check model capabilities if specific capabilities requested
    if (request.requiredCapabilities && request.requiredCapabilities.length > 0) {
      const modelName = request.preferredModel || this.getDefaultModel();
      const capabilities = this.getModelCapabilities(modelName);
      
      // Check if all required capabilities are supported
      return request.requiredCapabilities.every((capability: string) => {
        switch (capability) {
          case 'reasoning':
            return capabilities.reasoning >= 3;
          case 'creativity':
            return capabilities.creativity >= 3;
          case 'coding':
            return capabilities.coding >= 3;
          case 'function_calling':
            return capabilities.functionCalling;
          case 'streaming':
            return capabilities.streamingSupport;
          default:
            return false;
        }
      });
    }
    
    return true;
  }
  
  /**
   * Get the capabilities of a specific model
   * This method should be implemented by concrete provider classes
   */
  abstract getModelCapabilities(modelName: string): ModelCapabilities;
  
  /**
   * Get the current health status of this provider
   */
  getProviderHealth(): ProviderHealthStatus {
    return { ...this.healthStatus };
  }
  
  /**
   * Get the rate limits for this provider
   * This method should be implemented by concrete provider classes
   */
  abstract getProviderLimits(): ProviderLimits;
  
  /**
   * Update the health status based on a successful or failed response
   * @param success Whether the request was successful
   * @param latency The latency of the request in milliseconds
   */
  protected updateHealthMetrics(success: boolean, latency: number): void {
    const now = Date.now();
    const timeDiff = now - this.healthStatus.lastChecked;
    const decayFactor = Math.min(1, timeDiff / (60 * 1000)); // 1-minute decay
    
    // Update error rate with exponential decay
    const newErrorRate = success
      ? this.healthStatus.errorRate * (1 - decayFactor)
      : this.healthStatus.errorRate * (1 - decayFactor) + decayFactor;
    
    // Update P95 latency with exponential weighted moving average
    const newLatencyP95 = this.healthStatus.latencyP95 === 0
      ? latency
      : this.healthStatus.latencyP95 * 0.95 + latency * 0.05;
    
    this.healthStatus = {
      available: newErrorRate < 0.15, // Consider unavailable if error rate > 15%
      errorRate: newErrorRate,
      latencyP95: newLatencyP95,
      lastChecked: now
    };
  }
  
  /**
   * Create a standard error response
   */
  protected createError(
    code: AIModelError['code'],
    detail?: string,
    status?: number,
    retryable = true
  ): AIModelError {
    return {
      ok: false,
      code,
      provider: this.providerName,
      detail,
      status,
      retryable
    };
  }
  
  /**
   * Refill the token bucket based on time elapsed
   */
  private refillTokenBucket(): void {
    const now = Date.now();
    const timeDiff = (now - this.tokenBucket.lastRefill) / 1000; // seconds
    const limits = this.getProviderLimits();
    
    // Refill at tpm/60 tokens per second
    const tokensToAdd = Math.floor((limits.tpm / 60) * timeDiff);
    
    if (tokensToAdd > 0) {
      this.tokenBucket.tokens = Math.min(limits.tpm, this.tokenBucket.tokens + tokensToAdd);
      this.tokenBucket.lastRefill = now;
    }
  }
  
  /**
   * Consume tokens from the token bucket
   */
  protected consumeTokens(tokens: number): boolean {
    this.refillTokenBucket();
    
    if (this.tokenBucket.tokens >= tokens) {
      this.tokenBucket.tokens -= tokens;
      return true;
    }
    
    return false;
  }
  
  /**
   * Estimate tokens for a request
   */
  protected estimateTokens(request: AIModelRequest): number {
    // Very basic estimation - 1 token ≈ 4 characters
    return Math.ceil(request.prompt.length / 4) + (request.maxTokens || 500);
  }
  
  /**
   * Get the default model for this provider
   */
  protected abstract getDefaultModel(): string;
} 