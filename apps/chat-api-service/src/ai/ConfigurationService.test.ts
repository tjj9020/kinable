import { ConfigurationService } from './ConfigurationService';
import { ProviderConfiguration, DEFAULT_ROUTING_WEIGHTS, validateConfiguration, IDatabaseProvider } from '@kinable/common-types';

// Mock the validateConfiguration function from common-types as it's an external dependency
jest.mock('@kinable/common-types', () => {
  const originalModule = jest.requireActual('@kinable/common-types');
  return {
    ...originalModule, // Spread original module exports
    validateConfiguration: jest.fn().mockReturnValue([]), // Mock specific function
    // Ensure other exports like DEFAULT_ROUTING_WEIGHTS are preserved if they are used directly from here
  };
});

// Note: No longer using jest.mock('./ConfigurationService', ...) for getInstance

describe('ConfigurationService', () => {
  let serviceInstance: ConfigurationService;
  let mockDbProvider: jest.Mocked<IDatabaseProvider>;

  const MOCK_AWS_CLIENT_REGION = 'test-region-config-svc';
  const MOCK_PROVIDER_CONFIG_TABLE_NAME = 'test-table-provider-config';
  const MOCK_ACTIVE_CONFIG_ID = 'DEFAULT_CONFIG_V1'; // Using a more specific mock ID

  beforeEach(async () => { // Make beforeEach async if needed for setup
    jest.clearAllMocks(); 

    mockDbProvider = {
      getItem: jest.fn(),
      putItem: jest.fn(),
      deleteItem: jest.fn(), 
      query: jest.fn(),
      updateItem: jest.fn(),
    };

    mockDbProvider.getItem.mockImplementation(async (tableName, keyAttributeName, logicalId) => {
      // console.log(`Mock getItem called for ${logicalId} in ${tableName}`);
      if (tableName === MOCK_PROVIDER_CONFIG_TABLE_NAME && logicalId === MOCK_ACTIVE_CONFIG_ID) {
        // Return the item directly, matching what ConfigurationService expects for configItem.configData
        return {
          // configId: logicalId, // This level is if getItem returns the raw DynamoDB Item structure
          configData: { // This is the T of getItem<T>, which is { configData: ProviderConfiguration }
            version: '1.0.0-db',
            updatedAt: Date.now(),
            providers: {
              openai: {
                active: true, keyVersion: 1, secretId: 'db-secret',
                endpoints: {}, models: {}, rateLimits: { rpm: 10, tpm: 1000 },
                retryConfig: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1000 },
                apiVersion: 'v1', rolloutPercentage: 100
              }
            },
            routing: { rules: [], weights: DEFAULT_ROUTING_WEIGHTS, defaultProvider: 'openai', defaultModel: 'gpt-3.5-turbo-db' },
            featureFlags: {}
          } as ProviderConfiguration // This is type T, so getItem returns { configData: ... }
        }; 
      }
      // console.log(`Mock getItem: ${logicalId} not found, returning null`);
      return null; // Return null if item is not found, as per IDatabaseProvider.getItem<T> : T | null
    });
    mockDbProvider.putItem.mockResolvedValue({}); 

    serviceInstance = new ConfigurationService(
      mockDbProvider,
      MOCK_PROVIDER_CONFIG_TABLE_NAME,
      MOCK_AWS_CLIENT_REGION,
      MOCK_ACTIVE_CONFIG_ID
    );
    // In the service, config is initialized with default, then fetchConfiguration is called (but not awaited in constructor).
    // To ensure the first getConfiguration() in tests sees the DB result, we can call & await it here OR rely on its internal logic.
    // Forcing an initial fetch for consistent test starting state:
    // await serviceInstance.getConfiguration(); 
    // mockDbProvider.getItem.mockClear(); // Clear the call from the above line if we add it.

    serviceInstance.setCacheTtl(100); 
    (validateConfiguration as jest.Mock).mockClear().mockReturnValue([]);
  });

  test('constructor should initialize, subsequent getConfiguration fetches from DB', async () => {
    expect(serviceInstance).toBeDefined();
    mockDbProvider.getItem.mockClear(); // Clear any calls from beforeEach or previous tests if any
    
    // First explicit call to getConfiguration should trigger DB fetch
    const config = await serviceInstance.getConfiguration(); 
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1); // Expect one call here
    expect(config.version).toBe('1.0.0-db'); // Should be from DB now
    expect(config.providers.openai?.secretId).toBe('db-secret'); // Further check from DB mock
  });

  test('getConfiguration should fetch from DB if cache is empty and return a valid configuration', async () => {
    // Ensure cache is considered empty or expired for the first call in this test context
    // Force cache expiry for this specific test run to ensure DB fetch
    (serviceInstance as any).lastFetched = 0; 
    mockDbProvider.getItem.mockClear(); // Clear any calls from beforeEach initial getConfiguration

    const config = await serviceInstance.getConfiguration(); // This is the call we are testing

    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1); // Expect one call here
    expect(mockDbProvider.getItem).toHaveBeenCalledWith(
      MOCK_PROVIDER_CONFIG_TABLE_NAME,
      'configId',
      MOCK_ACTIVE_CONFIG_ID,
      MOCK_AWS_CLIENT_REGION
    );
    expect(config).toBeDefined();
    expect(config.version).toBe('1.0.0-db');
    expect(config.providers.openai?.secretId).toBe('db-secret');
    expect(config.routing.defaultModel).toBe('gpt-3.5-turbo-db');
  });

  test('getConfiguration should use cached configuration within TTL', async () => {
    await serviceInstance.getConfiguration(); // First call, fetches and populates cache
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1);
    mockDbProvider.getItem.mockClear(); // Clear for next assertion

    await serviceInstance.getConfiguration(); // Second call, should use cache
    expect(mockDbProvider.getItem).not.toHaveBeenCalled(); // Not called again
  });

  test('getConfiguration should re-fetch from DB after TTL expires', async () => {
    await serviceInstance.getConfiguration(); // First call, fetches
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1);
    mockDbProvider.getItem.mockClear();

    await new Promise(resolve => setTimeout(resolve, 150)); // Wait for cache (100ms) to expire

    await serviceInstance.getConfiguration(); // Should re-fetch
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1); // Called again
  });
  
  test('getConfiguration should return default config if DB fetch fails', async () => {
    mockDbProvider.getItem.mockRejectedValueOnce(new Error('DB unavailable'));
    
    const config = await serviceInstance.getConfiguration();
    
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1);
    expect(config).toBeDefined();
    // Check against the structure of getDefaultConfiguration() from ConfigurationService.ts
    expect(config.version).toBe('1.0.0'); // Default version
    expect(config.routing.defaultModel).toBe('gpt-3.5-turbo'); // Default model
    // console.log('Default config used on DB error:', JSON.stringify(config, null, 2));
  });

  test('updateConfiguration should validate, write to DB, and update in-memory cache', async () => {
    const newConfigData: ProviderConfiguration = {
      version: '2.0.0-updated',
      updatedAt: Date.now(),
      providers: { 
        openai: { 
          active: true, keyVersion: 2, secretId: 'updated-secret',
          endpoints: {}, models: {}, rateLimits: { rpm: 20, tpm: 2000 },
          retryConfig: { maxRetries: 2, initialDelayMs: 200, maxDelayMs: 2000 },
          apiVersion: 'v2', rolloutPercentage: 100
        }
      },
      routing: { rules: [], weights: DEFAULT_ROUTING_WEIGHTS, defaultProvider: 'openai', defaultModel: 'gpt-4-updated' },
      featureFlags: { enableStreaming: false }
    };

    // Initial fetch to ensure serviceInstance.config is populated (and potentially fill cache)
    await serviceInstance.getConfiguration();
    mockDbProvider.getItem.mockClear(); // Clear this initial call

    // This is what getItem should return *after* the update, if getConfiguration were to fetch again.
    const mockUpdatedItemFromDb = {
      configData: newConfigData
    };

    await serviceInstance.updateConfiguration(newConfigData);

    expect(validateConfiguration).toHaveBeenCalledWith(newConfigData);
    expect(mockDbProvider.putItem).toHaveBeenCalledTimes(1);
    expect(mockDbProvider.putItem).toHaveBeenCalledWith(
      MOCK_PROVIDER_CONFIG_TABLE_NAME,
      expect.objectContaining({
        configId: MOCK_ACTIVE_CONFIG_ID,
        configData: newConfigData,
      }),
      'configId', 
      MOCK_AWS_CLIENT_REGION 
    );

    // Setup getItem to return the new config IF it were called (it shouldn't be for this check)
    mockDbProvider.getItem.mockResolvedValueOnce(mockUpdatedItemFromDb);

    const fetchedConfig = await serviceInstance.getConfiguration(); // Should use in-memory cache
    expect(mockDbProvider.getItem).not.toHaveBeenCalled(); // Should NOT be called
    expect(fetchedConfig.version).toBe('2.0.0-updated');
    expect(fetchedConfig.providers.openai?.secretId).toBe('updated-secret');
  });

  test('updateConfiguration should throw error if validation fails and not write to DB', async () => {
    (validateConfiguration as jest.Mock).mockReturnValueOnce(['Validation Error: Bad Field']);
    
    const invalidConfig: ProviderConfiguration = { 
      version: 'invalid-1.0', updatedAt: 0, providers: {}, 
      routing: { rules: [], weights: DEFAULT_ROUTING_WEIGHTS, defaultProvider: '', defaultModel: '' }, 
      featureFlags: {} 
    };
    
    await expect(serviceInstance.updateConfiguration(invalidConfig))
      .rejects
      .toThrow('Invalid configuration: Validation Error: Bad Field');
      
    expect(mockDbProvider.putItem).not.toHaveBeenCalled();
  });
}); 