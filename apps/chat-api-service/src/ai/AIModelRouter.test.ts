import { AIModelRouter } from './AIModelRouter';
import { ConfigurationService } from './ConfigurationService';
import { OpenAIModelProvider } from './OpenAIModelProvider';
import { AIModelRequest, AIModelResult, IAIModelProvider, AIModelError } from '../../../../packages/common-types/src/ai-interfaces';
import { ProviderConfiguration } from '../../../../packages/common-types/src/config-schema';
import { RequestContext } from '../../../../packages/common-types/src/core-interfaces';

// Mock ConfigurationService to return a mock constructor
const mockGetConfiguration = jest.fn();
jest.mock('./ConfigurationService', () => {
  return {
    ConfigurationService: jest.fn().mockImplementation(() => {
      return {
        getConfiguration: mockGetConfiguration,
        // Add mocks for any other methods of ConfigurationService used by AIModelRouter if necessary
      };
    }),
  };
});

// Mock OpenAIModelProvider (top-level)
const mockOpenAIGenerateResponse = jest.fn();
const mockOpenAICanFulfill = jest.fn().mockReturnValue(true);
const mockOpenAIGetModelCapabilities = jest.fn().mockReturnValue({}); // Add default mock
const mockOpenAIGetProviderHealth = jest.fn().mockReturnValue({}); // Add default mock
const mockOpenAIGetProviderLimits = jest.fn().mockReturnValue({}); // Add default mock

jest.mock('./OpenAIModelProvider', () => {
  return {
    OpenAIModelProvider: jest.fn().mockImplementation((_secretId, _awsClientRegion) => {
      return {
        generateResponse: mockOpenAIGenerateResponse,
        canFulfill: mockOpenAICanFulfill,
        getModelCapabilities: mockOpenAIGetModelCapabilities,
        getProviderHealth: mockOpenAIGetProviderHealth,
        getProviderLimits: mockOpenAIGetProviderLimits,
      };
    })
  };
});

// Create a mock provider
const createMockProvider = (name: string, canFulfill = true, shouldSucceed = true): IAIModelProvider => {
  return {
    generateResponse: jest.fn().mockImplementation(async (_request: AIModelRequest): Promise<AIModelResult> => {
      if (shouldSucceed) {
        return {
          ok: true,
          text: `Response from ${name}`,
          tokens: { prompt: 10, completion: 5, total: 15 },
          meta: {
            provider: name,
            model: 'test-model',
            features: [],
            region: 'us-east-2',
            latency: 100,
            timestamp: Date.now()
          }
        };
      } else {
        return {
          ok: false,
          code: 'UNKNOWN',
          provider: name,
          detail: 'Test error',
          retryable: false
        };
      }
    }),
    canFulfill: jest.fn().mockReturnValue(canFulfill),
    getModelCapabilities: jest.fn().mockReturnValue({
      reasoning: 3,
      creativity: 3,
      coding: 3,
      retrieval: false,
      functionCalling: false,
      contextSize: 4096,
      streamingSupport: true
    }),
    getProviderHealth: jest.fn().mockReturnValue({
      available: true,
      errorRate: 0,
      latencyP95: 200,
      lastChecked: Date.now()
    }),
    getProviderLimits: jest.fn().mockReturnValue({
      rpm: 20,
      tpm: 80000
    })
  };
};

// Sample request context
const mockContext: RequestContext = {
  requestId: 'test-request-id',
  jwtSub: 'test-user',
  familyId: 'test-family',
  profileId: 'test-profile',
  region: 'us-east-2',
  traceId: 'test-trace-id',
};

describe('AIModelRouter', () => {
  let router: AIModelRouter;
  let mockConfigServiceInstance: ConfigurationService;
  let mockGenericOpenAIProvider: IAIModelProvider;
  let MockedOpenAIModelProviderConstructor: jest.MockedClass<typeof OpenAIModelProvider>;

  const MOCK_OPENAI_SECRET_ID = 'mock-openai-secret-id';
  const MOCK_AWS_CLIENT_REGION = 'us-west-2';

  beforeEach(() => {
    jest.clearAllMocks();

    MockedOpenAIModelProviderConstructor = OpenAIModelProvider as jest.MockedClass<typeof OpenAIModelProvider>;

    mockConfigServiceInstance = new (ConfigurationService as any)() as ConfigurationService;
    
    mockGetConfiguration.mockReset();
    // Expanded mock ProviderConfiguration to satisfy the ProviderConfig interface more completely
    mockGetConfiguration.mockResolvedValue({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: {
          active: true,
          keyVersion: 1,
          secretId: MOCK_OPENAI_SECRET_ID, 
          endpoints: { // Added
            default: {
              url: 'https://api.openai.com/v1',
              region: 'global',
              priority: 1,
              active: true,
            }
          },
          models: { // Added
            'gpt-3.5-turbo': {
              tokenCost: 0.002,
              priority: 1,
              capabilities: ['general', 'chat'],
              contextSize: 4096,
              streamingSupport: true,
              functionCalling: true,
              active: true,
              rolloutPercentage: 100,
            },
            'gpt-4': {
              tokenCost: 0.03,
              priority: 2,
              capabilities: ['general', 'chat', 'reasoning', 'coding'],
              contextSize: 8192,
              streamingSupport: true,
              functionCalling: true,
              active: true,
              rolloutPercentage: 100,
            }
          },
          rateLimits: { rpm: 100, tpm: 100000 }, // Added
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 }, // Added
          apiVersion: 'v1', // Added
          rolloutPercentage: 100, // Added
        }
      },
      routing: {
        rules: [],
        weights: {
          cost: 0.4,
          quality: 0.3,
          latency: 0.2,
          availability: 0.1
        },
        defaultProvider: 'openai',
        defaultModel: 'gpt-3.5-turbo'
      },
      featureFlags: {}
    } as ProviderConfiguration);
    
    mockGenericOpenAIProvider = createMockProvider('openai');
    
    router = new AIModelRouter(
      mockConfigServiceInstance, 
      MOCK_OPENAI_SECRET_ID,
      MOCK_AWS_CLIENT_REGION,
      { openai: mockGenericOpenAIProvider } 
    );
  });

  test('should initialize correctly', () => {
    expect(router).toBeDefined();
    // Configuration is now fetched inside the constructor to set up default provider if necessary
    // or if the defaultProvider logic relies on it immediately.
    // Depending on AIModelRouter's internal logic, getConfiguration might be called once or not at all here
    // if initialProviders pre-populates the default.
    // Let's check if it's called at least once if defaultProvider is openai and not in initialProviders.
    // For this specific setup where initialProviders *does* include openai, it might not call getConfiguration for initialization.
    // However, routeRequest will call it.
    // The test below for routeRequest is a better place to check getConfiguration calls.
  });

  test('should route to the specified provider', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      preferredProvider: 'openai',
      context: mockContext
    };

    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockClear(); 
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockResolvedValueOnce({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: {
          active: true, keyVersion: 1, secretId: MOCK_OPENAI_SECRET_ID,
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, defaultProvider: 'openai', defaultModel: 'gpt-3.5-turbo' },
      featureFlags: {}
    } as ProviderConfiguration);

    const result = await router.routeRequest(request);
    
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    expect(mockGenericOpenAIProvider.canFulfill).toHaveBeenCalledWith(request);
    expect(mockGenericOpenAIProvider.generateResponse).toHaveBeenCalledWith(request);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Response from openai');
    }
  });

  test('should use default provider if none specified', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockClear(); 
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockResolvedValueOnce({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: {
          active: true, keyVersion: 1, secretId: MOCK_OPENAI_SECRET_ID,
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, defaultProvider: 'openai', defaultModel: 'gpt-3.5-turbo' },
      featureFlags: {}
    } as ProviderConfiguration);

    const result = await router.routeRequest(request);
    
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    expect(mockGenericOpenAIProvider.generateResponse).toHaveBeenCalledWith(request);
    expect(result.ok).toBe(true);
  });

  test('should return error if provider cannot fulfill request', async () => {
    const cannotFulfillProvider = createMockProvider('openai', false);
    router.clearProviders();
    router.addProvider('openai', cannotFulfillProvider);
    
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };
    
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockClear();
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockResolvedValueOnce({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: {
          active: true, keyVersion: 1, secretId: MOCK_OPENAI_SECRET_ID,
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, defaultProvider: 'openai', defaultModel: 'gpt-3.5-turbo' },
      featureFlags: {}
    } as ProviderConfiguration);

    const result = await router.routeRequest(request);
    
    expect(cannotFulfillProvider.canFulfill).toHaveBeenCalledWith(request);
    expect(cannotFulfillProvider.generateResponse).not.toHaveBeenCalled();
    
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CAPABILITY');
    }
  });

  test('should pass through provider errors', async () => {
    const errorProvider = createMockProvider('openai', true, false);
    router.clearProviders();
    router.addProvider('openai', errorProvider);
    
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };

    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockClear();
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockResolvedValueOnce({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: {
          active: true, keyVersion: 1, secretId: MOCK_OPENAI_SECRET_ID,
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, defaultProvider: 'openai', defaultModel: 'gpt-3.5-turbo' },
      featureFlags: {}
    } as ProviderConfiguration);

    const result = await router.routeRequest(request);
    
    expect(errorProvider.canFulfill).toHaveBeenCalledWith(request);
    expect(errorProvider.generateResponse).toHaveBeenCalledWith(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNKNOWN');
    }
  });

  test('should dynamically initialize OpenAI provider if not present', async () => {
    router.clearProviders(); // Ensure no 'openai' provider exists initially

    const request: AIModelRequest = {
      prompt: 'Initialize OpenAI',
      preferredProvider: 'openai',
      context: mockContext
    };

    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockClear();
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockResolvedValueOnce({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: { 
          active: true, keyVersion: 1, secretId: MOCK_OPENAI_SECRET_ID,
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, defaultProvider: 'openai', defaultModel: 'gpt-3.5-turbo' },
      featureFlags: {}
    } as ProviderConfiguration);

    // Reset the top-level mock and its instance methods for this specific test
    MockedOpenAIModelProviderConstructor.mockClear();
    mockOpenAIGenerateResponse.mockClear();
    mockOpenAICanFulfill.mockClear(); // Clear other methods too if they might be called

    // Configure the mock response for generateResponse for this dynamic initialization
    mockOpenAIGenerateResponse.mockResolvedValueOnce({
      ok: true,
      text: 'Response from dynamically initialized OpenAI',
      tokens: { prompt: 5, completion: 5, total: 10 },
      meta: { provider: 'openai', model: 'test-dynamic-model', features:[], region: MOCK_AWS_CLIENT_REGION, latency: 50, timestamp: Date.now() }
    });

    const result = await router.routeRequest(request);
    
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    // Check that the OpenAIModelProvider constructor was called by initializeOpenAI
    expect(MockedOpenAIModelProviderConstructor).toHaveBeenCalledTimes(1);
    expect(MockedOpenAIModelProviderConstructor).toHaveBeenCalledWith(MOCK_OPENAI_SECRET_ID, MOCK_AWS_CLIENT_REGION);
    
    // Check that the method on the (mocked) dynamically created instance was called
    expect(mockOpenAIGenerateResponse).toHaveBeenCalledTimes(1);
    expect(mockOpenAIGenerateResponse).toHaveBeenCalledWith(request);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Response from dynamically initialized OpenAI');
    }
  });

  test('should handle error during OpenAI provider initialization', async () => {
    router.clearProviders(); // Ensure no 'openai' provider exists initially

    const request: AIModelRequest = {
      prompt: 'Initialize OpenAI',
      preferredProvider: 'openai',
      context: mockContext
    };

    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockClear();
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockResolvedValueOnce({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: { 
          active: true, keyVersion: 1, secretId: MOCK_OPENAI_SECRET_ID,
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, defaultProvider: 'openai', defaultModel: 'gpt-3.5-turbo' },
      featureFlags: {}
    } as ProviderConfiguration);

    // Configure the OpenAIModelProvider mock constructor to throw an error for this test
    MockedOpenAIModelProviderConstructor.mockClear();
    const initError = new Error('Failed to initialize OpenAI provider');
    MockedOpenAIModelProviderConstructor.mockImplementation((_secretId, _awsClientRegion) => {
      throw initError;
    });

    const result = await router.routeRequest(request);

    expect(mockGetConfiguration).toHaveBeenCalledTimes(1); // config is fetched first
    expect(MockedOpenAIModelProviderConstructor).toHaveBeenCalledTimes(1); // Attempt to construct
    
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as AIModelError).code).toBe('UNKNOWN'); // Router itself should catch this and return an error
      expect((result as AIModelError).detail).toContain('Error routing request: Failed to initialize OpenAI provider');
    }

    // Reset mock implementation for subsequent tests to the default top-level mock behavior
    MockedOpenAIModelProviderConstructor.mockImplementation((_secretId, _awsClientRegion) => {
      // The arguments secretId and awsClientRegion must be declared to match the original constructor's signature,
      // but they are not used in creating this specific mock instance's behavior.
      return {
        generateResponse: mockOpenAIGenerateResponse,
        canFulfill: mockOpenAICanFulfill,
        getModelCapabilities: mockOpenAIGetModelCapabilities,
        getProviderHealth: mockOpenAIGetProviderHealth,
        getProviderLimits: mockOpenAIGetProviderLimits,
      } as unknown as OpenAIModelProvider; // Cast to satisfy the return type for the mock
    });
  });

  test('should use default provider from config if preferredProvider is not in providers map and cannot be initialized', async () => {
    router.clearProviders(); // Ensure no 'openai' provider exists initially

    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };

    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockClear();
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockResolvedValueOnce({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: { 
          active: true, keyVersion: 1, secretId: MOCK_OPENAI_SECRET_ID,
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, defaultProvider: 'openai', defaultModel: 'gpt-3.5-turbo' },
      featureFlags: {}
    } as ProviderConfiguration);

    // Reset the top-level mock for generateResponse before this call to ensure clean state for this test
    mockOpenAIGenerateResponse.mockClear();
    mockOpenAIGenerateResponse.mockResolvedValueOnce({
      ok: true,
      text: 'Response from default (dynamically initialized openai)',
      tokens: { prompt: 10, completion: 5, total: 15 },
      meta: { provider: 'openai', model:'gpt-3.5-turbo', features: [], region: MOCK_AWS_CLIENT_REGION, latency: 100, timestamp: Date.now() }
    });

    const result = await router.routeRequest(request);
    
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    // The router will dynamically initialize 'openai' using the top-level mock.
    // So we check the top-level mock function for the generateResponse call.
    expect(mockOpenAIGenerateResponse).toHaveBeenCalledWith(request);
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.text).toBe('Response from default (dynamically initialized openai)');
    }
  });

  test('should dynamically initialize OpenAI provider if not present and use default provider from config', async () => {
    router.clearProviders(); // Ensure no 'openai' provider exists initially

    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };

    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockClear();
    (mockConfigServiceInstance.getConfiguration as jest.Mock).mockResolvedValueOnce({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: { 
          active: true, keyVersion: 1, secretId: MOCK_OPENAI_SECRET_ID,
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, defaultProvider: 'openai', defaultModel: 'gpt-3.5-turbo' },
      featureFlags: {}
    } as ProviderConfiguration);

    // Reset the top-level mock for generateResponse before this call to ensure clean state for this test
    mockOpenAIGenerateResponse.mockClear();
    mockOpenAIGenerateResponse.mockResolvedValueOnce({
      ok: true,
      text: 'Response from default (dynamically initialized openai)',
      tokens: { prompt: 10, completion: 5, total: 15 },
      meta: { provider: 'openai', model:'gpt-3.5-turbo', features: [], region: MOCK_AWS_CLIENT_REGION, latency: 100, timestamp: Date.now() }
    });

    const result = await router.routeRequest(request);
    
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    // The router will dynamically initialize 'openai' using the top-level mock.
    // So we check the top-level mock function for the generateResponse call.
    expect(mockOpenAIGenerateResponse).toHaveBeenCalledWith(request);
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.text).toBe('Response from default (dynamically initialized openai)');
    }
  });
}); 