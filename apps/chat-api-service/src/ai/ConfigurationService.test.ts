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

describe('ConfigurationService', () => {
  let configService: ConfigurationService;
  
  beforeEach(() => {
    // Reset any mocked function calls
    jest.clearAllMocks();
    
    // Get a fresh instance for each test
    configService = ConfigurationService.getInstance();
    
    // Set a short cache TTL for testing
    configService.setCacheTtl(100);
    
    // Reset the validateConfiguration mock to return no errors
    (commonTypes.validateConfiguration as jest.Mock).mockReturnValue([]);
  });
  
  test('getInstance should return a singleton instance', () => {
    const instance1 = ConfigurationService.getInstance();
    const instance2 = ConfigurationService.getInstance();
    
    expect(instance1).toBe(instance2);
  });
  
  test('getConfiguration should return a valid configuration', async () => {
    const config = await configService.getConfiguration();
    
    expect(config).toBeDefined();
    expect(config.version).toBe('1.0.0');
    expect(config.providers.openai).toBeDefined();
    expect(config.routing.defaultProvider).toBe('openai');
    expect(config.routing.weights).toEqual(DEFAULT_ROUTING_WEIGHTS);
  });
  
  test('configuration should be cached within the TTL period', async () => {
    // Spy on the fetchConfiguration method
    const fetchSpy = jest.spyOn(configService as any, 'fetchConfiguration');
    
    // First call should fetch
    await configService.getConfiguration();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    
    // Second call within TTL should use cache
    await configService.getConfiguration();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    
    // Wait for cache to expire
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // After TTL expires, should fetch again
    await configService.getConfiguration();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
    
    await configService.updateConfiguration(newConfig);
    
    // Verify validation was called
    expect(commonTypes.validateConfiguration).toHaveBeenCalledWith(newConfig);
    
    // Get the updated config
    const config = await configService.getConfiguration();
    
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
    await expect(configService.updateConfiguration(newConfig))
      .rejects
      .toThrow('Configuration validation failed: Invalid model, Missing required fields');
      
    // The config should not be updated
    const config = await configService.getConfiguration();
    expect(config.version).not.toBe('1.2.0');
  });
}); 