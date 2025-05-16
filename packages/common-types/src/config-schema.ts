/**
 * Provider configuration schema
 * This defines the structure for configuration stored in the ProviderConfiguration DynamoDB table
 */

// Model-specific configuration
export interface ModelConfig {
  name: string; // Display name, e.g., "GPT-4 Omni"
  description?: string; // Model description
  
  costPerMillionInputTokens: number;  // Cost per 1 Million input tokens
  costPerMillionOutputTokens: number; // Cost per 1 Million output tokens
  
  contextWindow: number;   // Maximum token context window size
  maxOutputTokens?: number; // Maximum number of tokens to generate

  capabilities: string[];  // List of general capabilities (e.g., "vision", "coding")
  streamingSupport: boolean; // Whether this model supports streaming
  functionCallingSupport: boolean;  // Whether this model supports function calling/tools
  visionSupport: boolean; // Whether this model supports vision/image inputs

  active: boolean;         // Whether this model is currently enabled
  
  // Optional fields for advanced routing/rollout
  priority?: number;        // Priority for routing (lower is better, e.g., for A/B testing specific models)
  rolloutPercentage?: number; // Percentage of users who should get this model (0-100 for canary)
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
  active: boolean;
  secretId: string;        // AWS Secrets Manager secret ID for API keys (template: kinable-{env}/{region}/{provider}/api-key)
  defaultModel?: string;    // Optional: Default model for this specific provider
  models: Record<string, ModelConfig>; // Available models from this provider, keyed by modelId

  // Optional provider-level settings, can be overridden by global routing if needed
  keyVersion?: number;      // Current key version (if provider supports key rotation via API)
  endpoints?: Record<string, EndpointConfig>; // Region-specific endpoints, if provider requires it
  rateLimits?: {
    rpm?: number;           // Requests per minute
    tpm?: number;           // Tokens per minute
  };
  retryConfig?: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };
  apiVersion?: string;      // Provider API version to use (if applicable)
  rolloutPercentage?: number; // Percentage of users who should use this provider (0-100 for canary)
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

// Complete configuration structure for a single configId (e.g., "GLOBAL_AISERVICE_CONFIG_V1")
// This represents the attributes of the DynamoDB item.
export interface AiServiceConfiguration {
  configVersion: string;   // Version of this configuration data structure itself (e.g., "1.0.0", "1.1.0")
  schemaVersion: string;   // Version of this AiServiceConfiguration schema (e.g. "1.0.0")
  updatedAt: string;       // ISO 8601 timestamp of last update
  
  providers: Record<string, ProviderConfig>; // All provider configurations, keyed by providerId (e.g., "openai")
  
  routing: {
    rules?: RoutingRule[];  // Routing rules in priority order
    weights?: {             // Weights for the routing algorithm
      cost: number;
      quality: number;
      latency: number;
      availability: number;
    };
    providerPreferenceOrder: string[]; // Ordered list of provider names to try for fallback
    defaultModel?: string;   // Global default model if not specified by provider or request
  };
  featureFlags?: Record<string, boolean>; // Feature flags
}

// Default configuration values
export const DEFAULT_ROUTING_WEIGHTS = {
  cost: 0.4,
  quality: 0.3,
  latency: 0.2,
  availability: 0.1
};

// Validation functions (can be expanded as needed)
export function validateAiServiceConfiguration(config: AiServiceConfiguration): string[] {
  const errors: string[] = [];

  // Validate timestamp
  if (isNaN(Date.parse(config.updatedAt))) {
    errors.push(`updatedAt is not a valid ISO 8601 timestamp: ${config.updatedAt}`);
  }

  // Check that weights sum to 1.0 if they exist
  if (config.routing.weights) {
    const weights = config.routing.weights;
    const weightSum = weights.cost + weights.quality + weights.latency + weights.availability;
    if (Math.abs(weightSum - 1.0) > 0.001) {
      errors.push(`Routing weights must sum to 1.0, got ${weightSum}`);
    }
  }
  
  // Check that providerPreferenceOrder is not empty and all its providers exist
  if (!config.routing.providerPreferenceOrder || config.routing.providerPreferenceOrder.length === 0) {
    errors.push('routing.providerPreferenceOrder cannot be empty.');
  } else {
    config.routing.providerPreferenceOrder.forEach(providerName => {
      if (!config.providers[providerName]) {
        errors.push(`Provider "${providerName}" in routing.providerPreferenceOrder not found in providers list.`);
      } else if (!config.providers[providerName].active) {
        // It's a warning if a preferred provider is inactive, but might be intentional for temporary disabling.
        // console.warn(`Provider "${providerName}" in routing.providerPreferenceOrder is currently inactive.`);
      }
    });
  }
  
  // Check provider and model configurations
  Object.entries(config.providers).forEach(([providerName, provider]) => {
    if (provider.rolloutPercentage && (provider.rolloutPercentage < 0 || provider.rolloutPercentage > 100)) {
      errors.push(`Provider "${providerName}" has invalid rolloutPercentage: ${provider.rolloutPercentage}`);
    }
    if (provider.active === false && provider.rolloutPercentage && provider.rolloutPercentage > 0) {
      errors.push(`Provider "${providerName}" has rolloutPercentage > 0 but is not active.`);
    }
    if (!provider.secretId || !provider.secretId.includes('{env}') || !provider.secretId.includes('{region}')) {
        errors.push(`Provider "${providerName}" secretId is missing or not correctly templated with {env} and {region}. Found: ${provider.secretId}`);
    }

    if (!provider.models || Object.keys(provider.models).length === 0) {
      errors.push(`Provider "${providerName}" has no models defined.`);
      return;
    }

    Object.entries(provider.models).forEach(([modelId, model]) => {
      if (!model.name) errors.push(`Model "${modelId}" for provider "${providerName}" is missing a name.`);
      if (model.costPerMillionInputTokens === undefined || model.costPerMillionInputTokens < 0) errors.push(`Model "${modelId}" for provider "${providerName}" has invalid or missing costPerMillionInputTokens.`);
      if (model.costPerMillionOutputTokens === undefined || model.costPerMillionOutputTokens < 0) errors.push(`Model "${modelId}" for provider "${providerName}" has invalid or missing costPerMillionOutputTokens.`);
      if (!model.contextWindow || model.contextWindow <= 0) errors.push(`Model "${modelId}" for provider "${providerName}" has invalid or missing contextWindow.`);
      if (!model.capabilities || model.capabilities.length === 0) errors.push(`Model "${modelId}" for provider "${providerName}" has no capabilities defined.`);
      
      if (model.rolloutPercentage && (model.rolloutPercentage < 0 || model.rolloutPercentage > 100)) {
        errors.push(`Model "${modelId}" for provider "${providerName}" has invalid rolloutPercentage: ${model.rolloutPercentage}`);
      }
      if (model.active === false && model.rolloutPercentage && model.rolloutPercentage > 0) {
         errors.push(`Model "${modelId}" for provider "${providerName}" has rolloutPercentage > 0 but is not active`);
      }
      if (model.visionSupport === undefined) errors.push(`Model "${modelId}" for provider "${providerName}" must explicitly set visionSupport (true/false).`);
      if (model.streamingSupport === undefined) errors.push(`Model "${modelId}" for provider "${providerName}" must explicitly set streamingSupport (true/false).`);
      if (model.functionCallingSupport === undefined) errors.push(`Model "${modelId}" for provider "${providerName}" must explicitly set functionCallingSupport (true/false).`);

    });

    if (provider.defaultModel && !provider.models[provider.defaultModel]) {
      errors.push(`Provider "${providerName}" defaultModel "${provider.defaultModel}" not found in its models list.`);
    }
    if (provider.defaultModel && provider.models[provider.defaultModel] && !provider.models[provider.defaultModel].active) {
      // console.warn(`Provider "${providerName}" defaultModel "${provider.defaultModel}" is currently inactive.`);
    }
  });

  if (config.routing.defaultModel) {
    let foundAndActive = false;
    for (const providerName of config.routing.providerPreferenceOrder) {
        const provider = config.providers[providerName];
        if (provider && provider.active && provider.models[config.routing.defaultModel] && provider.models[config.routing.defaultModel].active) {
            foundAndActive = true;
            break;
        }
    }
    if (!foundAndActive) {
        // console.warn(`Global defaultModel "${config.routing.defaultModel}" is not found or not active in any of the preferred active providers.`);
    }
  }
  
  return errors;
} 