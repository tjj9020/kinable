import { AIModelRequest, AIModelResult, ModelCapabilities, ProviderHealthStatus, ProviderLimits, AIModelError } from '../../../../packages/common-types/src/ai-interfaces';
// import { IDatabaseProvider } from '../../../../packages/common-types/src/core-interfaces'; // No longer directly needed for circuit state

// InternalCircuitState interface REMOVED
// Circuit breaker constants REMOVED

export abstract class BaseAIModelProvider {
  protected readonly providerName: string;
  protected healthStatus: ProviderHealthStatus;
  // protected readonly dbProvider: IDatabaseProvider; // No longer needed if circuit state managed by router
  // protected circuitState: InternalCircuitState | null = null; // REMOVED
  protected readonly defaultModel: string;
  protected readonly tokenBucket: { tokens: number; lastRefill: number; capacity: number; refillRate: number };

  constructor(providerName: string, defaultModel: string /*, dbProvider: IDatabaseProvider REMOVED */) {
    this.providerName = providerName;
    this.defaultModel = defaultModel;
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
   * @returns The capabilities of the model, or undefined if the model is not known/supported.
   */
  public abstract getModelCapabilities(modelName: string): ModelCapabilities | undefined;
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
    if (request.context.conversationHistory) {
      historyTokens = request.context.conversationHistory.reduce((sum, msg) => sum + Math.ceil(msg.content.length / 4), 0);
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
    const capabilities = this.getModelCapabilities(modelName);

    if (!capabilities || Object.keys(capabilities).length === 0) {
      console.warn(`[${this.providerName}] Model ${modelName} is unknown or has no capabilities defined.`);
      return false;
    }

    if (request.requiredCapabilities && request.requiredCapabilities.length > 0) {
      for (const reqCap of request.requiredCapabilities) {
        if (!(capabilities as any)[reqCap]) { 
          console.warn(`[${this.providerName}] Model ${modelName} missing required capability: ${reqCap}`);
          return false;
        }
      }
    }

    if (request.tools && request.tools.length > 0 && !capabilities.functionCalling) {
      console.warn(`[${this.providerName}] Model ${modelName} does not support function calling, but tools were requested.`);
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
}