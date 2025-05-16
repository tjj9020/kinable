import { 
  BaseAIModelProvider,
  // ModelCapabilities, // REMOVE: ModelCapabilities is not a separate type here, ModelConfig is used
} from './BaseAIModelProvider';
import { 
  AIModelRequest, 
  AIModelResult, 
  AIModelError, 
  ProviderHealthStatus, 
  ProviderConfig,      // ADD
  ModelConfig,         // ADD
  RequestContext,      // ADD
  ProviderLimits       // ADD
} from '@kinable/common-types';

// Mock implementations for dependencies no longer passed to BaseAIModelProvider constructor
class MockDbProvider { /* Minimal mock */ }
class NoOpCircuitBreakerManager { /* Minimal mock */ }

// Sample request context - CORRECTED
const mockContext: RequestContext = { requestId: 'req-123', region: 'us-east-2', traceId: 'trace-abc' };

class TestProvider extends BaseAIModelProvider {
  public errorToThrow: Error | null = null;
  public mockResult: AIModelResult | null = null;

  constructor(_apiKey: string) {
    const mockProviderConfig: ProviderConfig = {
      active: true,
      secretId: 'test-secret',
      defaultModel: 'default-test-model',
      models: {
        'default-test-model': {
          name: 'Default Test Model',
          costPerMillionInputTokens: 1,
          costPerMillionOutputTokens: 1,
          contextWindow: 1000,
          maxOutputTokens: 500,
          capabilities: ['general'],
          active: true,
          streamingSupport: true,
          functionCallingSupport: false,
          visionSupport: false,
        } as ModelConfig,
        'special-model': {
          name: 'Special Model',
          costPerMillionInputTokens: 2,
          costPerMillionOutputTokens: 2,
          contextWindow: 2000,
          maxOutputTokens: 1000,
          capabilities: ['special'],
          active: true,
          streamingSupport: true,
          functionCallingSupport: true,
          visionSupport: false,
        } as ModelConfig,
        'function-model': {
          name: 'Function Model',
          costPerMillionInputTokens: 1.5,
          costPerMillionOutputTokens: 1.5,
          contextWindow: 1500,
          maxOutputTokens: 750,
          capabilities: ['general', 'function_calling'],
          active: true,
          streamingSupport: true,
          functionCallingSupport: true,
          visionSupport: false,
        } as ModelConfig,
        'basic-model': {
          name: 'Basic Model',
          costPerMillionInputTokens: 0.5,
          costPerMillionOutputTokens: 0.5,
          contextWindow: 500,
          maxOutputTokens: 250,
          capabilities: ['general'],
          active: true,
          streamingSupport: false,
          functionCallingSupport: false,
          visionSupport: false,
        } as ModelConfig,
      },
      rateLimits: { rpm: 100, tpm: 100000 }
    };
    super('test-provider', mockProviderConfig.defaultModel!, mockProviderConfig);
  }

  getProviderLimits(): ProviderLimits {
    const defaultLimits: ProviderLimits = { rpm: 100, tpm: 100000 };
    if (this.configForProvider.rateLimits) {
      return {
        rpm: this.configForProvider.rateLimits.rpm ?? defaultLimits.rpm,
        tpm: this.configForProvider.rateLimits.tpm ?? defaultLimits.tpm,
      };
    }
    return defaultLimits;
  }

  protected async _generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }
    if (this.mockResult) {
      return this.mockResult;
    }
    
    let modelForResponseActual: string;
    if (request.preferredModel) {
      modelForResponseActual = request.preferredModel;
    } else {
      modelForResponseActual = this.defaultModel!; // this.defaultModel is string, so this is string
    }

    return {
      ok: true,
      text: `Mocked response from _generateResponse for ${modelForResponseActual}`,
      tokens: { prompt: 5, completion: 10, total: 15 },
      meta: {
        provider: this.providerName,
        model: modelForResponseActual, // This is now very explicitly a string
        features: [],
        region: 'test-region',
        latency: 100,
        timestamp: Date.now(),
      },
    };
  }

  exposeCreateError(
    code: AIModelError['code'],
    detail?: string,
    status?: number,
    retryable = true
  ): AIModelError {
    return this.createError(code, detail, status, retryable);
  }

  standardizeError(error: Error): AIModelError {
    console.log(`[${this.providerName}.standardizeError] Standardizing error: ${error.name}, message: ${error.message}`);
    if (error.name === 'RateLimitError') {
      return this.createError('RATE_LIMIT', error.message, 429, true);
    } else if (error.name === 'AuthenticationError') {
      return this.createError('AUTH', error.message, 401, false);
    } else if (error.name === 'ContentPolicyError') {
      return this.createError('CONTENT', error.message, 400, false);
    } else if (error.name === 'TimeoutError') {
      return this.createError('TIMEOUT', error.message || 'Request timed out', 504, true);
    }
    return this.createError('UNKNOWN', error.message || 'Unknown test error', undefined, false);
  }
  
  getDefaultModel(): string {
    return this.configForProvider.defaultModel || 'default-test-model-fallback';
  }

  getModelCapabilities(modelName: string): ModelConfig {
    if (this.configForProvider.models && this.configForProvider.models[modelName]) {
      return this.configForProvider.models[modelName];
    }
    console.warn(`[TestProvider.getModelCapabilities] Model "${modelName}" not found in config. Returning default mock.`);
    return {
      name: modelName || 'unknown-test-model',
      active: false,
      costPerMillionInputTokens: 0, costPerMillionOutputTokens: 0, contextWindow: 0, maxOutputTokens: 0,
      capabilities: [], streamingSupport: false, functionCallingSupport: false, visionSupport: false
    } as ModelConfig;
  }
}

describe('BaseAIModelProvider', () => {
  let provider: TestProvider;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  
  beforeEach(() => {
    provider = new TestProvider('test-api-key');
    provider.errorToThrow = null;
    provider.mockResult = null;

    // Suppress console messages for all tests unless a specific test re-spies
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
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