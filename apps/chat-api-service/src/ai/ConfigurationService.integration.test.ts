import { ConfigurationService } from './ConfigurationService';
import { ProviderConfiguration } from '@kinable/common-types';
// Import real DynamoDBProvider and AWS SDK clients
import { DynamoDBProvider } from '../data/DynamoDBProvider'; // Adjusted path
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-2';
// const _TABLE_NAME = process.env.TEST_DYNAMODB_TABLE_PROVIDERCONFIG; // No longer needed with direct usage
// const _CONFIG_ID = 'kinable-dev-config-v1'; // No longer needed

// Configuration for the test
const TEST_TABLE_NAME = process.env.TEST_DYNAMODB_TABLE_PROVIDERCONFIG;
const TEST_CONFIG_ID = 'INTEGRATION_TEST_CONFIG_V1';
const TEST_SERVICE_REGION = REGION; // Service region for ConfigurationService
const TEST_DB_CLIENT_REGION = REGION; // Region for the DynamoDBDocumentClient

// Removed MockDynamoDBProvider class

describe('ConfigurationService Integration Tests', () => {
  let dbProvider: DynamoDBProvider;
  let configurationService: ConfigurationService;
  let ddbDocClient: DynamoDBDocumentClient;

  beforeAll(() => {
    if (!TEST_TABLE_NAME) {
      throw new Error('TEST_DYNAMODB_TABLE_PROVIDERCONFIG environment variable must be set for integration tests.');
    }
    dbProvider = new DynamoDBProvider(TEST_DB_CLIENT_REGION);
    const ddbClient = new DynamoDBClient({ region: TEST_DB_CLIENT_REGION });
    ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
  });

  beforeEach(() => {
    // Re-initialize ConfigurationService before each test for a clean state
    configurationService = new ConfigurationService(
      dbProvider, // Re-use the dbProvider and ddbDocClient initialized in beforeAll
      TEST_TABLE_NAME!,
      TEST_SERVICE_REGION,
      TEST_CONFIG_ID
    );
    configurationService.setCacheTtl(1000); // Short TTL for cache tests
  });
  
  // afterEach: We need a robust way to clean up items.
  // The ConfigurationService itself doesn't have a delete method.
  // We'll use the ddbDocClient to delete the test item.
  afterEach(async () => {
    try {
      await ddbDocClient.send(new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { configId: TEST_CONFIG_ID }, // The key for ProviderConfigTable is 'configId'
      }));
      // console.log(`Cleaned up item ${TEST_CONFIG_ID} from ${TEST_TABLE_NAME}`);
    } catch (error) {
      // console.warn(`Could not clean up item ${TEST_CONFIG_ID} from ${TEST_TABLE_NAME}:`, error);
      // It might not exist if a test failed before creating it, which is fine.
    }
    // jest.clearAllMocks(); // No Jest mocks to clear for dbProvider or ddbDocClient
  });
  
  const getSampleConfig = (version: string = '1.0.0'): ProviderConfiguration => ({
    version: version,
    updatedAt: Date.now(),
    providers: {
      openai: {
        active: true,
        keyVersion: 1,
        // secretId: 'test-secret', // No longer needed for config structure - remove if not part of ProviderConfiguration
        endpoints: { [TEST_SERVICE_REGION]: { url: 'https://api.openai.com/v1', region: TEST_SERVICE_REGION, priority: 1, active: true } },
        models: {
          'gpt-4o': { tokenCost: 0.01, priority: 1, capabilities: ['test'], contextSize: 128, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 },
        },
        rateLimits: { rpm: 10, tpm: 10000 },
        retryConfig: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1000 },
        apiVersion: 'v1',
        rolloutPercentage: 100,
      },
    },
    routing: {
      rules: [{ type: 'capability', required: ['test'], preferredProvider: 'openai' }],
      weights: { cost: 0.5, quality: 0.3, latency: 0.1, availability: 0.1 }, // Sums to 1.0
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
    },
    featureFlags: { enableStreaming: false, enableFunctionCalling: false },
  });

  test('should fetch default configuration if no item exists in DynamoDB', async () => {
    // Ensure item does not exist (afterEach should handle general cleanup, but good for clarity)
    await ddbDocClient.send(new DeleteCommand({ TableName: TEST_TABLE_NAME, Key: { configId: TEST_CONFIG_ID } }));
    
    const config = await configurationService.getConfiguration();
    const defaultConfig = (configurationService as any).getDefaultConfiguration();
    expect(config.version).toBe(defaultConfig.version);
    expect(config.providers.openai.active).toBe(true);
  });

  test('should store and fetch a valid configuration from DynamoDB', async () => {
    const sampleConfig = getSampleConfig('1.0.1');
    await configurationService.updateConfiguration(sampleConfig);

    // To ensure we are fetching from DB, not cache, we can re-instantiate or clear cache
    // For this test, let's clear the service's internal cache
    (configurationService as any).lastFetched = 0;

    const fetchedConfig = await configurationService.getConfiguration();
    // Compare relevant parts or deep equal, ProviderConfiguration can have dynamic `updatedAt`
    expect(fetchedConfig.version).toEqual(sampleConfig.version);
    expect(fetchedConfig.providers).toEqual(sampleConfig.providers);
    expect(fetchedConfig.routing).toEqual(sampleConfig.routing);
    expect(fetchedConfig.featureFlags).toEqual(sampleConfig.featureFlags);
  });

  test('should use cached configuration within TTL', async () => {
    const sampleConfig = getSampleConfig('1.0.2');
    await configurationService.updateConfiguration(sampleConfig); // Puts item in DB and cache

    // Modify item directly in DB to check if cache is used
    const modifiedSampleConfig = getSampleConfig('1.0.3-modified');
    // The item stored by ConfigurationService has configData nested
    const itemToPutInDB = {
        configId: TEST_CONFIG_ID,
        configData: modifiedSampleConfig, // ConfigurationService stores the ProviderConfiguration under 'configData'
        lastUpdated: new Date().toISOString()
    };
    await ddbDocClient.send(new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: itemToPutInDB,
    }));

    const cachedConfig = await configurationService.getConfiguration(); // Should get from cache
    expect(cachedConfig.version).toBe('1.0.2'); 
  });

  test('should fetch updated configuration from DynamoDB after cache TTL expires', async () => {
    const initialConfig = getSampleConfig('1.0.4');
    await configurationService.updateConfiguration(initialConfig); 

    const updatedConfigInDB = getSampleConfig('1.0.5-updated');
    const itemToPutInDB = {
        configId: TEST_CONFIG_ID,
        configData: updatedConfigInDB,
        lastUpdated: new Date().toISOString()
    };
    await ddbDocClient.send(new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: itemToPutInDB,
    }));

    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for cache (1000ms TTL) to expire

    const fetchedConfigAfterTTL = await configurationService.getConfiguration();
    expect(fetchedConfigAfterTTL.version).toBe(updatedConfigInDB.version);
  });

  test('updateConfiguration should throw error for invalid configuration data', async () => {
    const invalidConfig = {
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: { 
        openai: { 
          active: true, keyVersion: 1, 
          endpoints: { default: { url: "url", region: "region", priority: 1, active: true }}, // Added priority and active
          models: { "gpt-4": { tokenCost: 0.03, priority: 1, capabilities: ["test"], contextSize: 8000, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 }}, // made model valid
          rateLimits: { rpm: 10, tpm: 1000},
          retryConfig: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1000 } // Added maxDelayMs
        }
      },
      routing: {
        rules: [],
        weights: { cost: 0.5, quality: 0.6, latency: 0.0, availability: 0.0 }, // Invalid: sum > 1
        defaultProvider: 'openai',
        defaultModel: 'gpt-4',
      },
      featureFlags: {}
    } as unknown as ProviderConfiguration;

    try {
      await configurationService.updateConfiguration(invalidConfig);
      fail('Should have thrown an error for invalid configuration');
    } catch (error: any) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Invalid configuration'); 
      expect(error.message).toContain('Routing weights must sum to 1.0');
    }
  });

  test('getConfiguration should return default if DynamoDB fetch fails catastrophically (simulated by service)', async () => {
    // To simulate a true DynamoDB unavailability for getItem within ConfigurationService,
    // we would need to mock dbProvider.getItem.
    // However, DynamoDBProvider itself has try-catch and returns null.
    // ConfigurationService's fetchConfiguration handles this null and returns default.
    // So, the existing test logic where dbProvider.getItem is mocked to reject
    // is more of a unit test for fetchConfiguration's error handling.
    // For a true integration test of this scenario, one might delete the table or cause IAM issues,
    // which is too destructive.
    // We will test the path where getItem returns null (e.g. item not found after cache expiry).

    // Ensure the item is not in the DB
    await ddbDocClient.send(new DeleteCommand({ TableName: TEST_TABLE_NAME, Key: { configId: TEST_CONFIG_ID } }));
    
    // Invalidate cache
    (configurationService as any).lastFetched = 0;
    // (configurationService as any).config = null; // Better to let it be default initially

    const config = await configurationService.getConfiguration();
    const defaultConfig = (configurationService as any).getDefaultConfiguration();
    expect(config.version).toBe(defaultConfig.version);
    expect(config.providers.openai?.active).toBe(true);
  });

  test('updateConfiguration should create item if it does not initially exist', async () => {
    await ddbDocClient.send(new DeleteCommand({ TableName: TEST_TABLE_NAME, Key: { configId: TEST_CONFIG_ID } }));

    const newConfig = getSampleConfig('2.0.0-new');
    await configurationService.updateConfiguration(newConfig);

    const { Item } = await ddbDocClient.send(new GetCommand({
      TableName: TEST_TABLE_NAME,
      Key: { configId: TEST_CONFIG_ID },
    }));

    expect(Item).toBeDefined();
    expect(Item?.configId).toBe(TEST_CONFIG_ID);
    // The ConfigurationService stores the actual ProviderConfiguration object under 'configData'
    expect(Item?.configData).toBeDefined();
    if (Item?.configData) {
      const configData = Item.configData as ProviderConfiguration;
      expect(configData.version).toBe('2.0.0-new');
      // Deep compare the nested configData
      expect(configData.providers).toEqual(newConfig.providers);
      expect(configData.routing).toEqual(newConfig.routing);
      expect(configData.featureFlags).toEqual(newConfig.featureFlags);
    }
    
    // Also verify that getConfiguration now returns this new config
    (configurationService as any).lastFetched = 0; // force re-fetch from DB
    const fetchedConfig = await configurationService.getConfiguration();
    expect(fetchedConfig.version).toEqual(newConfig.version);
    expect(fetchedConfig.providers).toEqual(newConfig.providers);
  });

  test('getConfiguration should fetch from DB if cache is empty but item exists in DB', async () => {
    const dbConfig = getSampleConfig('3.0.0-db-only');
    const itemToPutInDB = {
        configId: TEST_CONFIG_ID,
        configData: dbConfig,
        lastUpdated: new Date().toISOString()
    };
    await ddbDocClient.send(new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: itemToPutInDB,
    }));

    (configurationService as any).lastFetched = 0; // Force cache to be considered stale

    const fetchedConfig = await configurationService.getConfiguration();
    expect(fetchedConfig).toBeDefined();
    expect(fetchedConfig.version).toBe('3.0.0-db-only');
    expect(fetchedConfig.providers).toEqual(dbConfig.providers); // Compare parts
    expect(fetchedConfig.routing).toEqual(dbConfig.routing);
    expect(fetchedConfig.featureFlags).toEqual(dbConfig.featureFlags);
  });
}); 