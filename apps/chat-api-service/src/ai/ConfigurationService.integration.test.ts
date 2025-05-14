import { ConfigurationService } from './ConfigurationService';
import { /*IDatabaseProvider,*/ ProviderConfiguration } from '@kinable/common-types'; // IDatabaseProvider removed as per new lint
import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-2';
const _TABLE_NAME = process.env.TEST_DYNAMODB_TABLE_PROVIDERCONFIG; // Prefixed
const _CONFIG_ID = 'kinable-dev-config-v1'; // Prefixed // Example configId

// Configuration for the test
const TEST_TABLE_NAME = process.env.TEST_DYNAMODB_TABLE_PROVIDERCONFIG || 'KinableProviderConfig-Test';
const TEST_CONFIG_ID = 'INTEGRATION_TEST_CONFIG_V1';
const TEST_SERVICE_REGION = REGION;

// Mock DynamoDBProvider that stores items in memory instead of using real DynamoDB
class MockDynamoDBProvider {
  private items: Map<string, any> = new Map();
  private awsClientRegion: string;
  
  constructor(region: string) {
    this.awsClientRegion = region;
  }
  
  async getItem<T>(tableName: string, keyName: string, logicalId: string, _userRegion: string): Promise<T | null> { // userRegion prefixed
    const itemKey = `${tableName}:${logicalId}`;
    if (!this.items.has(itemKey)) {
      console.log(`[MockDynamoDBProvider] Item ${logicalId} not found in table ${tableName}`);
      return null;
    }
    return this.items.get(itemKey) as T;
  }
  
  async putItem<T extends object>(tableName: string, item: T, keyName: string, _userRegion: string): Promise<T | null> { // userRegion prefixed
    // Clone the item to simulate serialization/deserialization
    const itemToStore = JSON.parse(JSON.stringify(item));
    // Create a key from table name and the item's key value
    const keyValue = (item as any)[keyName];
    const itemKey = `${tableName}:${keyValue}`;
    
    // Store the item
    this.items.set(itemKey, itemToStore);
    console.log(`[MockDynamoDBProvider] Successfully saved item with key ${keyValue} to table ${tableName}`);
    return itemToStore;
  }
  
  // Implementing additional required methods from IDatabaseProvider interface
  async updateItem<T extends object>(
    tableName: string, 
    keyAttributeName: string, 
    logicalId: string, 
    updates: Partial<T>, 
    _userRegion: string // userRegion prefixed
  ): Promise<Partial<T> | null> {
    const itemKey = `${tableName}:${logicalId}`;
    
    if (!this.items.has(itemKey)) {
      console.log(`[MockDynamoDBProvider] Item ${logicalId} not found in table ${tableName} for update`);
      return null;
    }
    
    const existingItem = this.items.get(itemKey);
    const updatedItem = { ...existingItem, ...updates };
    this.items.set(itemKey, updatedItem);
    
    console.log(`[MockDynamoDBProvider] Successfully updated item with key ${logicalId} in table ${tableName}`);
    return updatedItem as Partial<T>;
  }
  
  async deleteItem(
    tableName: string, 
    keyAttributeName: string, 
    logicalId: string, 
    _userRegion: string // userRegion prefixed
  ): Promise<boolean> {
    const itemKey = `${tableName}:${logicalId}`;
    
    const result = this.items.delete(itemKey);
    console.log(`[MockDynamoDBProvider] ${result ? 'Successfully deleted' : 'Failed to delete'} item with key ${logicalId} from table ${tableName}`);
    
    return result;
  }
  
  async query<T extends object>(
    tableName: string, 
    _queryParams: unknown // queryParams prefixed
  ): Promise<T[] | null> {
    // Simple implementation - we'll just return all items from the table
    // since we're not implementing full query expressions
    console.log(`[MockDynamoDBProvider] Query called on table ${tableName}`);
    
    const results: T[] = [];
    const tablePrefix = `${tableName}:`;
    
    for (const [itemKey, value] of this.items.entries()) {
      if (itemKey.startsWith(tablePrefix)) {
        results.push(value as T);
      }
    }
    
    console.log(`[MockDynamoDBProvider] Query returned ${results.length} items from table ${tableName}`);
    return results.length > 0 ? results : null;
  }
  
  clear() {
    this.items.clear();
  }
}

describe('ConfigurationService Integration Tests', () => {
  let dbProvider: MockDynamoDBProvider;
  let configurationService: ConfigurationService;
  let mockDdbDocClient: any;
  
  beforeAll(() => {
    // Create a mock DynamoDB provider instead of real one
    dbProvider = new MockDynamoDBProvider(REGION);
    
    configurationService = new ConfigurationService(
      dbProvider,
      TEST_TABLE_NAME,
      TEST_SERVICE_REGION,
      TEST_CONFIG_ID
    );
    configurationService.setCacheTtl(1000); // Use a short TTL for cache tests (1 second)
    
    // Create a mock DynamoDBDocumentClient for direct operations
    mockDdbDocClient = {
      send: jest.fn().mockImplementation(async (command) => {
        if (command instanceof DeleteCommand) {
          const key = command.input.TableName && command.input.Key && 
            `${command.input.TableName}:${command.input.Key.configId}`;
          if (key) {
            dbProvider.clear(); // For simplicity, just clear all items
          }
          return { Attributes: {} };
        } else if (command instanceof PutCommand) {
          if (command.input.TableName && command.input.Item) {
            const item = command.input.Item;
            const configId = item.configId as string;
            if (configId) {
              await dbProvider.putItem(
                command.input.TableName,
                item,
                'configId',
                TEST_SERVICE_REGION
              );
            }
          }
          return { Attributes: {} };
        } else if (command instanceof GetCommand) {
          if (command.input.TableName && command.input.Key && command.input.Key.configId) {
            const result = await dbProvider.getItem(
              command.input.TableName,
              'configId',
              command.input.Key.configId as string,
              TEST_SERVICE_REGION
            );
            return { Item: result };
          }
          return { Item: null };
        }
        return {};
      })
    };
  });
  
  afterEach(() => {
    // Clear mock data between tests
    dbProvider.clear();
    jest.clearAllMocks();
  });
  
  const getSampleConfig = (version: string = '1.0.0'): ProviderConfiguration => ({
    version: version,
    updatedAt: Date.now(),
    providers: {
      openai: {
        active: true,
        keyVersion: 1,
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
      weights: { cost: 0.5, quality: 0.3, latency: 0.1, availability: 0.1 },
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o',
    },
    featureFlags: { enableStreaming: false, enableFunctionCalling: false },
  });

  test('should fetch default configuration if no item exists in DynamoDB', async () => {
    const config = await configurationService.getConfiguration();
    const defaultConfig = (configurationService as any).getDefaultConfiguration(); // Access private method for comparison
    expect(config.version).toBe(defaultConfig.version);
    expect(config.providers.openai.active).toBe(true); // Check a known default value
  });

  test('should store and fetch a valid configuration from DynamoDB', async () => {
    const sampleConfig = getSampleConfig('1.0.1');
    await configurationService.updateConfiguration(sampleConfig);

    const fetchedConfig = await configurationService.getConfiguration();
    expect(fetchedConfig).toEqual(sampleConfig);
  });

  test('should use cached configuration within TTL', async () => {
    const sampleConfig = getSampleConfig('1.0.2');
    await configurationService.updateConfiguration(sampleConfig); // Puts item in DB and cache

    // Modify item directly in DB to check if cache is used
    const modifiedSampleConfig = getSampleConfig('1.0.3-modified');
    await mockDdbDocClient.send(new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: { configId: TEST_CONFIG_ID, configData: modifiedSampleConfig, version: modifiedSampleConfig.version, lastUpdated: new Date().toISOString() },
    }));

    const cachedConfig = await configurationService.getConfiguration(); // Should get from cache
    expect(cachedConfig.version).toBe('1.0.2'); // Expecting the original cached version
  });

  test('should fetch updated configuration from DynamoDB after cache TTL expires', async () => {
    const initialConfig = getSampleConfig('1.0.4');
    await configurationService.updateConfiguration(initialConfig); // Puts item in DB and cache

    const updatedConfigInDB = getSampleConfig('1.0.5-updated');
    await mockDdbDocClient.send(new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: { configId: TEST_CONFIG_ID, configData: updatedConfigInDB, version: updatedConfigInDB.version, lastUpdated: new Date().toISOString() },
    }));

    // Wait for cache to expire (TTL is 1000ms)
    await new Promise(resolve => setTimeout(resolve, 1500));

    const fetchedConfigAfterTTL = await configurationService.getConfiguration();
    expect(fetchedConfigAfterTTL.version).toBe(updatedConfigInDB.version);
  });

  test('updateConfiguration should throw error for invalid configuration data', async () => {
    // Test with invalid data
    // This test needs to be more specific about *why* the config is invalid
    // to match the expected error message from validateConfiguration
    const invalidConfig = {
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: { 
        openai: { // Provide a minimal valid structure for providers to pass that part of validation
          active: true, 
          keyVersion: 1, 
          secretId: "secret",
          endpoints: { default: { url: "url", region: "region"}},
          models: { "gpt-4": { active: true, contextWindow: 8000, costs: { prompt: 0, completion: 0}, features: ["text"]}},
          rateLimits: { rpm: 10, tpm: 1000},
          retryConfig: { maxRetries: 1, delayMs: 100}
        }
      },
      routing: {
        rules: [], // Optional, can be empty
        weights: { cost: 0.5, quality: 0.6, latency: 0.0, availability: 0.0 }, // Invalid: sum > 1 (0.5 + 0.6 = 1.1)
        defaultProvider: 'openai', // Optional, but good to have for partial validity
        defaultModel: 'gpt-4',    // Optional
      },
      featureFlags: {} // Optional
    } as unknown as ProviderConfiguration;

    try {
      await configurationService.updateConfiguration(invalidConfig);
      fail('Should have thrown an error for invalid configuration');
    } catch (error: any) {
      expect(error).toBeInstanceOf(Error);
      // Check for the specific error message from validateConfiguration
      expect(error.message).toContain('Invalid configuration'); 
      expect(error.message).toContain('Routing weights must sum to 1');
    }
  });

  test('getConfiguration should return default if DynamoDB fetch fails catastrophically (simulated)', async () => {
    // Simulate a dbProvider failure
    const originalGetItem = dbProvider.getItem;
    dbProvider.getItem = jest.fn().mockRejectedValue(new Error('Simulated DynamoDB Unavailability'));

    // Explicitly invalidate the cache for this test
    (configurationService as any).lastFetched = 0;
    (configurationService as any).cachedConfiguration = null;

    const config = await configurationService.getConfiguration();
    const defaultConfig = (configurationService as any).getDefaultConfiguration();
    expect(config.version).toBe(defaultConfig.version);
    expect(config.providers.openai?.active).toBe(true);

    dbProvider.getItem = originalGetItem; // Restore original method
  });

  test('updateConfiguration should create item if it does not initially exist', async () => {
    // Ensure item is not in DB (afterEach should handle this, but good for clarity)
    await mockDdbDocClient.send(new DeleteCommand({
      TableName: TEST_TABLE_NAME,
      Key: { configId: TEST_CONFIG_ID },
    }));

    const newConfig = getSampleConfig('2.0.0-new');
    await configurationService.updateConfiguration(newConfig); // Should create the item

    // Verify directly from DB
    const { Item } = await mockDdbDocClient.send(new GetCommand({
      TableName: TEST_TABLE_NAME,
      Key: { configId: TEST_CONFIG_ID },
    }));

    expect(Item).toBeDefined();
    expect(Item?.configId).toBe(TEST_CONFIG_ID);
    expect(Item?.version).toBe('2.0.0-new');
    expect(Item?.configData).toEqual(newConfig); // The service stores the full config under configData

    // Also verify that getConfiguration now returns this new config (and populates cache)
    const fetchedConfig = await configurationService.getConfiguration();
    expect(fetchedConfig).toEqual(newConfig);
  });

  test('getConfiguration should fetch from DB if cache is empty but item exists in DB', async () => {
    const dbConfig = getSampleConfig('3.0.0-db-only');
    // Put item directly into DB, bypassing the service's cache
    await mockDdbDocClient.send(new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: { configId: TEST_CONFIG_ID, configData: dbConfig, version: dbConfig.version, lastUpdated: new Date().toISOString() },
    }));

    // Create a new instance of the service or reset cache to ensure it's not cached.
    // For simplicity, we will rely on afterEach cleaning up, and this test inserting directly.
    // If we were concerned about interaction between tests, a new service instance would be better here.
    // Let's clear the cache by fast-forwarding time past TTL and fetching (which would fetch default if item wasn't there)
    // then try to fetch our specific item.

    // To ensure cache is considered stale for the main configurationService instance:
    (configurationService as any).lastFetched = 0; // Force cache to be considered stale

    const fetchedConfig = await configurationService.getConfiguration();
    expect(fetchedConfig).toBeDefined();
    expect(fetchedConfig.version).toBe('3.0.0-db-only');
    expect(fetchedConfig).toEqual(dbConfig);
  });
}); 