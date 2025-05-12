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
  prompt: string;
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
  context: RequestContext;
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
  canFulfill(request: AIModelRequest): boolean;
  
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
  getProviderHealth(): ProviderHealthStatus;
  
  /**
   * Get rate limits for this provider
   * @returns RPM and TPM limits
   */
  getProviderLimits(): ProviderLimits;
} 