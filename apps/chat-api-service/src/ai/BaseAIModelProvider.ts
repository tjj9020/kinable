import { AIModelRequest, AIModelResult, ModelCapabilities, ProviderHealthStatus, ProviderLimits, AIModelError } from '../../../../packages/common-types/src/ai-interfaces';
import { IDatabaseProvider } from '../../../../packages/common-types/src/core-interfaces';

// Represents the persisted state of the circuit breaker in DynamoDB.
interface InternalCircuitState {
  providerRegion: string; // PK, e.g., "openai#us-east-1"
  status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  consecutiveFailures: number;
  successesInHalfOpen: number;
  lastFailureTimestamp?: number;
  lastStateChangeTimestamp: number;
  // Optional: Could also store snapshot of errorRate/latency that led to state change
}

// Constants for circuit breaker logic
const FAILURE_THRESHOLD = 5; // Open circuit after 5 consecutive failures
const HALF_OPEN_SUCCESS_THRESHOLD = 3; // Need 3 successes in HALF_OPEN to close
const OPEN_STATE_COOLDOWN_MS = 60 * 1000; // 1 minute cooldown before trying HALF_OPEN

export abstract class BaseAIModelProvider {
  protected readonly providerName: string;
  protected healthStatus: ProviderHealthStatus;
  protected readonly dbProvider: IDatabaseProvider;
  protected circuitState: InternalCircuitState | null = null;
  protected readonly defaultModel: string;
  protected readonly tokenBucket: { tokens: number; lastRefill: number; capacity: number; refillRate: number };

  constructor(providerName: string, defaultModel: string, dbProvider: IDatabaseProvider) {
    this.providerName = providerName;
    this.defaultModel = defaultModel;
    this.dbProvider = dbProvider;
    this.healthStatus = {
      available: true,
      errorRate: 0,
      latencyP95: 0,
      lastChecked: Date.now(),
    };
    // Initialize token bucket. Capacity and refillRate are based on tpm.
    // This assumes getProviderLimits() is available and provides valid tpm at construction.
    const limits = this.getProviderLimits();
    this.tokenBucket = {
      tokens: limits.tpm,
      lastRefill: Date.now(),
      capacity: limits.tpm,
      refillRate: limits.tpm / 60 // Refill TPM over 60 seconds
    };
  }

  // Must be implemented by concrete classes
  abstract getProviderLimits(): ProviderLimits;
  abstract getModelCapabilities(modelName: string): ModelCapabilities;
  protected abstract _generateResponse(request: AIModelRequest): Promise<AIModelResult>;
  protected abstract standardizeError(error: any): AIModelError;

  public async generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    const operationalRegion = request.context.region;
    await this._ensureCircuitStateLoaded(operationalRegion);

    if (!this.circuitState) { // Should not happen if _ensureCircuitStateLoaded works
        console.error(`[${this.providerName}] Circuit state not loaded for region ${operationalRegion}.`);
        // Attempt to load again, or use a default 'CLOSED' state to prevent total blockage if DB is temporarily down.
        // Forcing a load here one more time before failing.
        this.circuitState = await this._getCircuitState(operationalRegion); 
        if(!this.circuitState){ // If still not loaded (e.g. _getCircuitState returned a default due to DB error and console logged)
             return this.createError('UNKNOWN', 'Circuit breaker state could not be determined after retry.', undefined, true);
        }
    }
    
    // 1. Check Circuit Breaker State
    if (this.circuitState.status === 'OPEN') {
      if (Date.now() - this.circuitState.lastStateChangeTimestamp > OPEN_STATE_COOLDOWN_MS) {
        // Cooldown elapsed, try transitioning to HALF_OPEN
        console.log(`[${this.providerName}] Circuit OPEN, cooldown elapsed. Transitioning to HALF_OPEN for ${this.circuitState.providerRegion}`);
        this.circuitState.status = 'HALF_OPEN';
        this.circuitState.successesInHalfOpen = 0; // Reset counter for HALF_OPEN attempts
        this.circuitState.consecutiveFailures = 0; // Reset failures as we are trying again
        this.circuitState.lastStateChangeTimestamp = Date.now();
        // Persist this change immediately
        await this._updateCircuitState(this.circuitState);
      } else {
        // Still in cooldown for OPEN state
        // console.log(`[${this.providerName}] Circuit OPEN and in cooldown for ${this.circuitState.providerRegion}. Request rejected.`);
        this.updateHealthStatusFromCircuit(); // Ensure healthStatus.available is false
        return this.createError('UNKNOWN', `[${this.providerName}] Provider is temporarily unavailable (circuit open).`, 503, true);
      }
    }
    
    // If in HALF_OPEN, we allow the request to proceed for testing the provider.
    // The outcome will determine if we move to OPEN or CLOSED.

    // 2. Token consumption check (moved after circuit breaker check for OPEN state)
    const estimatedTotalTokens = this._estimateTokens(request);
    if (!this.consumeTokens(estimatedTotalTokens)) {
        this.updateHealthMetrics(false, 0, false); // Record as a bucket exhaustion, not a provider error for circuit
        this.updateHealthStatusFromCircuit(); // Update healthStatus.available based on current circuit state
        return this.createError(
            'RATE_LIMIT',
            `[${this.providerName}] Estimated token consumption exceeds provider TPM/RPM limits.`,
            429,
            true
        );
    }

    // 3. Call actual provider implementation
    const startTime = Date.now();
    let result: AIModelResult;
    try {
      result = await this._generateResponse(request);
    } catch (error: any) {
      console.log(`[BaseAIModelProvider.generateResponse CATCH] Caught error: ${error.name}, message: ${error.message}`); // Log caught error
      const latencyMs = Date.now() - startTime;
      this.updateHealthMetrics(false, latencyMs, true);
      await this._handleRequestOutcome(false, operationalRegion, true);
      this.updateHealthStatusFromCircuit();
      return this.standardizeError(error);
    }
    const latencyMs = Date.now() - startTime;

    // 4. Update circuit breaker based on outcome
    // A provider error is when result.ok is false AND it's a retryable error (e.g. timeout, rate limit from provider, server error)
    // not a non-retryable one like auth or content filter.
    const isProviderError = !result.ok && (result.code !== 'CONTENT' && result.code !== 'AUTH' && result.code !== 'CAPABILITY');
    this.updateHealthMetrics(result.ok, latencyMs, isProviderError); // Pass true provider error status
    await this._handleRequestOutcome(result.ok, operationalRegion, isProviderError);
    this.updateHealthStatusFromCircuit(); // Update healthStatus.available based on final circuit state
    
    return result;
  }
  
  private _estimateTokens(request: AIModelRequest): number {
    // Basic estimation, can be refined.
    let historyTokens = 0;
    if (request.context.conversationHistory) {
      historyTokens = request.context.conversationHistory.reduce((sum, msg) => sum + Math.ceil(msg.content.length / 4), 0);
    }
    const promptTokens = Math.ceil(request.prompt.length / 4);
    const defaultMaxCompletionTokens = 1024; // Consistent with Anthropic and OpenAI defaults
    const completionTokens = request.maxTokens || defaultMaxCompletionTokens;
    return historyTokens + promptTokens + completionTokens;
  }

  private async _ensureCircuitStateLoaded(region: string): Promise<void> {
    if (this.circuitState && this.circuitState.providerRegion === `${this.providerName}#${region}`) {
      // Already loaded for the correct provider and region
      return;
    }
    // Fetch or load default
    this.circuitState = await this._getCircuitState(region);
  }

  private async _handleRequestOutcome(success: boolean, region: string, isProviderError: boolean): Promise<void> {
    if (!this.circuitState || this.circuitState.providerRegion !== `${this.providerName}#${region}`) {
      console.error(`[${this.providerName}] Circuit state mismatch or not loaded in _handleRequestOutcome for region ${region}. Forcing reload.`);
      this.circuitState = await this._getCircuitState(region); 
    }

    // Ensure circuitState is not null after attempt to load.
    // If _getCircuitState returned a default due to DB error, this.circuitState will be that default.
    if (!this.circuitState) {
        console.error(`[${this.providerName}] CRITICAL: Circuit state is null in _handleRequestOutcome after attempting load for ${region}. Aborting state update.`);
        return; 
    }

    const state = this.circuitState;

    if (success) {
      if (state.status === 'HALF_OPEN') {
        state.successesInHalfOpen += 1;
        if (state.successesInHalfOpen >= HALF_OPEN_SUCCESS_THRESHOLD) {
          console.log(`[${this.providerName}] Circuit breached HALF_OPEN success threshold for ${state.providerRegion}. Transitioning to CLOSED.`);
          state.status = 'CLOSED';
          state.consecutiveFailures = 0;
          state.lastStateChangeTimestamp = Date.now();
        }
      } else if (state.status === 'CLOSED') {
        state.consecutiveFailures = 0; // Reset on any success in CLOSED state
      }
      // No change to consecutiveFailures or status if OPEN (should not happen here as OPEN state rejects earlier)
    } else if (isProviderError) { // Only count qualifying provider errors against circuit
      state.consecutiveFailures += 1;
      state.lastFailureTimestamp = Date.now();
      if (state.status === 'HALF_OPEN') {
        console.log(`[${this.providerName}] Circuit failed in HALF_OPEN for ${state.providerRegion}. Transitioning to OPEN.`);
        state.status = 'OPEN';
        state.successesInHalfOpen = 0; // Reset half-open successes
        state.lastStateChangeTimestamp = Date.now();
      } else if (state.status === 'CLOSED' && state.consecutiveFailures >= FAILURE_THRESHOLD) {
        console.log(`[${this.providerName}] Circuit breached CLOSED failure threshold for ${state.providerRegion}. Transitioning to OPEN.`);
        state.status = 'OPEN';
        state.successesInHalfOpen = 0; // Reset for when it eventually goes to half-open
        state.lastStateChangeTimestamp = Date.now();
      }
    }
    // If not a success and not a provider error (e.g. content filter), no change to circuit state counts.
    await this._updateCircuitState(state);
  }
  
  private updateHealthStatusFromCircuit(): void {
    if (this.circuitState) {
        this.healthStatus.available = this.circuitState.status !== 'OPEN';
    } else {
        // Default to available if circuit state somehow isn't loaded.
        // This path should ideally not be hit if _ensureCircuitStateLoaded is effective.
        this.healthStatus.available = true; 
        console.warn(`[${this.providerName}] updateHealthStatusFromCircuit called but circuitState is null.`);
    }
  }

  public async canFulfill(request: AIModelRequest): Promise<boolean> {
    if (this.circuitState && this.circuitState.status === 'OPEN') {
      return false;
    }

    // console.log(`[BaseAIModelProvider.canFulfill DEBUG] request.preferredModel: ${request.preferredModel}, this.defaultModel: ${this.defaultModel}`);
    const modelName = request.preferredModel || this.defaultModel;
    const capabilities = this.getModelCapabilities(modelName);

    // If no capabilities are defined for the model, it's considered unknown/unsupported.
    if (!capabilities || Object.keys(capabilities).length === 0) {
      console.warn(`[${this.providerName}] Model ${modelName} is unknown or has no capabilities defined.`);
      return false;
    }

    // Check if requiredCapabilities are met
    if (request.requiredCapabilities && request.requiredCapabilities.length > 0) {
      for (const reqCap of request.requiredCapabilities) {
        if (!(capabilities as any)[reqCap]) { 
          console.warn(`[${this.providerName}] Model ${modelName} missing required capability: ${reqCap}`);
          return false;
        }
      }
    }

    // Check for tool usage vs function calling capability
    if (request.tools && request.tools.length > 0 && !capabilities.functionCalling) {
      console.warn(`[${this.providerName}] Model ${modelName} does not support function calling, but tools were requested.`);
      return false;
    }

    return true;
  }
  
  public async getProviderHealth(): Promise<ProviderHealthStatus> { // Made async
    // Attempt to load circuit state for a "default" or "current context" region if not already loaded.
    // This is tricky if there's no active request context. For now, uses existing this.circuitState.
    // A more robust getProviderHealth might require a region parameter.
    if (this.circuitState) { // If some state is cached, use its region
        await this._ensureCircuitStateLoaded(this.circuitState.providerRegion.split('#')[1]);
    } else {
        // TODO: Determine a default region or handle if no region context is available.
        // For now, if no circuitState, it will reflect the initial healthStatus.
        console.warn(`[${this.providerName}] getProviderHealth called without an active circuit state. Health may be optimistic.`);
    }
    this.updateHealthStatusFromCircuit();
    return this.healthStatus; 
  }

  protected consumeTokens(tokensToConsume: number): boolean {
    const now = Date.now();
    const elapsedSeconds = (now - this.tokenBucket.lastRefill) / 1000;
    
    const tokensToAdd = Math.floor(elapsedSeconds * this.tokenBucket.refillRate);
    if (tokensToAdd > 0) {
      this.tokenBucket.tokens = Math.min(this.tokenBucket.capacity, this.tokenBucket.tokens + tokensToAdd);
      this.tokenBucket.lastRefill = now; 
    }

    if (this.tokenBucket.tokens >= tokensToConsume) {
      this.tokenBucket.tokens -= tokensToConsume;
      return true;
    }
    return false;
  }

  protected updateHealthMetrics(success: boolean, latencyMs: number, isProviderError: boolean): void {
    // Using Exponentially Weighted Moving Average (EWMA) for errorRate and latencyP95
    const alpha = 0.1; // Smoothing factor for EWMA; smaller alpha = more smoothing

    if (isProviderError) { 
        this.healthStatus.errorRate = 
            (alpha * (success ? 0 : 1)) + ((1 - alpha) * this.healthStatus.errorRate);
    }
    
    this.healthStatus.latencyP95 = 
        (alpha * latencyMs) + ((1 - alpha) * this.healthStatus.latencyP95);
    
    this.healthStatus.lastChecked = Date.now();
    // console.log(`[${this.providerName}] Health metrics updated: Success=${success}, Latency=${latencyMs}ms, IsProviderError=${isProviderError}, ErrorRate=${this.healthStatus.errorRate.toFixed(3)}`);
  }

  protected createError(code: AIModelError['code'], detail: string, status?: number, retryable: boolean = false): AIModelError {
    console.log(`[BaseAIModelProvider.createError] Code: ${code}, Detail: ${detail}`); // Log createError call
    return {
      ok: false, provider: this.providerName, code, status, retryable, detail,
    };
  }

  // --- Circuit Breaker DynamoDB Methods ---

  protected async _getCircuitState(region: string): Promise<InternalCircuitState> {
    const compositeKey = `${this.providerName}#${region}`;
    const tableName = process.env.PROVIDER_HEALTH_TABLE;

    if (!tableName) {
        console.error(`[${this.providerName}] PROVIDER_HEALTH_TABLE environment variable not set. Cannot fetch circuit state for ${compositeKey}. Returning default CLOSED state.`);
        return {
            providerRegion: compositeKey, status: 'CLOSED', consecutiveFailures: 0,
            successesInHalfOpen: 0, lastStateChangeTimestamp: Date.now()
        };
    }

    try {
      // Assumes dbProvider.getItem can handle this specific table's keying by using 'region'
      // to determine if its own default regional prefixing applies, or if 'compositeKey' is used directly.
      const item = await this.dbProvider.getItem<InternalCircuitState>(
        tableName, 
        'providerRegion', // The actual HASH key attribute name in ProviderHealthTable
        compositeKey,     // The value for the HASH key (e.g., "openai#us-east-1")
        region            // Operational region, hint for DynamoDBProvider
      );

      if (item && typeof item === 'object' && item.status) {
        // console.log(`[${this.providerName}] Fetched circuit state for ${compositeKey}:`, item.status);
        return item; 
      } else {
        // console.log(`[${this.providerName}] No existing circuit state found for ${compositeKey} or item malformed. Returning default.`);
      }
    } catch (error) {
      console.error(`[${this.providerName}] Error fetching circuit state for ${compositeKey} from DB:`, error);
    }
    
    // Default state if not found, error during fetch, or first time.
    // console.log(`[${this.providerName}] Returning default CLOSED circuit state for ${compositeKey}.`);
    return {
        providerRegion: compositeKey,
        status: 'CLOSED',
        consecutiveFailures: 0,
        successesInHalfOpen: 0,
        lastStateChangeTimestamp: Date.now(),
    };
  }

  protected async _updateCircuitState(newState: InternalCircuitState): Promise<void> {
    const tableName = process.env.PROVIDER_HEALTH_TABLE;
    if (!tableName) {
        console.error(`[${this.providerName}] PROVIDER_HEALTH_TABLE environment variable not set. Cannot update circuit state for ${newState.providerRegion}.`);
        return;
    }
    try {
      // Extract the region part from the composite key newState.providerRegion for the userRegion argument
      const region = newState.providerRegion.split('#')[1] || 'unknown'; // Fallback if split fails
      await this.dbProvider.putItem(
        tableName,
        newState, 
        'providerRegion', // keyAttributeName
        region            // userRegion (extracted from composite key)
      );
    } catch (dbError) {
      console.error(`[${this.providerName}] Failed to update circuit state in DynamoDB for ${newState.providerRegion}:`, dbError);
    }
  }
}