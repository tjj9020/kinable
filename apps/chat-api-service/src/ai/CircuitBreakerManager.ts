import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ProviderHealthState } from "../../../../packages/common-types/src/ai-interfaces";

// Extended interface to include properties used in the code but not in the type definition
interface ExtendedProviderHealthState extends Omit<ProviderHealthState, 'totalLatencyMs'> {
  totalLatencyMs: number | undefined; // Allow undefined for compatibility with original code
  lastLatencyMs?: number;
  avgLatencyMs?: number;
}

// Default configuration for circuit breaker
const DEFAULT_FAILURE_THRESHOLD = 3; // Open circuit after 3 consecutive failures
const DEFAULT_COOLDOWN_PERIOD_MS = 30 * 1000; // 30 seconds cooldown period
const DEFAULT_HALF_OPEN_SUCCESS_THRESHOLD = 2; // Need 2 successes in HALF_OPEN to close
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days for health records

export class CircuitBreakerManager {
    private ddbDocClient: DynamoDBDocumentClient;
    private tableName: string;
    private failureThreshold: number;
    private cooldownPeriodMs: number;
    private halfOpenSuccessThreshold: number;
    private recordTtlSeconds: number;

    constructor(
        ddbDocClient: DynamoDBDocumentClient,
        tableName: string,
        failureThreshold: number = DEFAULT_FAILURE_THRESHOLD,
        cooldownPeriodMs: number = DEFAULT_COOLDOWN_PERIOD_MS,
        halfOpenSuccessThreshold: number = DEFAULT_HALF_OPEN_SUCCESS_THRESHOLD,
        recordTtlSeconds: number = DEFAULT_TTL_SECONDS
    ) {
        this.ddbDocClient = ddbDocClient;
        this.tableName = tableName;
        this.failureThreshold = failureThreshold;
        this.cooldownPeriodMs = cooldownPeriodMs;
        this.halfOpenSuccessThreshold = halfOpenSuccessThreshold;
        this.recordTtlSeconds = recordTtlSeconds;
    }

    /**
     * Retrieves the current health state of a provider from DynamoDB.
     * 
     * @param providerRegion The composite key (e.g., "OpenAI#us-east-1").
     * @returns The current ProviderHealthState or null if not found.
     */
    public async getProviderHealth(providerRegion: string): Promise<ExtendedProviderHealthState | null> {
        const params = {
            TableName: this.tableName,
            Key: {
                providerRegion: providerRegion,
            },
        };

        try {
            const { Item } = await this.ddbDocClient.send(new GetCommand(params));
            return Item ? (Item as ExtendedProviderHealthState) : null;
        } catch (error) {
            console.error(`[CircuitBreakerManager] Error getting provider health for ${providerRegion}:`, error);
            // In case of a DynamoDB error, it's safer to assume the provider might be unhealthy
            // or at least not to allow requests freely. Depending on strategy, could return a default OPEN state.
            // For now, re-throwing allows the caller to decide.
            throw error; 
        }
    }

    /**
     * Creates a default 'CLOSED' state for a provider.
     * @param providerRegion The composite key (e.g., "OpenAI#us-east-1").
     * @returns A new ProviderHealthState object in CLOSED state.
     */
    private getDefaultHealthState(providerRegion: string): ExtendedProviderHealthState {
        const now = Date.now();
        return {
            providerRegion,
            status: 'CLOSED',
            consecutiveFailures: 0,
            currentHalfOpenSuccesses: 0, // Ensure initialized
            totalFailures: 0,
            totalSuccesses: 0,
            lastStateChangeTimestamp: now,
            openedTimestamp: undefined, // Explicitly undefined
            lastFailureTimestamp: undefined, // Explicitly undefined
            totalLatencyMs: 0, // Initialize new field
            // lastLatencyMs and avgLatencyMs will be undefined initially
            ttl: Math.floor(now / 1000) + this.recordTtlSeconds, // TTL is in seconds
        };
    }

    /**
     * Updates the health state of a provider in DynamoDB.
     * @param healthState The new health state of the provider.
     */
    public async updateProviderHealth(healthState: ExtendedProviderHealthState): Promise<void> {
        // Ensure TTL is updated correctly if not already set by the caller for this specific update
        const now = Date.now();
        const newTtl = Math.floor(now / 1000) + this.recordTtlSeconds;
        const stateToSave = {
            ...healthState,
            ttl: healthState.ttl && healthState.ttl > Math.floor(now / 1000) ? healthState.ttl : newTtl,
        };

        const params = {
            TableName: this.tableName,
            Item: stateToSave,
        };
        try {
            await this.ddbDocClient.send(new PutCommand(params));
        } catch (error) {
            console.error(`[CircuitBreakerManager] Error updating provider health for ${healthState.providerRegion}:`, error);
            throw error;
        }
    }

    /**
     * Records a successful interaction with the provider and updates its health state.
     * @param providerRegion The composite key (e.g., "OpenAI#us-east-1").
     * @param durationMs Optional duration of the successful request in milliseconds.
     */
    public async recordSuccess(providerRegion: string, durationMs?: number): Promise<void> {
        let healthState = await this.getProviderHealth(providerRegion);
        const now = Date.now();

        if (!healthState) {
            healthState = this.getDefaultHealthState(providerRegion);
        }

        healthState.totalSuccesses += 1;
        healthState.lastStateChangeTimestamp = now; // Always update for activity tracking, even if status doesn't change

        if (durationMs !== undefined) {
            healthState.lastLatencyMs = durationMs;
            healthState.totalLatencyMs = (healthState.totalLatencyMs || 0) + durationMs;
            if (healthState.totalSuccesses > 0) {
                healthState.avgLatencyMs = healthState.totalLatencyMs / healthState.totalSuccesses;
            }
        }

        switch (healthState.status) {
            case 'OPEN':
                // This case should ideally not happen if isRequestAllowed is working correctly.
                // A success when OPEN means something is odd, or it's a manual override/test.
                // We could log this as an anomaly. For now, let it transition as if it was HALF_OPEN
                // to allow recovery if it was a fluke.
                console.warn(`[CircuitBreakerManager] Recorded success for ${providerRegion} while status was OPEN. Evaluating as HALF_OPEN success.`);
                // Intentional fall-through to HALF_OPEN logic for recovery
            case 'HALF_OPEN':
                // In HALF_OPEN, successes count towards closing the circuit.
                // We need a way to track successes specifically within the HALF_OPEN state.
                // Let's assume for now totalSuccesses in HALF_OPEN phase is implicitly tracked by consecutive successes
                // leading to a state change, or we can add a dedicated field if complex counting is needed.
                // For simplicity, if *any* success occurs in HALF_OPEN and consecutiveFailures was reset by a previous success,
                // let's count it towards the threshold to close.
                // A more robust way is to have a temporary success counter for HALF_OPEN, reset upon entering HALF_OPEN.
                // Let's use totalSuccesses as a proxy for now and assume it gets reset implicitly on state change to CLOSED.

                // If consecutiveFailures is 0, it means the last attempt(s) in HALF_OPEN were successful.
                // We will transition to CLOSED after a configured number of such successes.
                // A simple way: if a success happens in half-open, we consider it a step towards closing.
                // The actual count is managed by an external counter or by looking at recent successes.
                // For this iteration, let's assume if we get a success in HALF_OPEN, we move to CLOSED.
                // This is a simplification. A real implementation might require N successes in HALF_OPEN.
                // The prompt asks for `this.halfOpenSuccessThreshold`.
                // Let's simulate this by checking if `totalSuccesses` (since entering HALF_OPEN) meets threshold.
                // This requires `totalSuccesses` to be reset or scoped to the HALF_OPEN attempt window.
                // Alternative: Simply transition on first success in HALF_OPEN for now and refine later if needed.

                // Correct logic for HALF_OPEN to CLOSED transition based on halfOpenSuccessThreshold:
                // We need a counter for successes during HALF_OPEN. Let's add it to ProviderHealthState if not there.
                // For now, let's assume consecutiveFailures being 0 means last one was success, and we need N such.
                // This is still not quite right. A dedicated `halfOpenSuccesses` counter is better.

                // Let's use a simpler approach for now: if it was HALF_OPEN and a success occurred, 
                // and consecutive failures is 0, then close it.
                // This implies halfOpenSuccessThreshold is 1 for this simplified version.
                // Let's stick to the provided field `this.halfOpenSuccessThreshold`
                // We need to increment a counter specific to HALF_OPEN successes.
                // Adding `currentHalfOpenSuccesses` to ProviderHealthState implicitly for this logic block.
                let currentHalfOpenSuccesses = healthState.currentHalfOpenSuccesses || 0;
                currentHalfOpenSuccesses++;

                if (currentHalfOpenSuccesses >= this.halfOpenSuccessThreshold) {
                    console.log(`[CircuitBreakerManager] ${providerRegion} transitioning from HALF_OPEN to CLOSED after ${currentHalfOpenSuccesses} successes.`);
                    healthState.status = 'CLOSED';
                    healthState.consecutiveFailures = 0;
                    healthState.currentHalfOpenSuccesses = 0; // Reset for next time
                } else {
                    // Still in HALF_OPEN, but one more success recorded
                    healthState.currentHalfOpenSuccesses = currentHalfOpenSuccesses;
                }
                break;

            case 'CLOSED':
                healthState.consecutiveFailures = 0; // Reset on any success
                // `totalSuccesses` already incremented
                // `lastStateChangeTimestamp` already updated
                break;
        }

        await this.updateProviderHealth(healthState);
    }

    // Placeholder for recordFailure
    public async recordFailure(providerRegion: string, durationMs?: number): Promise<void> {
        let healthState = await this.getProviderHealth(providerRegion);
        const now = Date.now();

        if (!healthState) {
            healthState = this.getDefaultHealthState(providerRegion);
        }

        healthState.consecutiveFailures += 1;
        healthState.totalFailures += 1;
        healthState.lastFailureTimestamp = now;
        healthState.lastStateChangeTimestamp = now; // Always update for activity tracking

        // If durationMs is provided, update latency metrics
        if (durationMs !== undefined) {
            healthState.lastLatencyMs = durationMs;
            // We still track latency for failed requests separately from success latency
            healthState.totalLatencyMs = (healthState.totalLatencyMs || 0) + durationMs;
        }

        switch (healthState.status) {
            case 'HALF_OPEN':
                // Any failure in HALF_OPEN state immediately transitions back to OPEN
                console.log(`[CircuitBreakerManager] ${providerRegion} transitioning from HALF_OPEN to OPEN due to failure.`);
                healthState.status = 'OPEN';
                healthState.openedTimestamp = now;
                healthState.currentHalfOpenSuccesses = 0; // Reset half-open success counter
                break;

            case 'CLOSED':
                if (healthState.consecutiveFailures >= this.failureThreshold) {
                    console.log(`[CircuitBreakerManager] ${providerRegion} transitioning from CLOSED to OPEN after ${healthState.consecutiveFailures} failures.`);
                    healthState.status = 'OPEN';
                    healthState.openedTimestamp = now;
                    healthState.currentHalfOpenSuccesses = 0; // Reset for when it eventually goes to HALF_OPEN
                }
                // If not enough consecutive failures to open, it remains CLOSED but counts are updated.
                break;

            case 'OPEN':
                // Already OPEN, just update counts and timestamps
                // The openedTimestamp remains from when it first opened, until it transitions out of OPEN.
                console.log(`[CircuitBreakerManager] ${providerRegion} recorded additional failure while already OPEN.`);
                break;
        }
        
        await this.updateProviderHealth(healthState);
    }

    /**
     * Determines if a request should be allowed to the provider based on its circuit breaker state.
     * Handles state transitions (e.g., OPEN to HALF_OPEN after cooldown).
     * @param providerRegion The composite key (e.g., "OpenAI#us-east-1").
     * @returns True if the request is allowed, false otherwise.
     */
    public async isRequestAllowed(providerRegion: string): Promise<boolean> {
        let healthState = await this.getProviderHealth(providerRegion);
        const now = Date.now();

        if (!healthState) {
            console.log(`[CircuitBreakerManager] No health state for ${providerRegion}. Creating default and allowing request.`);
            healthState = this.getDefaultHealthState(providerRegion);
            await this.updateProviderHealth(healthState);
            return true; // Allow request for new/unknown provider
        }

        switch (healthState.status) {
            case 'CLOSED':
                return true; // Circuit is closed, requests are allowed

            case 'OPEN':
                if (healthState.openedTimestamp && (healthState.openedTimestamp + this.cooldownPeriodMs < now)) {
                    // Cooldown period has passed, transition to HALF_OPEN
                    console.log(`[CircuitBreakerManager] ${providerRegion} transitioning from OPEN to HALF_OPEN after cooldown.`);
                    healthState.status = 'HALF_OPEN';
                    healthState.consecutiveFailures = 0; // Reset for half-open attempts
                    healthState.currentHalfOpenSuccesses = 0; // Reset for half-open attempts
                    healthState.lastStateChangeTimestamp = now;
                    await this.updateProviderHealth(healthState);
                    return true; // Allow the first test request in HALF_OPEN state
                } else {
                    // Still in cooldown period
                    console.log(`[CircuitBreakerManager] Request to ${providerRegion} blocked. Circuit is OPEN and in cooldown.`);
                    return false; 
                }

            case 'HALF_OPEN':
                // Allow requests in HALF_OPEN state for testing the provider
                // Success/failure will be recorded by recordSuccess/recordFailure to transition state
                console.log(`[CircuitBreakerManager] Allowing test request to ${providerRegion} in HALF_OPEN state.`);
                return true; 

            default:
                // Should not happen with a valid ProviderHealthState
                console.warn(`[CircuitBreakerManager] Unknown status for ${providerRegion}: ${healthState.status}. Blocking request.`);
                return false;
        }
    }
} 