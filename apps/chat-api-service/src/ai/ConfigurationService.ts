import { 
  ProviderConfiguration, 
  DEFAULT_ROUTING_WEIGHTS,
  validateConfiguration
} from '@kinable/common-types';

/**
 * Service for managing provider configurations
 * In production, this would fetch from DynamoDB or another source
 */
export class ConfigurationService {
  private static instance: ConfigurationService;
  private config: ProviderConfiguration;
  private lastFetched: number = 0;
  private cacheTtlMs: number = 60000; // 1 minute
  
  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    // Initialize with default configuration
    this.config = this.getDefaultConfiguration();
  }
  
  /**
   * Get the singleton instance
   */
  public static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }
    return ConfigurationService.instance;
  }
  
  /**
   * Get the current configuration
   * In production, this would check cache freshness and fetch from DynamoDB if needed
   */
  public async getConfiguration(): Promise<ProviderConfiguration> {
    const now = Date.now();
    
    // Check if we need to refresh the cache
    if (now - this.lastFetched > this.cacheTtlMs) {
      try {
        // In production, this would fetch from DynamoDB
        // For now, we'll just return the default configuration
        const newConfig = await this.fetchConfiguration();
        
        // Validate configuration
        const errors = validateConfiguration(newConfig);
        if (errors.length > 0) {
          console.error('Configuration validation failed:', errors);
          // Keep using the current config if the new one is invalid
        } else {
          this.config = newConfig;
        }
        
        this.lastFetched = now;
      } catch (error) {
        console.error('Failed to fetch configuration:', error);
        // Continue using the current configuration
      }
    }
    
    return this.config;
  }
  
  /**
   * Set the cache TTL
   * @param ttlMs Cache TTL in milliseconds
   */
  public setCacheTtl(ttlMs: number): void {
    this.cacheTtlMs = ttlMs;
  }
  
  /**
   * Mock configuration fetch
   * In production, this would fetch from DynamoDB
   */
  private async fetchConfiguration(): Promise<ProviderConfiguration> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // For now, return the default configuration
    return this.getDefaultConfiguration();
  }
  
  /**
   * Get the default configuration
   * This is used as a fallback if fetching fails
   */
  private getDefaultConfiguration(): ProviderConfiguration {
    return {
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: {
          active: true,
          keyVersion: 1,
          endpoints: {
            'us-east-2': {
              url: 'https://api.openai.com/v1',
              region: 'us-east-2',
              priority: 1,
              active: true
            }
          },
          models: {
            'gpt-4o': {
              tokenCost: 0.01,
              priority: 1,
              capabilities: ['reasoning', 'creativity', 'coding', 'function_calling'],
              contextSize: 128000,
              streamingSupport: true,
              functionCalling: true,
              active: true,
              rolloutPercentage: 100
            },
            'gpt-4': {
              tokenCost: 0.03,
              priority: 2,
              capabilities: ['reasoning', 'creativity', 'coding', 'function_calling'],
              contextSize: 8192,
              streamingSupport: true,
              functionCalling: true,
              active: true,
              rolloutPercentage: 100
            },
            'gpt-3.5-turbo': {
              tokenCost: 0.001,
              priority: 3,
              capabilities: ['basic', 'function_calling'],
              contextSize: 4096,
              streamingSupport: true,
              functionCalling: true,
              active: true,
              rolloutPercentage: 100
            }
          },
          rateLimits: {
            rpm: 20,
            tpm: 80000
          },
          retryConfig: {
            maxRetries: 3,
            initialDelayMs: 250,
            maxDelayMs: 4000
          },
          apiVersion: 'v1',
          rolloutPercentage: 100
        }
      },
      routing: {
        rules: [
          {
            type: 'capability',
            required: ['reasoning'],
            preferredProvider: 'openai'
          },
          {
            type: 'costLimit',
            maxTokenCost: 0.002,
            action: 'useModel',
            model: 'gpt-3.5-turbo'
          }
        ],
        weights: DEFAULT_ROUTING_WEIGHTS,
        defaultProvider: 'openai',
        defaultModel: 'gpt-3.5-turbo'
      },
      featureFlags: {
        enableStreaming: true,
        enableFunctionCalling: true
      }
    };
  }
  
  /**
   * Update the configuration
   * In production, this would validate and write to DynamoDB
   * @param config New configuration to apply
   */
  public async updateConfiguration(config: ProviderConfiguration): Promise<void> {
    // Validate configuration
    const errors = validateConfiguration(config);
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }
    
    // In production, this would write to DynamoDB
    // For now, just update the local cache
    this.config = config;
    this.lastFetched = Date.now();
  }
} 