import { RequestContext } from './core-interfaces';

// Provider metadata types
export interface ProviderMeta {
  provider: string;
  model: string;
  features: string[];
  region: string;
  latency: number;
  timestamp: number;
}

// Token usage information
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// Add ChatMessage interface here
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'; // 'system' for system prompts
  content: string;
  // name?: string; // Optional: for tool/function call names, if needed later
}

// Tool/function calling
export interface ToolCall {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  result: unknown;
}

// Success and error result types
export interface AIModelSuccess {
  ok: true;
  text: string;
  tokens: TokenUsage;
  meta: ProviderMeta;
  stream?: AsyncIterable<string>;         // present if streaming enabled
  toolResult?: ToolResult;               // present if function calling used
}

export type AIModelErrorCode = 'RATE_LIMIT' | 'AUTH' | 'CONTENT' | 'CAPABILITY' | 'TIMEOUT' | 'UNKNOWN';

export interface AIModelError {
  ok: false;
  code: AIModelErrorCode;
  provider: string;
  status?: number;        // HTTP / SDK status if available
  retryable: boolean;
  detail?: string;        // provider-specific message
}

export type AIModelResult = AIModelSuccess | AIModelError;

// Request type for model generation
export interface AIModelRequest {
  prompt: string; // Current user prompt
  conversationId?: string; 
  preferredProvider?: string;
  preferredModel?: string;
  maxTokens?: number;
  temperature?: number;
  streaming?: boolean;
  tools?: ToolCall[];
  allowFallbackTools?: boolean;
  requiredCapabilities?: string[]; 
  maxCostPerToken?: number;
  priority?: number;
  context: RequestContext & { // Extend RequestContext specifically for this request type
    conversationHistory?: ChatMessage[];
    // other existing fields from RequestContext like familyId, profileId, userRegion, etc.
  };
}

// Provider capability and health information
export interface ModelCapabilities {
  reasoning: number;      // 1-5 scale
  creativity: number;     // 1-5 scale
  coding: number;         // 1-5 scale
  retrieval: boolean;
  functionCalling: boolean;
  contextSize: number;
  streamingSupport: boolean;
  vision?: boolean;
  toolUse?: boolean;
  configurable?: boolean;
  maxOutputTokens?: number;
  inputCost?: number;
  outputCost?: number;
}

export interface ProviderLimits {
  rpm: number;    // Requests per minute
  tpm: number;    // Tokens per minute
}

export interface ProviderHealthStatus {
  available: boolean;
  errorRate: number;
  latencyP95: number;
  lastChecked: number;
}

// Main AI model provider interface
export interface IAIModelProvider {
  /**
   * Generate a text response from the AI model
   * @param request The request configuration
   * @returns Result containing either success with text or error
   */
  generateResponse(request: AIModelRequest): Promise<AIModelResult>;
  
  /**
   * Check if this provider can fulfill the given request
   * @param request The request to check
   * @returns Whether this provider supports all required capabilities
   */
  canFulfill(request: AIModelRequest): Promise<boolean>;
  
  /**
   * Get detailed capabilities for a specific model
   * @param modelName The model to check
   * @returns Capability ratings and features
   */
  getModelCapabilities(modelName: string): ModelCapabilities;
  
  /**
   * Get current health status of this provider
   * @returns Health metrics and availability
   */
  getProviderHealth(): Promise<ProviderHealthStatus>;
  
  /**
   * Get rate limits for this provider
   * @returns RPM and TPM limits
   */
  getProviderLimits(): ProviderLimits;
}

/**
 * Represents the health state of an AI provider in a specific region,
 * typically stored in DynamoDB for circuit breaker patterns.
 */
export interface ProviderHealthState {
  /**
   * Composite key representing the provider and its region.
   * Format: providerName#region (e.g., "OpenAI#us-east-1")
   */
  providerRegion: string;

  /**
   * Current status of the circuit breaker for this provider.
   * - CLOSED: Provider is considered healthy, requests are allowed.
   * - OPEN: Provider is considered unhealthy, requests are blocked (or routed elsewhere).
   * - HALF_OPEN: A limited number of test requests are allowed to check if the provider has recovered.
   */
  status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';

  /**
   * Number of consecutive failures that have occurred.
   * Reset to 0 upon a successful request when in CLOSED or HALF_OPEN state.
   */
  consecutiveFailures: number;

  /**
   * Number of successes recorded while in the HALF_OPEN state.
   * Reset when transitioning out of HALF_OPEN or into CLOSED.
   */
  currentHalfOpenSuccesses: number;

  /**
   * Total number of failures recorded for this provider.
   * Useful for longer-term monitoring and metrics.
   * Should be periodically reset or managed within a time window if not using TTL for full item expiry.
   */
  totalFailures: number;

  /**
   * Total number of successful requests recorded for this provider.
   * Useful for longer-term monitoring and metrics.
   * Should be periodically reset or managed within a time window if not using TTL for full item expiry.
   */
  totalSuccesses: number;

  /**
   * Timestamp (Unix epoch milliseconds) of the last recorded failure.
   * Used to determine if the cooldown period for OPEN state has passed.
   */
  lastFailureTimestamp?: number; // Optional: might not exist if no failures yet

  /**
   * Timestamp (Unix epoch milliseconds) when the circuit was last moved to the OPEN state.
   * Used in conjunction with a cooldown period to decide when to transition to HALF_OPEN.
   */
  openedTimestamp?: number; // Optional: only relevant when status is OPEN or was recently OPEN

  /**
   * Timestamp (Unix epoch milliseconds) of the last time the status field changed.
   */
  lastStateChangeTimestamp: number;

  /**
   * Latency of the last successful request in milliseconds.
   */
  lastLatencyMs?: number;

  /**
   * Cumulative sum of latencies for successful requests in milliseconds.
   * Used with totalSuccesses to calculate average latency.
   */
  totalLatencyMs: number;

  /**
   * Average latency of successful requests in milliseconds.
   * Can be calculated on write or derived on read.
   */
  avgLatencyMs?: number;
  
  /**
   * DynamoDB Time-to-Live attribute.
   * Unix epoch seconds. Item will be deleted after this time.
   * Useful for automatically cleaning up stale health records if a provider is removed
   * or if we want states to naturally reset if not updated.
   */
  ttl?: number; // Optional: depends on TTL strategy
}

// Configuration for an AI model provider
export interface AIProviderConfig {
  // ... existing code ...
} 