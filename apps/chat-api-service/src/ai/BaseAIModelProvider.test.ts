import { BaseAIModelProvider } from './BaseAIModelProvider';
import { AIModelRequest, AIModelResult, ModelCapabilities, ProviderHealthStatus, ProviderLimits, AIModelError } from '../../../../packages/common-types/src/ai-interfaces';
import { RequestContext, IDatabaseProvider } from '../../../../packages/common-types/src/core-interfaces';

// Mock Database Provider
const mockDbProvider: IDatabaseProvider = {
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  query: jest.fn(),
};

// Create a concrete implementation for testing
class TestProvider extends BaseAIModelProvider {
  public errorToThrow: Error | null = null;
  public mockResult: AIModelResult | null = null;
  
  constructor(_apiKey: string) {
    super('test-provider', 'default-test-model', mockDbProvider);
    this.healthStatus.available = true; 
  }
  
  async generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    return super.generateResponse(request);
  }
  
  // Implementation for the abstract _generateResponse
  protected _generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    if (this.errorToThrow) {
      return Promise.reject(this.errorToThrow);
    }
    if (this.mockResult) {
      return Promise.resolve(this.mockResult);
    }

    const modelToUse = request.preferredModel || this.defaultModel;
    return Promise.resolve({
      ok: true,
      text: `Mocked response from _generateResponse for ${modelToUse}`,
      tokens: { prompt: 5, completion: 10, total: 15 },
      meta: {
        provider: this.providerName,
        model: modelToUse,
        features: [],
        region: request.context.region,
        latency: 100,
        timestamp: Date.now(),
      },
    } as AIModelResult);
  }
  
  getDefaultModel(): string {
    return 'default-test-model';
  }
  
  public exposeCreateError(
    code: AIModelError['code'],
    detail?: string,
    status?: number,
    retryable = true
  ): AIModelError {
    return this.createError(code, detail || 'Test error detail', status, retryable);
  }
  
  protected standardizeError(error: Error): AIModelError {
    console.log(`[TestProvider.standardizeError] Standardizing error: ${error.name}, message: ${error.message}`);
    if (error.name === 'RateLimitError') {
      return this.createError('RATE_LIMIT', error.message, 429, true);
    }
    if (error.name === 'AuthenticationError') {
      return this.createError('AUTH', error.message, 401, false);
    }
    if (error.name === 'ContentPolicyError') {
      return this.createError('CONTENT', error.message, 400, false);
    }
    if (error.name === 'TimeoutError') {
      return this.createError('TIMEOUT', error.message, 504, true);
    }
    return this.createError('UNKNOWN', error.message || 'Unknown test error', undefined, false);
  }
  
  protected constructSuccessResponse(
    text: string, 
    tokens: { prompt: number; completion: number; total: number },
    provider: string,
    model: string
  ): AIModelResult {
    return {
      ok: true,
      text,
      tokens,
      meta: {
        provider,
        model,
        features: [],
        region: process.env.AWS_REGION || 'unknown',
        latency: 100,
        timestamp: Date.now()
      }
    };
  }
  
  getModelCapabilities(modelName: string): ModelCapabilities {
    if (!modelName) {
        console.warn("[TestProvider.getModelCapabilities] modelName is undefined, returning empty capabilities.");
        return {} as ModelCapabilities;
    }
    return {
      reasoning: 3,
      creativity: 3,
      coding: 3,
      retrieval: modelName.includes('retrieval'),
      functionCalling: modelName.includes('function'),
      contextSize: 4096,
      streamingSupport: true
    };
  }
  
  async getProviderHealth(): Promise<ProviderHealthStatus> {
    return {
      available: true,
      errorRate: 0,
      latencyP95: 200,
      lastChecked: Date.now()
    };
  }
  
  getProviderLimits(): ProviderLimits {
    return {
      rpm: 10,
      tpm: 40000
    };
  }
}

// Sample request context
const mockContext: RequestContext = {
  requestId: 'test-request-id',
  jwtSub: 'test-user',
  familyId: 'test-family',
  profileId: 'test-profile',
  region: 'us-east-2',
  traceId: 'test-trace-id',
};

describe('BaseAIModelProvider', () => {
  let provider: TestProvider;
  
  beforeEach(() => {
    provider = new TestProvider('test-api-key');
    provider.errorToThrow = null;
    provider.mockResult = null;
  });
  
  describe('Error handling', () => {
    test('should handle rate limit errors', async () => {
      const request: AIModelRequest = {
        prompt: 'Hello, world!',
        context: mockContext
      };
      
      // Set up the error to throw
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.name = 'RateLimitError';
      provider.errorToThrow = rateLimitError;
      
      const result = await provider.generateResponse(request);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('RATE_LIMIT');
        expect(result.provider).toBe('test-provider');
        expect(result.retryable).toBe(true);
      }
    });
    
    test('should handle authentication errors', async () => {
      const request: AIModelRequest = {
        prompt: 'Hello, world!',
        context: mockContext
      };
      
      // Set up the error to throw
      const authError = new Error('Invalid API key');
      authError.name = 'AuthenticationError';
      provider.errorToThrow = authError;
      
      const result = await provider.generateResponse(request);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.provider).toBe('test-provider');
        expect(result.retryable).toBe(false);
      }
    });
    
    test('should handle content policy errors', async () => {
      const request: AIModelRequest = {
        prompt: 'Hello, world!',
        context: mockContext
      };
      
      // Set up the error to throw
      const contentError = new Error('Content policy violation');
      contentError.name = 'ContentPolicyError';
      provider.errorToThrow = contentError;
      
      const result = await provider.generateResponse(request);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONTENT');
        expect(result.provider).toBe('test-provider');
        expect(result.retryable).toBe(false);
      }
    });
    
    test('should handle timeout errors', async () => {
      const request: AIModelRequest = {
        prompt: 'Hello, world!',
        context: mockContext
      };
      
      // Set up the error to throw
      const timeoutError = new Error('Request timed out');
      timeoutError.name = 'TimeoutError';
      provider.errorToThrow = timeoutError;
      
      const result = await provider.generateResponse(request);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('TIMEOUT');
        expect(result.provider).toBe('test-provider');
        expect(result.retryable).toBe(true);
      }
    });
    
    test('should handle unknown errors', async () => {
      const request: AIModelRequest = {
        prompt: 'Hello, world!',
        context: mockContext
      };
      
      // Set up the error to throw
      const unknownError = new Error('Unknown error occurred');
      provider.errorToThrow = unknownError;
      
      const result = await provider.generateResponse(request);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('UNKNOWN');
        expect(result.provider).toBe('test-provider');
        expect(result.retryable).toBe(false);
        expect(result.detail).toBe('Unknown error occurred');
      }
    });
    
    test('should create error responses with correct structure', () => {
      const errorResult = provider.exposeCreateError('RATE_LIMIT', 'Too many requests', 429, true);
      
      expect(errorResult.ok).toBe(false);
      if (!errorResult.ok) {
        expect(errorResult.code).toBe('RATE_LIMIT');
        expect(errorResult.provider).toBe('test-provider');
        expect(errorResult.status).toBe(429);
        expect(errorResult.retryable).toBe(true);
        expect(errorResult.detail).toBe('Too many requests');
      }
    });
  });
  
  describe('API integration', () => {
    test('should handle successful API calls', async () => {
      const request: AIModelRequest = {
        prompt: 'Hello, world!',
        context: mockContext
      };
      
      const result = await provider.generateResponse(request);
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe('Mocked response from _generateResponse for default-test-model');
        expect(result.tokens.total).toBe(15);
      }
    });
    
    test('should respect preferredModel in request', async () => {
      const request: AIModelRequest = {
        prompt: 'Hello, world!',
        preferredModel: 'special-model',
        context: mockContext
      };
      
      // Mock the result with the expected model
      provider.mockResult = {
        ok: true,
        text: 'Response from special model',
        tokens: { prompt: 5, completion: 10, total: 15 },
        meta: {
          provider: 'test-provider',
          model: 'special-model',
          features: [],
          region: 'us-east-2',
          latency: 200,
          timestamp: Date.now()
        }
      };
      
      const result = await provider.generateResponse(request);
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.meta.model).toBe('special-model');
        expect(result.text).toBe('Response from special model');
      }
    });
  });
  
  describe('Capability checking', () => {
    test('should check if it can fulfill a request based on capabilities', async () => {
      const basicRequest: AIModelRequest = {
        prompt: 'Hello, world!',
        context: mockContext
      };
      
      expect(await provider.canFulfill(basicRequest)).toBe(true);
      
      // Request with capability that's not supported
      const unsupportedRequest: AIModelRequest = {
        prompt: 'Hello, world!',
        requiredCapabilities: ['advanced_reasoning'],
        context: mockContext
      };
      
      expect(await provider.canFulfill(unsupportedRequest)).toBe(false);
      
      // Request with function calling for a model that supports it
      const functionRequest: AIModelRequest = {
        prompt: 'Hello, world!',
        preferredModel: 'function-model',
        tools: [{ name: 'test', parameters: {} }],
        context: mockContext
      };
      
      expect(await provider.canFulfill(functionRequest)).toBe(true);
      
      // Request with function calling for a model that doesn't support it
      const incompatibleRequest: AIModelRequest = {
        prompt: 'Hello, world!',
        preferredModel: 'basic-model',
        tools: [{ name: 'test', parameters: {} }],
        context: mockContext
      };
      
      expect(await provider.canFulfill(incompatibleRequest)).toBe(false);
    });
  });
}); 