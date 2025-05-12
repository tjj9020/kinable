/**
 * Provider configuration schema
 * This defines the structure for configuration stored in the ProviderConfiguration DynamoDB table
 */

// Model-specific configuration
export interface ModelConfig {
  tokenCost: number;       // Cost per 1K tokens
  priority: number;        // Priority for routing (lower is better)
  capabilities: string[];  // List of capabilities this model provides
  contextSize: number;     // Maximum token context size
  streamingSupport: boolean; // Whether this model supports streaming
  functionCalling: boolean;  // Whether this model supports function calling
  active: boolean;         // Whether this model is currently enabled
  rolloutPercentage: number; // Percentage of users who should get this model (0-100)
}

// Regional endpoint configuration
export interface EndpointConfig {
  url: string;             // API endpoint URL
  region: string;          // AWS region for this endpoint
  priority: number;        // Priority for this endpoint (lower is better)
  active: boolean;         // Whether this endpoint is currently enabled
}

// Provider configuration
export interface ProviderConfig {
  active: boolean;         // Whether this provider is currently enabled
  keyVersion: number;      // Current key version
  endpoints: Record<string, EndpointConfig>; // Region-specific endpoints
  models: Record<string, ModelConfig>;      // Available models from this provider
  rateLimits: {
    rpm: number;           // Requests per minute
    tpm: number;           // Tokens per minute
  };
  retryConfig: {
    maxRetries: number;    // Maximum number of retries
    initialDelayMs: number; // Initial delay between retries (ms)
    maxDelayMs: number;    // Maximum delay between retries (ms)
  };
  apiVersion: string;      // Provider API version to use
  rolloutPercentage: number; // Percentage of users who should use this provider (0-100)
}

// Routing rule definition
export interface RoutingRule {
  type: 'capability' | 'costLimit' | 'priority' | 'region'; // Rule type
  // Capability rule
  required?: string[];     // Required capabilities
  preferredProvider?: string; // Provider to prefer if requirements met
  // Cost rule
  maxTokenCost?: number;   // Maximum token cost allowed
  action?: 'useModel' | 'fallback' | 'reject'; // Action to take if cost exceeds limit
  model?: string;          // Model to use for 'useModel' action
  // Priority rule
  minPriority?: number;    // Minimum priority required
  // Region rule
  regions?: string[];      // Regions this rule applies to
}

// Complete configuration structure
export interface ProviderConfiguration {
  version: string;         // Configuration version (semver)
  updatedAt: number;       // Timestamp of last update
  providers: Record<string, ProviderConfig>; // All provider configurations
  routing: {
    rules: RoutingRule[];  // Routing rules in priority order
    weights: {             // Weights for the routing algorithm
      cost: number;        // Weight for cost (0-1)
      quality: number;     // Weight for quality/capability (0-1)
      latency: number;     // Weight for latency (0-1)
      availability: number; // Weight for availability (0-1)
    };
    defaultProvider: string; // Default provider if no rules match
    defaultModel: string;   // Default model if not specified
  };
  featureFlags: Record<string, boolean>; // Feature flags
}

// Default configuration values
export const DEFAULT_ROUTING_WEIGHTS = {
  cost: 0.4,
  quality: 0.3,
  latency: 0.2,
  availability: 0.1
};

// Validation functions (can be expanded as needed)
export function validateConfiguration(config: ProviderConfiguration): string[] {
  const errors: string[] = [];
  
  // Check that weights sum to 1.0
  const weights = config.routing.weights;
  const weightSum = weights.cost + weights.quality + weights.latency + weights.availability;
  if (Math.abs(weightSum - 1.0) > 0.001) {
    errors.push(`Routing weights must sum to 1.0, got ${weightSum}`);
  }
  
  // Check that defaultProvider exists
  if (!config.providers[config.routing.defaultProvider]) {
    errors.push(`Default provider "${config.routing.defaultProvider}" not found in providers`);
  }
  
  // Check that all provider models have required fields
  Object.entries(config.providers).forEach(([providerName, provider]) => {
    if (!provider.active && provider.rolloutPercentage > 0) {
      errors.push(`Provider "${providerName}" has rolloutPercentage > 0 but is not active`);
    }
    
    Object.entries(provider.models).forEach(([modelName, model]) => {
      if (!model.active && model.rolloutPercentage > 0) {
        errors.push(`Model "${modelName}" for provider "${providerName}" has rolloutPercentage > 0 but is not active`);
      }
    });
  });
  
  return errors;
} 