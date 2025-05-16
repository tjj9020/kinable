import { 
  AiServiceConfiguration,
  ModelConfig,
  ProviderConfig,
  DEFAULT_ROUTING_WEIGHTS,
  validateAiServiceConfiguration,
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
  private config: AiServiceConfiguration;
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
   * Get the underlying IDatabaseProvider instance.
   * @returns The IDatabaseProvider instance used by this service.
   */
  public getDBProvider(): IDatabaseProvider {
    return this.dbProvider;
  }
  
  /**
   * Get the current configuration
   * In production, this would check cache freshness and fetch from DynamoDB if needed
   */
  public async getConfiguration(): Promise<AiServiceConfiguration> {
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
      const errors = validateAiServiceConfiguration(newConfig);
      if (errors.length > 0) {
        console.error(`Configuration validation failed for '${this.activeConfigId}':`, errors.join('; '));
        // Decide on error handling: throw, or use stale/default. Current behavior is use stale.
        console.warn(`Using stale/default configuration for '${this.activeConfigId}' due to validation errors.`);
      } else {
        this.config = newConfig;
      }
      
      this.lastFetched = now;
    } catch (error) {
      console.error(`Failed to fetch or validate configuration '${this.activeConfigId}':`, error);
      // Continue using the current (possibly default) configuration
      console.warn(`Using stale/default configuration for '${this.activeConfigId}' due to fetch/validation error.`);
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
  private async fetchConfiguration(): Promise<AiServiceConfiguration> {
    // Simulate network delay
    // await new Promise(resolve => setTimeout(resolve, 100)); // Keep for testing if needed, but primary path is DB
    
    // For now, return the default configuration - This will be replaced by DynamoDB fetch
    // return this.getDefaultConfiguration();

    try {
      const fetchedItem = await this.dbProvider.getItem<AiServiceConfiguration>(
        this.providerConfigTableName,
        PROVIDER_CONFIG_TABLE_KEY_NAME, // keyAttributeName: 'configId'
        this.activeConfigId,             // logicalId: Use the member variable
        this.serviceRegion            // userRegion: Using serviceRegion, assuming config is not user-region specific in its key
      );

      if (fetchedItem) {
        // fetchedItem is the AiServiceConfiguration object (excluding configId which was the key)
        console.log(`Successfully fetched configuration '${this.activeConfigId}' from ${this.providerConfigTableName}`);
        // Perform a basic check for a core property to ensure it's not just an empty object
        if (fetchedItem.providers && fetchedItem.configVersion) {
            return fetchedItem;
        } else {
            console.warn(`Fetched item for '${this.activeConfigId}' from ${this.providerConfigTableName} is missing core properties. Using default.`);
            return this.getDefaultConfiguration();
        }
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
  private getDefaultConfiguration(): AiServiceConfiguration {
    // This default needs to be more complete and match AiServiceConfiguration and ModelConfig
    const defaultOpenAiModel: ModelConfig = {
        id: "gpt-3.5-turbo-default",
        name: "GPT-3.5 Turbo (Default)",
        description: "Default fallback model.",
        costPerMillionInputTokens: 0.50,
        costPerMillionOutputTokens: 1.50,
        contextWindow: 4096,
        maxOutputTokens: 4096,
        capabilities: ["general", "chat"],
        streamingSupport: true,
        functionCallingSupport: true,
        visionSupport: false,
        active: true,
    };

    const defaultOpenAiProvider: ProviderConfig = {
        active: true,
        secretId: "{env}-{region}-openai-default-api-key", // Corrected templated secretId for default
        defaultModel: "gpt-3.5-turbo-default",
        models: {
            "gpt-3.5-turbo-default": defaultOpenAiModel
        },
        // Fill other optional ProviderConfig fields if necessary for default behavior
        rateLimits: { rpm: 50, tpm: 50000 } // Added example rate limits
    };

    return {
      configVersion: '1.0.0', // Updated configVersion to '1.0.0'
      schemaVersion: '1.0.0', // Matches current schema version
      updatedAt: new Date(0).toISOString(), // Epoch timestamp
      providers: {
        openai: defaultOpenAiProvider
      },
      routing: {
        weights: DEFAULT_ROUTING_WEIGHTS,
        providerPreferenceOrder: ['openai'],
        defaultModel: 'gpt-3.5-turbo-default'
      },
      featureFlags: {
        enableStreaming: true,
      }
    };
  }
  
  /**
   * Update the configuration
   * This will validate and then write the configuration to DynamoDB
   * and update the local cache.
   * @param config The new configuration to set
   */
  public async updateConfiguration(newConfig: AiServiceConfiguration): Promise<void> {
    // Validate the new configuration
    const errors = validateAiServiceConfiguration(newConfig);
    if (errors.length > 0) {
      console.error('New configuration validation failed:', errors.join('; '));
      throw new Error(`Invalid configuration: ${errors.join('; ')}`);
    }
    
    // Ensure updatedAt is current before saving
    newConfig.updatedAt = new Date().toISOString();

    // The item to put includes the configId (key) and spreads the newConfig attributes
    const itemToPut = {
      [PROVIDER_CONFIG_TABLE_KEY_NAME]: this.activeConfigId, // Use the activeConfigId for the item's key
      ...newConfig 
    };

    try {
      // IDatabaseProvider.putItem typically expects the full item including keys.
      // Ensure its signature matches this usage.
      await this.dbProvider.putItem(
        this.providerConfigTableName,
        itemToPut, // Pass the whole item
        PROVIDER_CONFIG_TABLE_KEY_NAME, // keyAttributeName
        this.serviceRegion // userRegion - assuming this is appropriate for partition key context if not globally unique
      );
      
      // Update local cache on successful DB write
      this.config = newConfig;
      this.lastFetched = Date.now();
      console.log(`Successfully updated configuration '${this.activeConfigId}' in ${this.providerConfigTableName} and refreshed cache.`);

    } catch (error) {
      console.error(`Error updating configuration '${this.activeConfigId}' in ${this.providerConfigTableName}:`, error);
      // Rethrow the error so the caller is aware of the failure
      throw new Error(`Failed to update configuration in DynamoDB: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}