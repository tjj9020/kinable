import { AIModelRouter } from './AIModelRouter';
import { ConfigurationService } from './ConfigurationService';
import { AIModelRequest, AIModelResult, IAIModelProvider } from '../../../../packages/common-types/src/ai-interfaces';
import { RequestContext } from '../../../../packages/common-types/src/core-interfaces';

// Mock providers and configuration service
// jest.mock('./ConfigurationService'); // Remove auto-mock
jest.mock('./ConfigurationService', () => {
  // Create a mock instance with a jest.fn() for getConfiguration
  const mockInstance = {
    getConfiguration: jest.fn(),
    // Add mocks for any other methods used by AIModelRouter if necessary
  };
  // Mock the static getInstance method to return our controlled mock instance
  return {
    ConfigurationService: {
      getInstance: jest.fn(() => mockInstance),
    },
  };
});

// Create a mock provider
const createMockProvider = (name: string, canFulfill = true, shouldSucceed = true): IAIModelProvider => {
  return {
    generateResponse: jest.fn().mockImplementation(async (request: AIModelRequest): Promise<AIModelResult> => {
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
  let mockConfigServiceInstance: { getConfiguration: jest.Mock }; // Use the type of our manual mock instance
  let mockOpenAIProvider: IAIModelProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    // Get the *mocked* instance via the *mocked* getInstance
    mockConfigServiceInstance = ConfigurationService.getInstance() as unknown as { getConfiguration: jest.Mock };

    // Reset the mock before each test run
    mockConfigServiceInstance.getConfiguration.mockReset();

    // Setup mock configuration service response for this test suite
    mockConfigServiceInstance.getConfiguration.mockResolvedValue({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        openai: {
          active: true,
          keyVersion: 1,
          // ... other provider config
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
    });
    
    // Create mock provider
    mockOpenAIProvider = createMockProvider('openai');
    
    // Create router - it will receive the *correctly mocked* instance via getInstance()
    router = new AIModelRouter(mockConfigServiceInstance as unknown as ConfigurationService, {
      openai: mockOpenAIProvider
    });
  });

  test('should initialize correctly', () => {
    expect(router).toBeDefined();
  });

  test('should route to the specified provider', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      preferredProvider: 'openai',
      context: mockContext
    };

    const result = await router.routeRequest(request);
    
    expect(mockOpenAIProvider.canFulfill).toHaveBeenCalledWith(request);
    expect(mockOpenAIProvider.generateResponse).toHaveBeenCalledWith(request);
    
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

    const result = await router.routeRequest(request);
    
    expect(mockOpenAIProvider.generateResponse).toHaveBeenCalledWith(request);
    expect(result.ok).toBe(true);
  });

  test('should return error if provider cannot fulfill request', async () => {
    // Create a mock provider that cannot fulfill the request
    const cannotFulfillProvider = createMockProvider('openai', false);
    router.clearProviders();
    router.addProvider('openai', cannotFulfillProvider);
    
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };

    const result = await router.routeRequest(request);
    
    expect(cannotFulfillProvider.canFulfill).toHaveBeenCalledWith(request);
    expect(cannotFulfillProvider.generateResponse).not.toHaveBeenCalled();
    
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CAPABILITY');
    }
  });

  test('should pass through provider errors', async () => {
    // Create a mock provider that returns an error
    const errorProvider = createMockProvider('openai', true, false);
    router.clearProviders();
    router.addProvider('openai', errorProvider);
    
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };

    const result = await router.routeRequest(request);
    
    expect(errorProvider.canFulfill).toHaveBeenCalledWith(request);
    expect(errorProvider.generateResponse).toHaveBeenCalledWith(request);
    
    expect(result.ok).toBe(false);
  });
}); 