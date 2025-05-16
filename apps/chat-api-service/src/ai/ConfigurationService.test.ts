import { ConfigurationService } from './ConfigurationService';
import { AiServiceConfiguration, DEFAULT_ROUTING_WEIGHTS, validateAiServiceConfiguration, IDatabaseProvider } from '@kinable/common-types';

// Mock the validateAiServiceConfiguration function from common-types as it's an external dependency
jest.mock('@kinable/common-types', () => {
  const originalModule = jest.requireActual('@kinable/common-types');
  return {
    ...originalModule, // Spread original module exports
    validateAiServiceConfiguration: jest.fn().mockReturnValue([]), // Mock specific function
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
        return { 
            configVersion: '1.0.0-db', 
            schemaVersion: '1.0.0',
            updatedAt: new Date().toISOString(), 
            providers: {
              openai: { 
                active: true, secretId: 'kinable-{env}/{region}/openai/db-secret', // Templated, as expected by validator
                defaultModel: 'gpt-3.5-turbo', models: { 'gpt-3.5-turbo': { name:'test', contextWindow:100, costPerMillionInputTokens:1, costPerMillionOutputTokens:1, active:true, capabilities: [], streamingSupport:true, functionCallingSupport:true, visionSupport:false}},
                rateLimits: { rpm: 10, tpm: 1000 }
              }
            },
            routing: { rules: [], weights: DEFAULT_ROUTING_WEIGHTS, providerPreferenceOrder: ['openai'], defaultModel: 'gpt-3.5-turbo-db' },
            featureFlags: {}
        } as AiServiceConfiguration; 
      }
      return null; 
    });
    mockDbProvider.putItem.mockResolvedValue({}); 

    serviceInstance = new ConfigurationService(
      mockDbProvider,
      MOCK_PROVIDER_CONFIG_TABLE_NAME,
      MOCK_AWS_CLIENT_REGION,
      MOCK_ACTIVE_CONFIG_ID
    );
    serviceInstance.setCacheTtl(100); 
    (validateAiServiceConfiguration as jest.Mock).mockClear().mockReturnValue([]);
  });

  test('constructor should initialize, subsequent getConfiguration fetches from DB', async () => {
    expect(serviceInstance).toBeDefined();
    mockDbProvider.getItem.mockClear(); 
    
    const config = await serviceInstance.getConfiguration(); 
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1); 
    expect(config.configVersion).toBe('1.0.0-db');
    expect(config.providers.openai?.secretId).toBe('kinable-{env}/{region}/openai/db-secret'); 
  });

  test('getConfiguration should fetch from DB if cache is empty and return a valid configuration', async () => {
    (serviceInstance as any).lastFetched = 0; 
    mockDbProvider.getItem.mockClear(); 

    const config = await serviceInstance.getConfiguration(); 

    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1); 
    expect(mockDbProvider.getItem).toHaveBeenCalledWith(
      MOCK_PROVIDER_CONFIG_TABLE_NAME,
      'configId',
      MOCK_ACTIVE_CONFIG_ID,
      MOCK_AWS_CLIENT_REGION
    );
    expect(config).toBeDefined();
    expect(config.configVersion).toBe('1.0.0-db');
    expect(config.providers.openai?.secretId).toBe('kinable-{env}/{region}/openai/db-secret');
    expect(config.routing.defaultModel).toBe('gpt-3.5-turbo-db');
  });

  test('getConfiguration should use cached configuration within TTL', async () => {
    await serviceInstance.getConfiguration(); 
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1);
    mockDbProvider.getItem.mockClear(); 

    await serviceInstance.getConfiguration(); 
    expect(mockDbProvider.getItem).not.toHaveBeenCalled(); 
  });

  test('getConfiguration should re-fetch from DB after TTL expires', async () => {
    await serviceInstance.getConfiguration(); 
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1);
    mockDbProvider.getItem.mockClear();

    await new Promise(resolve => setTimeout(resolve, 150)); 

    await serviceInstance.getConfiguration(); 
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1); 
  });
  
  test('getConfiguration should return default config if DB fetch fails', async () => {
    mockDbProvider.getItem.mockRejectedValueOnce(new Error('DB unavailable'));
    
    const config = await serviceInstance.getConfiguration();
    
    expect(mockDbProvider.getItem).toHaveBeenCalledTimes(1);
    expect(config).toBeDefined();
    expect(config.configVersion).toBe('1.0.0');
    expect(config.routing.defaultModel).toBe('gpt-3.5-turbo-default'); 
  });

  test('updateConfiguration should validate, write to DB, and update in-memory cache', async () => {
    const newConfigData: AiServiceConfiguration = {
      configVersion: '2.0.0-updated',
      schemaVersion: '1.0.0',
      updatedAt: new Date().toISOString(),
      providers: { 
        openai: { 
          active: true, secretId: 'kinable-{env}/{region}/updated-secret',
          defaultModel: 'gpt-4', models: { 'gpt-4': { name:'test-upd', contextWindow:100, costPerMillionInputTokens:1, costPerMillionOutputTokens:1, active:true, capabilities: [], streamingSupport:true, functionCallingSupport:true, visionSupport:false}},
          rateLimits: { rpm: 20, tpm: 2000 }
        }
      },
      routing: { rules: [], weights: DEFAULT_ROUTING_WEIGHTS, providerPreferenceOrder: ['openai'], defaultModel: 'gpt-4-updated' }, 
      featureFlags: { enableStreaming: false }
    };

    await serviceInstance.getConfiguration();
    mockDbProvider.getItem.mockClear(); 

    const mockUpdatedItemFromDb = {
      ...newConfigData
    } as AiServiceConfiguration;

    await serviceInstance.updateConfiguration(newConfigData);

    expect(validateAiServiceConfiguration).toHaveBeenCalledWith(newConfigData);
    expect(mockDbProvider.putItem).toHaveBeenCalledTimes(1);
    expect(mockDbProvider.putItem).toHaveBeenCalledWith(
      MOCK_PROVIDER_CONFIG_TABLE_NAME,
      expect.objectContaining({
        configId: MOCK_ACTIVE_CONFIG_ID,
        ...newConfigData
      }),
      'configId', 
      MOCK_AWS_CLIENT_REGION 
    );

    mockDbProvider.getItem.mockResolvedValueOnce(mockUpdatedItemFromDb);

    const fetchedConfig = await serviceInstance.getConfiguration(); 
    expect(mockDbProvider.getItem).not.toHaveBeenCalled(); 
    expect(fetchedConfig.configVersion).toBe('2.0.0-updated');
    expect(fetchedConfig.providers.openai?.secretId).toBe('kinable-{env}/{region}/updated-secret');
  });

  test('updateConfiguration should throw error if validation fails and not write to DB', async () => {
    (validateAiServiceConfiguration as jest.Mock).mockReturnValueOnce(['routing.providerPreferenceOrder cannot be empty.']);
    
    const invalidConfig: AiServiceConfiguration = {
      configVersion: 'invalid-1.0', schemaVersion:'1.0.0', updatedAt: new Date().toISOString(), providers: {}, 
      routing: { rules: [], weights: DEFAULT_ROUTING_WEIGHTS, providerPreferenceOrder: [] },
      featureFlags: {} 
    };
    
    await expect(serviceInstance.updateConfiguration(invalidConfig))
      .rejects
      .toThrow('Invalid configuration: routing.providerPreferenceOrder cannot be empty.'); 
      
    expect(mockDbProvider.putItem).not.toHaveBeenCalled();
  });
}); 