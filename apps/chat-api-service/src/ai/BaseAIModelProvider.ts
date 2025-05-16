import {
  AIModelRequest,
  AIModelResult,
  ProviderHealthStatus,
  ProviderLimits,
  AIModelError,
  ProviderConfig,
  ModelConfig,
  ChatMessage
} from '@kinable/common-types';
// import { IDatabaseProvider } from '@kinable/common-types'; // Updated import, commented out as original

// InternalCircuitState interface REMOVED
// Circuit breaker constants REMOVED

export abstract class BaseAIModelProvider {
  protected readonly providerName: string;
  protected healthStatus: ProviderHealthStatus;
  // protected readonly dbProvider: IDatabaseProvider; // No longer needed if circuit state managed by router
  // protected circuitState: InternalCircuitState | null = null; // REMOVED
  protected readonly defaultModel: string;
  protected readonly tokenBucket: { tokens: number; lastRefill: number; capacity: number; refillRate: number };
  protected readonly configForProvider: ProviderConfig; // Store provider-specific config

  constructor(providerName: string, defaultModel: string, providerConfig: ProviderConfig) {
    this.providerName = providerName;
    this.defaultModel = defaultModel;
    this.configForProvider = providerConfig; // Store it
    // this.dbProvider = dbProvider; // REMOVED
    this.healthStatus = {
      available: true, // Default to true, AIModelRouter will manage actual availability via CircuitBreakerManager
      errorRate: 0,
      latencyP95: 0,
      lastChecked: Date.now(),
    };
    const limits = this.getProviderLimits();
    this.tokenBucket = {
      tokens: limits.tpm,
      lastRefill: Date.now(),
      capacity: limits.tpm,
      refillRate: limits.tpm / 60
    };
  }

  abstract getProviderLimits(): ProviderLimits;
  /**
   * Retrieves the capabilities for a specific model.
   * This method should be implemented by concrete provider classes.
   * @param modelName The name of the model.
   * @returns The capabilities of the model, or undefined if the model is not known/supported. - Now returns ModelConfig
   */
  public abstract getModelCapabilities(modelName: string): ModelConfig; // Return type is ModelConfig from config-schema
  protected abstract _generateResponse(request: AIModelRequest): Promise<AIModelResult>;
  protected abstract standardizeError(error: any): AIModelError;

  public async generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    // Circuit breaker checks are now handled by AIModelRouter before this method is called.
    
    // 1. Token consumption check
    const estimatedTotalTokens = this._estimateTokens(request);
    if (!this.consumeTokens(estimatedTotalTokens)) {
        this.updateHealthMetrics(false, 0, false); 
        return this.createError(
            'RATE_LIMIT',
            `[${this.providerName}] Estimated token consumption exceeds provider TPM/RPM limits.`,
            429,
            true
        );
    }

    // 2. Call actual provider implementation
    const startTime = Date.now();
    let result: AIModelResult;
    try {
      result = await this._generateResponse(request);
    } catch (error: any) {
      console.log(`[BaseAIModelProvider.generateResponse CATCH] Caught error: ${error.name}, message: ${error.message}`);
      const latencyMs = Date.now() - startTime;
      this.updateHealthMetrics(false, latencyMs, true); // true indicates a provider error
      return this.standardizeError(error);
    }
    const latencyMs = Date.now() - startTime;

    // 3. Update internal health metrics
    // isProviderError helps distinguish actual provider failures from things like content filters.
    const isProviderError = !result.ok && (result.code !== 'CONTENT' && result.code !== 'AUTH' && result.code !== 'CAPABILITY');
    this.updateHealthMetrics(result.ok, latencyMs, isProviderError);
    
    return result;
  }
  
  private _estimateTokens(request: AIModelRequest): number {
    // Basic estimation, can be refined.
    let historyTokens = 0;
    if (request.context.history) {
      historyTokens = request.context.history.reduce((sum: number, msg: ChatMessage) => sum + Math.ceil(msg.content.length / 4), 0);
    }
    const promptTokens = Math.ceil(request.prompt.length / 4);
    const defaultMaxCompletionTokens = 1024; 
    const completionTokens = request.maxTokens || defaultMaxCompletionTokens;
    return historyTokens + promptTokens + completionTokens;
  }

  // _ensureCircuitStateLoaded REMOVED
  // _handleRequestOutcome REMOVED
  // updateHealthStatusFromCircuit REMOVED (healthStatus.available will be updated by AIModelRouter if needed, or based on local metrics)

  public async canFulfill(request: AIModelRequest): Promise<boolean> {
    // Circuit state check (OPEN) is now handled by AIModelRouter before calling provider.
    // This method now only checks capabilities.

    const modelName = request.preferredModel || this.defaultModel;
    let modelConfig: ModelConfig | undefined;

    try {
      modelConfig = this.getModelCapabilities(modelName);
    } catch (error) {
      console.warn(`[${this.providerName}] Error fetching model capabilities for ${modelName} in canFulfill:`, error);
      return false; // If getModelCapabilities throws (e.g. model not found), then cannot fulfill.
    }

    if (!modelConfig) {
      console.warn(`[${this.providerName}] Model ${modelName} configuration not found or model is inactive (via getModelCapabilities).`);
      return false;
    }

    // Added check for modelConfig.active in line with how AIModelRouter filters models
    if (!modelConfig.active) {
      console.warn(`[${this.providerName}] Model ${modelName} is not active.`);
      return false;
    }

    if (request.requiredCapabilities && request.requiredCapabilities.length > 0) {
      if (!modelConfig.capabilities || modelConfig.capabilities.length === 0) {
        console.warn(`[${this.providerName}] Model ${modelName} has no capabilities defined in its configuration.`);
        return false;
      }
      for (const reqCap of request.requiredCapabilities) {
        if (!modelConfig.capabilities.includes(reqCap)) { 
          console.warn(`[${this.providerName}] Model ${modelName} missing required capability from config: ${reqCap}`);
          return false;
        }
      }
    }

    if (request.tools && request.tools.length > 0 && !modelConfig.functionCallingSupport) {
      console.warn(`[${this.providerName}] Model ${modelName} does not support function calling (tools), but tools were requested.`);
      return false;
    }

    return true;
  }
  
  public async getProviderHealth(): Promise<ProviderHealthStatus> {
    // This now returns the locally maintained health status.
    // AIModelRouter will use CircuitBreakerManager for the authoritative health state for routing.
    this.healthStatus.lastChecked = Date.now();
    // available status might be stale if router hasn't updated it; router is the source of truth for routing.
    return { ...this.healthStatus }; 
  }
  
  protected consumeTokens(tokensToConsume: number): boolean {
    const now = Date.now();
    const elapsedSeconds = (now - this.tokenBucket.lastRefill) / 1000;
    const newTokens = Math.floor(elapsedSeconds * this.tokenBucket.refillRate);
    
    this.tokenBucket.tokens = Math.min(this.tokenBucket.capacity, this.tokenBucket.tokens + newTokens);
    this.tokenBucket.lastRefill = now;

    if (tokensToConsume <= this.tokenBucket.tokens) {
      this.tokenBucket.tokens -= tokensToConsume;
      return true;
    }
    console.warn(`[${this.providerName}] Token bucket exhausted. Requested: ${tokensToConsume}, Available: ${this.tokenBucket.tokens}`);
    return false;
  }

  protected updateHealthMetrics(success: boolean, latencyMs: number, isProviderError: boolean): void {
    // This method updates the local healthStatus. It might be used for observability
    // or as a secondary health signal, but AIModelRouter uses CircuitBreakerManager as primary.
    
    // For simplicity, let's make this basic for now.
    // A more sophisticated implementation would use EWMA for latency and error rate over a window.
    this.healthStatus.latencyP95 = latencyMs; // Simplification: using last latency as P95 for now
    if (!success && isProviderError) {
      this.healthStatus.errorRate = Math.min(1, this.healthStatus.errorRate + 0.1); // Crude increase
    } else if (success) {
      this.healthStatus.errorRate = Math.max(0, this.healthStatus.errorRate - 0.05); // Crude decrease
    }
    // this.healthStatus.available is primarily managed by the router based on CircuitBreakerManager.
    // However, if the token bucket is exhausted, this provider instance is not available.
    if (this.tokenBucket.tokens <= 0) { // A very rough check, may need refinement
        // this.healthStatus.available = false; // Commenting out, router manages this primarily
    }
    this.healthStatus.lastChecked = Date.now();
  }

  protected createError(code: AIModelError['code'], detail: string, status?: number, retryable: boolean = false): AIModelError {
    return {
      ok: false,
      provider: this.providerName,
      code,
      detail,
      status,
      retryable,
    };
  }

  // _getCircuitState REMOVED
  // _updateCircuitState REMOVED

  public getProviderName(): string {
    return this.providerName;
  }
}