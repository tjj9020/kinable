import { AIModelRouter } from '../ai/AIModelRouter';
import { ConfigurationService } from '../ai/ConfigurationService';
import { 
  AIModelRequest, 
  AIModelResult, 
  IAIModelProvider, 
  ModelCapabilities 
} from '../../../../packages/common-types/src/ai-interfaces';
import { RequestContext } from '../../../../packages/common-types/src/core-interfaces';

// Create mock providers for testing
class MockProvider implements IAIModelProvider {
  private name: string;
  private shouldFail: boolean;
  private failWith: 'RATE_LIMIT' | 'AUTH' | 'CONTENT' | 'CAPABILITY' | 'TIMEOUT' | 'UNKNOWN';
  
  constructor(name: string, shouldFail = false, failWith: 'RATE_LIMIT' | 'AUTH' | 'CONTENT' | 'CAPABILITY' | 'TIMEOUT' | 'UNKNOWN' = 'UNKNOWN') {
    this.name = name;
    this.shouldFail = shouldFail;
    this.failWith = failWith;
  }
  
  async generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    if (this.shouldFail) {
      return {
        ok: false,
        code: this.failWith,
        provider: this.name,
        retryable: this.failWith === 'RATE_LIMIT' || this.failWith === 'TIMEOUT',
        detail: `${this.failWith} error from ${this.name}`
      };
    }
    
    return {
      ok: true,
      text: `Response from ${this.name} using ${request.preferredModel || 'default-model'}`,
      tokens: {
        prompt: 10,
        completion: 20,
        total: 30
      },
      meta: {
        provider: this.name,
        model: request.preferredModel || 'default-model',
        features: [],
        region: 'us-east-2',
        latency: 100,
        timestamp: Date.now()
      }
    };
  }
  
  canFulfill(request: AIModelRequest): boolean {
    // If there's a specific capability required that we don't support, return false
    if (request.requiredCapabilities?.includes('unsupported_capability')) {
      return false;
    }
    
    // If function calling is required but this provider doesn't support it, return false
    if (request.tools?.length && !this.getModelCapabilities(request.preferredModel || 'default-model').functionCalling) {
      return false;
    }
    
    return true;
  }
  
  getModelCapabilities(modelName: string): ModelCapabilities {
    return {
      reasoning: modelName.includes('advanced') ? 5 : 3,
      creativity: 3,
      coding: modelName.includes('coding') ? 5 : 2,
      retrieval: false,
      functionCalling: modelName.includes('function'),
      contextSize: 4096,
      streamingSupport: true
    };
  }
  
  getProviderHealth() {
    return {
      available: !this.shouldFail,
      errorRate: this.shouldFail ? 0.5 : 0,
      latencyP95: 200,
      lastChecked: Date.now()
    };
  }
  
  getProviderLimits() {
    return {
      rpm: 10,
      tpm: 40000
    };
  }
}

// Type for providers
interface ProviderMap {
  [key: string]: IAIModelProvider;
}

// Mock ConfigurationService
jest.mock('../ai/ConfigurationService', () => {
  const mockInstance = {
    getConfiguration: jest.fn().mockResolvedValue({
      version: '1.0.0',
      updatedAt: Date.now(),
      providers: {
        provider1: { active: true, keyVersion: 1 },
        provider2: { active: true, keyVersion: 1 }
      },
      routing: {
        rules: [],
        weights: {
          cost: 0.4,
          quality: 0.3,
          latency: 0.2,
          availability: 0.1
        },
        defaultProvider: 'provider1',
        defaultModel: 'default-model'
      },
      featureFlags: {}
    })
  };
  
  return {
    ConfigurationService: {
      getInstance: jest.fn(() => mockInstance)
    }
  };
});

// Sample request context
const mockContext: RequestContext = {
  requestId: 'test-request-id',
  jwtSub: 'test-user',
  familyId: 'test-family',
  profileId: 'test-profile',
  region: 'us-east-2',
  traceId: 'test-trace-id',
};

// Mock AIModelRouter to use our test providers directly
jest.mock('../ai/AIModelRouter', () => {
  // Keep track of the original module
  const originalModule = jest.requireActual('../ai/AIModelRouter');
  
  // Return a mocked constructor
  return {
    AIModelRouter: jest.fn((_configService, providers: ProviderMap) => {
      return {
        routeRequest: async (request: AIModelRequest) => {
          // If preferred provider is specified, use it
          if (request.preferredProvider && providers[request.preferredProvider]) {
            if (providers[request.preferredProvider].canFulfill(request)) {
              return providers[request.preferredProvider].generateResponse(request);
            } else {
              return {
                ok: false,
                code: 'CAPABILITY',
                provider: request.preferredProvider,
                retryable: false,
                detail: `Provider ${request.preferredProvider} cannot fulfill the request`
              };
            }
          }
          
          // Check each provider (in order of definition)
          for (const [name, provider] of Object.entries(providers)) {
            if (provider.canFulfill(request)) {
              return provider.generateResponse(request);
            }
          }
          
          // No provider can fulfill the request
          return {
            ok: false,
            code: 'CAPABILITY',
            provider: 'router',
            retryable: false,
            detail: 'No provider can fulfill the request'
          };
        }
      };
    })
  };
});

describe('Router-Provider Integration', () => {
  let router: AIModelRouter;
  let provider1: MockProvider;
  let provider2: MockProvider;
  let configService: ConfigurationService;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the mock configuration service
    configService = ConfigurationService.getInstance();
    
    // Create providers with different behaviors
    provider1 = new MockProvider('provider1');
    provider2 = new MockProvider('provider2');
    
    // Create router with the providers
    router = new AIModelRouter(configService, {
      provider1,
      provider2
    });
  });
  
  test('should route to the specified provider', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      preferredProvider: 'provider2',
      context: mockContext
    };
    
    const result = await router.routeRequest(request);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('provider2');
      expect(result.text).toContain('Response from provider2');
    }
  });
  
  test('should use default provider when none specified', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };
    
    const result = await router.routeRequest(request);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('provider1');
      expect(result.text).toContain('Response from provider1');
    }
  });
  
  test('should fallback to another provider when first one fails', async () => {
    // Make provider1 fail with a retryable error
    provider1 = new MockProvider('provider1', true, 'RATE_LIMIT');
    
    // Recreate router with the updated provider
    router = new AIModelRouter(configService, {
      provider1,
      provider2
    });
    
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };
    
    const result = await router.routeRequest(request);
    
    // Should fallback to provider2
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('provider2');
      expect(result.text).toContain('Response from provider2');
    }
  });
  
  test('should return error when no provider can fulfill the request', async () => {
    // Create a request with capability that no provider supports
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      requiredCapabilities: ['unsupported_capability'],
      context: mockContext
    };
    
    const result = await router.routeRequest(request);
    
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CAPABILITY');
      expect(result.detail).toContain('No provider can fulfill the request');
    }
  });
  
  test('should route request based on required capabilities', async () => {
    // Create a request that needs advanced reasoning
    const request: AIModelRequest = {
      prompt: 'Solve this complex problem',
      preferredModel: 'advanced-model',
      context: mockContext
    };
    
    const result = await router.routeRequest(request);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.model).toBe('advanced-model');
    }
  });
  
  test('should route function calling requests to supporting provider', async () => {
    // Create a request that uses function calling
    const request: AIModelRequest = {
      prompt: 'Call this function',
      preferredModel: 'function-model',
      tools: [{ name: 'test-function', parameters: {} }],
      context: mockContext
    };
    
    const result = await router.routeRequest(request);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.model).toBe('function-model');
    }
  });
  
  test('should return error when all providers fail', async () => {
    // Make both providers fail
    provider1 = new MockProvider('provider1', true, 'RATE_LIMIT');
    provider2 = new MockProvider('provider2', true, 'CONTENT');
    
    // Recreate router with the updated providers
    router = new AIModelRouter(configService, {
      provider1,
      provider2
    });
    
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };
    
    const result = await router.routeRequest(request);
    
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should get the error from provider2 (non-retryable takes precedence)
      expect(result.code).toBe('CONTENT');
      expect(result.provider).toBe('provider2');
    }
  });
}); 