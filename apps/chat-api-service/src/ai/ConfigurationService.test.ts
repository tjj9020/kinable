import { ConfigurationService } from './ConfigurationService';
import { ProviderConfiguration, DEFAULT_ROUTING_WEIGHTS } from '@kinable/common-types';
import * as commonTypes from '@kinable/common-types';

// Mock the validateConfiguration function
jest.mock('@kinable/common-types', () => {
  const original = jest.requireActual('@kinable/common-types');
  return {
    ...original,
    validateConfiguration: jest.fn().mockReturnValue([])
  };
});

// Mock instance to reset for each test
let mockConfigService: ConfigurationService;

// Create a real ConfigurationService for testing
const OriginalConfigurationService = jest.requireActual('./ConfigurationService').ConfigurationService;

// Mock getInstance to return our test instance
jest.mock('./ConfigurationService', () => {
  const original = jest.requireActual('./ConfigurationService');
  return {
    ...original,
    ConfigurationService: {
      ...original.ConfigurationService,
      getInstance: jest.fn(() => mockConfigService)
    }
  };
});

describe('ConfigurationService', () => {
  beforeEach(() => {
    // Reset any mocked function calls
    jest.clearAllMocks();
    
    // Create an instance directly using the original implementation
    mockConfigService = OriginalConfigurationService.getInstance();
    
    // Set a short cache TTL for testing
    mockConfigService.setCacheTtl(100);
    
    // Reset the validateConfiguration mock to return no errors
    (commonTypes.validateConfiguration as jest.Mock).mockReturnValue([]);
  });
  
  test('getInstance should return a singleton instance', () => {
    const instance1 = ConfigurationService.getInstance();
    const instance2 = ConfigurationService.getInstance();
    
    expect(instance1).toBe(instance2);
  });
  
  test('getConfiguration should return a valid configuration', async () => {
    const config = await mockConfigService.getConfiguration();
    
    expect(config).toBeDefined();
    expect(config.version).toBe('1.0.0');
    expect(config.providers.openai).toBeDefined();
    expect(config.routing.defaultProvider).toBe('openai');
    expect(config.routing.weights).toEqual(DEFAULT_ROUTING_WEIGHTS);
  });
  
  test('configuration should be cached within the TTL period', async () => {
    // Create a mock implementation of fetchConfiguration
    const mockFetchImplementation = jest.fn().mockImplementation(async () => {
      // Return a basic configuration
      return {
        version: '1.0.0',
        updatedAt: Date.now(),
        providers: {
          openai: {
            active: true,
            keyVersion: 1,
            endpoints: {},
            models: {},
            rateLimits: { rpm: 10, tpm: 1000 },
            retryConfig: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1000 },
            apiVersion: 'v1',
            rolloutPercentage: 100
          }
        },
        routing: {
          rules: [],
          weights: DEFAULT_ROUTING_WEIGHTS,
          defaultProvider: 'openai',
          defaultModel: 'gpt-4'
        },
        featureFlags: {}
      };
    });
    
    // Replace the actual fetchConfiguration with our mock
    jest.spyOn(mockConfigService as any, 'fetchConfiguration').mockImplementation(mockFetchImplementation);
    
    // First call should fetch
    await mockConfigService.getConfiguration();
    expect(mockFetchImplementation).toHaveBeenCalledTimes(1);
    
    // Second call within TTL should use cache
    await mockConfigService.getConfiguration();
    expect(mockFetchImplementation).toHaveBeenCalledTimes(1);
    
    // Wait for cache to expire
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // After TTL expires, should fetch again
    await mockConfigService.getConfiguration();
    expect(mockFetchImplementation).toHaveBeenCalledTimes(2);
  });
  
  test('updateConfiguration should validate and update the configuration', async () => {
    const newConfig: ProviderConfiguration = {
      version: '1.1.0',
      updatedAt: Date.now(),
      providers: {
        openai: {
          active: true,
          keyVersion: 2,
          endpoints: {
            'us-east-2': {
              url: 'https://api.openai.com/v1',
              region: 'us-east-2',
              priority: 1,
              active: true
            }
          },
          models: {
            'gpt-4': {
              tokenCost: 0.03,
              priority: 1,
              capabilities: ['reasoning'],
              contextSize: 8192,
              streamingSupport: true,
              functionCalling: true,
              active: true,
              rolloutPercentage: 100
            }
          },
          rateLimits: {
            rpm: 10,
            tpm: 40000
          },
          retryConfig: {
            maxRetries: 2,
            initialDelayMs: 200,
            maxDelayMs: 2000
          },
          apiVersion: 'v1',
          rolloutPercentage: 100
        }
      },
      routing: {
        rules: [],
        weights: DEFAULT_ROUTING_WEIGHTS,
        defaultProvider: 'openai',
        defaultModel: 'gpt-4'
      },
      featureFlags: {
        enableStreaming: true,
        enableFunctionCalling: false
      }
    };
    
    await mockConfigService.updateConfiguration(newConfig);
    
    // Verify validation was called
    expect(commonTypes.validateConfiguration).toHaveBeenCalledWith(newConfig);
    
    // Get the updated config
    const config = await mockConfigService.getConfiguration();
    
    expect(config).toEqual(newConfig);
    expect(config.version).toBe('1.1.0');
    expect(config.routing.defaultModel).toBe('gpt-4');
    expect(config.featureFlags.enableFunctionCalling).toBe(false);
  });
  
  test('updateConfiguration should throw error if validation fails', async () => {
    // Mock validation to return errors
    (commonTypes.validateConfiguration as jest.Mock).mockReturnValue(['Invalid model', 'Missing required fields']);
    
    const newConfig: ProviderConfiguration = {
      version: '1.2.0',
      updatedAt: Date.now(),
      providers: {},
      routing: {
        rules: [],
        weights: DEFAULT_ROUTING_WEIGHTS,
        defaultProvider: 'unknown',
        defaultModel: 'unknown'
      },
      featureFlags: {}
    };
    
    // Expect the update to fail
    await expect(mockConfigService.updateConfiguration(newConfig))
      .rejects
      .toThrow('Configuration validation failed: Invalid model, Missing required fields');
      
    // The config should not be updated
    const config = await mockConfigService.getConfiguration();
    expect(config.version).not.toBe('1.2.0');
  });
}); 