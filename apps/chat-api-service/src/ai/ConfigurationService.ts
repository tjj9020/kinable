import { 
  ProviderConfiguration, 
  DEFAULT_ROUTING_WEIGHTS,
  validateConfiguration,
  IDatabaseProvider
} from '@kinable/common-types';

const PROVIDER_CONFIG_TABLE_KEY_NAME = 'configId';
// const ACTIVE_CONFIG_ID = 'ACTIVE_CONFIG_V1'; // Example ID for the active configuration document - REMOVED

/**
 * Service for managing provider configurations
 * Fetches configuration from a specified DynamoDB table.
 */
export class ConfigurationService {
  // private static instance: ConfigurationService; // Removing singleton for now
  private config: ProviderConfiguration;
  private lastFetched: number = 0;
  private cacheTtlMs: number = 60000; // 1 minute

  private dbProvider: IDatabaseProvider;
  private providerConfigTableName: string;
  private serviceRegion: string;
  private activeConfigId: string; // Added activeConfigId member

  /**
   * Constructor for ConfigurationService.
   * @param dbProvider Instance of IDatabaseProvider to interact with DynamoDB.
   * @param providerConfigTableName The name of the DynamoDB table storing provider configurations.
   * @param serviceRegion The AWS region the service is operating in.
   * @param activeConfigId The ID of the configuration document to fetch from the table.
   */
  constructor(
    dbProvider: IDatabaseProvider, 
    providerConfigTableName: string, 
    serviceRegion: string,
    activeConfigId: string // Added activeConfigId parameter
  ) {
    this.dbProvider = dbProvider;
    this.providerConfigTableName = providerConfigTableName;
    this.serviceRegion = serviceRegion; 
    this.activeConfigId = activeConfigId; // Store activeConfigId
    // Initialize with default configuration, will be overwritten by first fetch
    this.config = this.getDefaultConfiguration();
  }
  
  /**
   * Get the singleton instance - REMOVED for now, instantiate directly
   */
  // public static getInstance(): ConfigurationService {
  //   if (!ConfigurationService.instance) {
  //     ConfigurationService.instance = new ConfigurationService();
  //   }
  //   return ConfigurationService.instance;
  // }
  
  /**
   * Get the current configuration
   * In production, this would check cache freshness and fetch from DynamoDB if needed
   */
  public async getConfiguration(): Promise<ProviderConfiguration> {
    const now = Date.now();
    
    // Check if cache is still valid
    if (this.lastFetched > 0 && now - this.lastFetched <= this.cacheTtlMs) {
      // Use cached config
      return this.config;
    }
    
    try {
      // Cache is expired or not initialized, fetch new config
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
    // await new Promise(resolve => setTimeout(resolve, 100)); // Keep for testing if needed, but primary path is DB
    
    // For now, return the default configuration - This will be replaced by DynamoDB fetch
    // return this.getDefaultConfiguration();

    try {
      const configItem = await this.dbProvider.getItem<{ configData: ProviderConfiguration }>(
        this.providerConfigTableName,
        PROVIDER_CONFIG_TABLE_KEY_NAME, // keyAttributeName: 'configId'
        this.activeConfigId,             // logicalId: Use the member variable
        this.serviceRegion            // userRegion: Using serviceRegion, assuming config is not user-region specific in its key
      );

      if (configItem && configItem.configData) {
        console.log(`Successfully fetched configuration '${this.activeConfigId}' from ${this.providerConfigTableName}`);
        // The actual ProviderConfiguration object is expected to be nested under a property, e.g., 'configData'
        // Adjust if the entire item IS the ProviderConfiguration
        return configItem.configData as ProviderConfiguration;
      } else {
        console.warn(`Configuration '${this.activeConfigId}' not found in ${this.providerConfigTableName}. Using default configuration.`);
        return this.getDefaultConfiguration();
      }
    } catch (error) {
      console.error(`Error fetching configuration '${this.activeConfigId}' from ${this.providerConfigTableName}:`, error);
      console.warn('Using default configuration due to fetch error.');
      return this.getDefaultConfiguration();
    }
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
   * This will validate and then write the configuration to DynamoDB
   * and update the local cache.
   * @param config The new configuration to set
   */
  public async updateConfiguration(config: ProviderConfiguration): Promise<void> {
    // Validate the new configuration
    const errors = validateConfiguration(config);
    if (errors.length > 0) {
      console.error('New configuration validation failed:', errors);
      throw new Error(`Invalid configuration: ${errors.join(', ')}`);
    }
    
    // In production, this would write to DynamoDB
    // For now, just update the local cache
    // TODO: Implement writing to DynamoDB using this.dbProvider.putItem - THIS TODO IS BEING ADDRESSED
    const itemToPut = {
      [PROVIDER_CONFIG_TABLE_KEY_NAME]: this.activeConfigId, // Use the activeConfigId for the item's key
      configData: config,
      lastUpdated: new Date().toISOString()
    };

    try {
      await this.dbProvider.putItem(
        this.providerConfigTableName,
        itemToPut,
        PROVIDER_CONFIG_TABLE_KEY_NAME, // keyAttributeName
        this.serviceRegion // userRegion - assuming this is appropriate for partition key context if not globally unique
      );
      
      // Update local cache on successful DB write
      this.config = config;
      this.lastFetched = Date.now();
      console.log(`Successfully updated configuration '${this.activeConfigId}' in ${this.providerConfigTableName} and refreshed cache.`);

    } catch (error) {
      console.error(`Error updating configuration '${this.activeConfigId}' in ${this.providerConfigTableName}:`, error);
      // Rethrow the error so the caller is aware of the failure
      throw new Error(`Failed to update configuration in DynamoDB: ${error instanceof Error ? error.message : String(error)}`);
    }

    // console.warn('ConfigurationService.updateConfiguration is not yet fully implemented to write to DynamoDB.');
  }
} 