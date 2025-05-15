import { AIModelRouter } from './AIModelRouter';
import { ConfigurationService } from './ConfigurationService';
import { OpenAIModelProvider } from './OpenAIModelProvider';
import { CircuitBreakerManager } from './CircuitBreakerManager';
import { AIModelRequest, AIModelResult, IAIModelProvider, AIModelError } from '../../../../packages/common-types/src/ai-interfaces';
import { RequestContext } from '../../../../packages/common-types/src/core-interfaces';
import { ProviderConfiguration } from '../../../../packages/common-types/src/config-schema';
import { IDatabaseProvider } from '../../../../packages/common-types/src/core-interfaces';

// Mock ConfigurationService
const mockGetConfiguration = jest.fn();
const mockUpdateConfiguration = jest.fn();
const mockGetDBProvider = jest.fn();
jest.mock('./ConfigurationService', () => ({
  ConfigurationService: jest.fn().mockImplementation(() => ({
    getConfiguration: mockGetConfiguration,
    updateConfiguration: mockUpdateConfiguration,
    getDBProvider: mockGetDBProvider,
  })),
}));

// Mock OpenAIModelProvider
const MockedOpenAIModelProviderConstructor = jest.fn();
const mockOpenAIGenerateResponse = jest.fn();
const mockOpenAICanFulfill = jest.fn().mockResolvedValue(true); // Ensure it's async if original is
jest.mock('./OpenAIModelProvider', () => ({
  OpenAIModelProvider: jest.fn().mockImplementation((secretId, awsClientRegion, dbProvider, defaultModel) => {
    MockedOpenAIModelProviderConstructor(secretId, awsClientRegion, dbProvider, defaultModel);
    return {
      generateResponse: mockOpenAIGenerateResponse,
      canFulfill: mockOpenAICanFulfill,
      getModelCapabilities: jest.fn().mockReturnValue({ reasoning: 0, creativity: 0, coding: 0, retrieval: false, contextSize: 4096, streamingSupport: true, functionCalling: true, vision: false, toolUse: false, configurable: true, inputCost:0, outputCost:0, maxOutputTokens: 4096 }), 
      getProviderHealth: jest.fn().mockReturnValue({}), 
      getProviderLimits: jest.fn().mockReturnValue({})
    };
  })
}));

// ADDED: Mock AnthropicModelProvider
const MockedAnthropicModelProviderConstructor = jest.fn();
const mockAnthropicGenerateResponse = jest.fn();
const mockAnthropicCanFulfill = jest.fn().mockResolvedValue(true);
jest.mock('./AnthropicModelProvider', () => ({
  AnthropicModelProvider: jest.fn().mockImplementation((secretId, awsClientRegion, dbProvider, defaultModel) => {
    MockedAnthropicModelProviderConstructor(secretId, awsClientRegion, dbProvider, defaultModel);
    return {
      generateResponse: mockAnthropicGenerateResponse,
      canFulfill: mockAnthropicCanFulfill,
      getModelCapabilities: jest.fn().mockReturnValue({ reasoning: 0, creativity: 0, coding: 0, retrieval: false, contextSize: 100000, streamingSupport: true, functionCalling: true, vision: false, toolUse: false, configurable: true, inputCost:0, outputCost:0, maxOutputTokens: 4096 }),
      getProviderHealth: jest.fn().mockReturnValue({}),
      getProviderLimits: jest.fn().mockReturnValue({})
    };
  })
}));

// Mock CircuitBreakerManager
const mockIsRequestAllowed = jest.fn();
const mockRecordSuccess = jest.fn();
const mockRecordFailure = jest.fn();
jest.mock('./CircuitBreakerManager', () => ({
  CircuitBreakerManager: jest.fn().mockImplementation(() => ({
    isRequestAllowed: mockIsRequestAllowed,
    recordSuccess: mockRecordSuccess,
    recordFailure: mockRecordFailure,
  })),
}));


const createMockProvider = (name: string, canFulfill = true, shouldSucceed = true, isRetryableError = false, errorCode: AIModelError['code'] = 'UNKNOWN'): IAIModelProvider => {
  return {
    generateResponse: jest.fn().mockImplementation(async (_request: AIModelRequest): Promise<AIModelResult> => {
      if (shouldSucceed) {
        return { ok: true, text: `Response from ${name}`, tokens: { prompt: 10, completion: 5, total: 15 }, meta: { provider: name, model: 'test-model', features: [], region: 'us-east-2', latency: 100, timestamp: Date.now() } };
      } else {
        return { ok: false, code: errorCode, provider: name, detail: 'Test error', retryable: isRetryableError };
      }
    }),
    canFulfill: jest.fn().mockResolvedValue(canFulfill), // Ensure async if original is
    getModelCapabilities: jest.fn().mockReturnValue({ reasoning: 3, creativity: 3, coding: 3, retrieval: false, functionCalling: false, contextSize: 4096, streamingSupport: true }),
    getProviderHealth: jest.fn().mockReturnValue({ available: true, errorRate: 0, latencyP95: 200, lastChecked: Date.now() }),
    getProviderLimits: jest.fn().mockReturnValue({ rpm: 20, tpm: 80000 })
  };
};

const mockContext: RequestContext = { requestId: 'test-request-id', jwtSub: 'test-user', familyId: 'test-family', profileId: 'test-profile', region: 'us-east-1', traceId: 'test-trace-id' }; // region is lambda region

describe('AIModelRouter', () => {
  let router: AIModelRouter;
  let mockConfigServiceInstance: ConfigurationService;
  let mockGenericOpenAIProvider: IAIModelProvider;
  let mockGenericAnthropicProvider: IAIModelProvider; // ADDED
  let mockDatabaseProvider: jest.Mocked<IDatabaseProvider>;

  const MOCK_ANTHROPIC_SECRET_ID = 'mock-anthropic-secret-id'; // ADDED
  const MOCK_AWS_CLIENT_REGION = 'us-west-2'; 

  beforeEach(() => {
    jest.clearAllMocks();
    MockedOpenAIModelProviderConstructor.mockImplementation(() => {}); 
    MockedAnthropicModelProviderConstructor.mockImplementation(() => {}); // ADDED: Reset spy for Anthropic

    mockIsRequestAllowed.mockResolvedValue(true); 
    mockRecordSuccess.mockResolvedValue(undefined);
    mockRecordFailure.mockResolvedValue(undefined);

    mockConfigServiceInstance = new (ConfigurationService as any)() as ConfigurationService;

    mockDatabaseProvider = { getItem: jest.fn(), putItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), query: jest.fn() };
    mockGetDBProvider.mockReturnValue(mockDatabaseProvider);

    mockGetConfiguration.mockReset();
    mockGetConfiguration.mockResolvedValue({
      version: '1.0.0', updatedAt: Date.now(),
      providers: { 
        openai: { 
          active: true, keyVersion: 1, secretId: 'mock-openai-secret-from-config',
          defaultModel: 'gpt-3.5-turbo',
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } }, 
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: ['general', 'chat'], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100, reasoning: 3, creativity: 3, coding: 2, retrieval: true, vision: false, toolUse: false, configurable: true, inputCost:0.002, outputCost:0.002, maxOutputTokens: 4096 } as any }, 
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 }, 
          apiVersion: 'v1', 
          rolloutPercentage: 100 
        },
        anthropic: { 
          active: true, keyVersion: 1, secretId: MOCK_ANTHROPIC_SECRET_ID,
          defaultModel: 'claude-3-haiku-20240307',
          endpoints: { default: { url: 'https://api.anthropic.com/v1', region: 'global', priority: 2, active: true } },
          models: { 'claude-3-haiku-20240307': { tokenCost: 0.001, priority: 1, capabilities: ['general', 'chat'], contextSize: 100000, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100, reasoning: 3, creativity: 3, coding: 1, retrieval: false, vision: true, toolUse: true, configurable: true, inputCost:0.001, outputCost:0.001, maxOutputTokens: 4096 } as any },
          rateLimits: { rpm: 100, tpm: 100000 },
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1',
          rolloutPercentage: 100
        }
      },
      routing: { 
        rules: [], 
        weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, 
        providerPreferenceOrder: ['openai', 'anthropic'], // UPDATED
        defaultModel: 'gpt-3.5-turbo' 
      },
      featureFlags: {}
    } as ProviderConfiguration);
    
    mockGenericOpenAIProvider = createMockProvider('openai');
    mockGenericAnthropicProvider = createMockProvider('anthropic'); 
    
    router = new AIModelRouter(
      mockConfigServiceInstance, 
      MOCK_AWS_CLIENT_REGION,
      { openai: mockGenericOpenAIProvider, anthropic: mockGenericAnthropicProvider } 
    );
  });

  test('should initialize correctly', () => {
    expect(router).toBeDefined();
    // Check if CircuitBreakerManager was instantiated (via its mock)
    expect(CircuitBreakerManager).toHaveBeenCalledTimes(1);
  });

  test('should route to the specified provider and call circuit breaker methods for success', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      preferredProvider: 'openai',
      context: { ...mockContext, region: MOCK_AWS_CLIENT_REGION } // Ensure context.region is the provider call region
    };
    // Reset for this specific test
    mockIsRequestAllowed.mockClear().mockResolvedValue(true);
    mockRecordSuccess.mockClear();
    mockRecordFailure.mockClear();

    const result = await router.routeRequest(request);
    
    const expectedProviderKey = `openai#${MOCK_AWS_CLIENT_REGION}`;
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(expectedProviderKey);
    expect(mockGenericOpenAIProvider.canFulfill).toHaveBeenCalledWith(request);
    expect(mockGenericOpenAIProvider.generateResponse).toHaveBeenCalledWith(request);
    expect(mockRecordSuccess).toHaveBeenCalledWith(expectedProviderKey, expect.any(Number));
    expect(mockRecordFailure).not.toHaveBeenCalled();
    
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('Response from openai');
  });

  test('should use first provider from preference order if none specified in request', async () => { // RENAMED and RE-PURPOSED
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };
    
    // Ensure the default beforeEach mockGetConfiguration is used, which has openai as first preference
    mockIsRequestAllowed.mockClear().mockResolvedValue(true); // Ensure circuit is closed for openai

    const result = await router.routeRequest(request);
    
    const expectedOpenAIKey = `openai#${MOCK_AWS_CLIENT_REGION}`;
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(expectedOpenAIKey);
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    expect(mockGenericOpenAIProvider.generateResponse).toHaveBeenCalledWith(request);
    expect(mockGenericAnthropicProvider.generateResponse).not.toHaveBeenCalled(); // Anthropic should not be called
    expect(result.ok).toBe(true);
    if(result.ok) expect(result.text).toBe('Response from openai');
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
          active: true, keyVersion: 1, secretId: 'mock-openai-secret-from-config',
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } as any },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, providerPreferenceOrder: ['openai'], defaultModel: 'gpt-3.5-turbo' },
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
          active: true, keyVersion: 1, secretId: 'mock-openai-secret-from-config',
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { 'gpt-3.5-turbo': { tokenCost: 0.002, priority: 1, capabilities: [], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100 } as any },
          rateLimits: { rpm: 100, tpm: 100000 }, 
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1', 
          rolloutPercentage: 100,
        }
      },
      routing: { rules: [], weights: { cost: 0.4, quality: 0.3, latency: 0.2, availability: 0.1 }, providerPreferenceOrder: ['openai'], defaultModel: 'gpt-3.5-turbo' },
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
    router.clearProviders(); 

    const request: AIModelRequest = {
      prompt: 'Initialize OpenAI',
      preferredProvider: 'openai',
      context: mockContext
    };
    
    MockedOpenAIModelProviderConstructor.mockClear();
    mockOpenAIGenerateResponse.mockClear();
    mockOpenAICanFulfill.mockClear(); 

    mockOpenAIGenerateResponse.mockResolvedValueOnce({
      ok: true,
      text: 'Response from dynamically initialized OpenAI',
      tokens: { prompt: 5, completion: 5, total: 10 },
      meta: { provider: 'openai', model: 'test-dynamic-model', features:[], region: MOCK_AWS_CLIENT_REGION, latency: 50, timestamp: Date.now() }
    });

    const result = await router.routeRequest(request);
    
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    expect(MockedOpenAIModelProviderConstructor).toHaveBeenCalledTimes(1);
    expect(MockedOpenAIModelProviderConstructor).toHaveBeenCalledWith('mock-openai-secret-from-config', MOCK_AWS_CLIENT_REGION, mockDatabaseProvider, 'gpt-3.5-turbo'); // Check secret from config
    
    expect(mockOpenAIGenerateResponse).toHaveBeenCalledTimes(1);
    expect(mockOpenAIGenerateResponse).toHaveBeenCalledWith(request);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Response from dynamically initialized OpenAI');
    }
  });

  test('should handle error during OpenAI provider initialization', async () => {
    router.clearProviders(); 

    const request: AIModelRequest = {
      prompt: 'Initialize OpenAI',
      preferredProvider: 'openai',
      context: mockContext
    };

    MockedOpenAIModelProviderConstructor.mockClear();
    const initError = new Error('Failed to initialize OpenAI provider');
    MockedOpenAIModelProviderConstructor.mockImplementation((_secretId, _awsClientRegion, _dbProvider, _defaultModel) => {
      throw initError;
    });

    const result = await router.routeRequest(request);

    expect(mockGetConfiguration).toHaveBeenCalledTimes(1); 
    expect(MockedOpenAIModelProviderConstructor).toHaveBeenCalledTimes(1); 
    expect(MockedOpenAIModelProviderConstructor).toHaveBeenCalledWith('mock-openai-secret-from-config', MOCK_AWS_CLIENT_REGION, mockDatabaseProvider, 'gpt-3.5-turbo');
    
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as AIModelError).code).toBe('UNKNOWN');
      expect((result as AIModelError).detail).toContain('Critical error routing request: Failed to initialize OpenAI provider');
    }
    MockedOpenAIModelProviderConstructor.mockImplementation(() => {}); // Reset for other tests
  });

  test('should use default provider from config if preferredProvider is not in providers map and cannot be initialized', async () => {
    router.clearProviders(); 

    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext
    };

    mockOpenAIGenerateResponse.mockClear();
    mockOpenAIGenerateResponse.mockResolvedValueOnce({
      ok: true,
      text: 'Response from default (dynamically initialized openai)',
      tokens: { prompt: 10, completion: 5, total: 15 },
      meta: { provider: 'openai', model:'gpt-3.5-turbo', features: [], region: MOCK_AWS_CLIENT_REGION, latency: 100, timestamp: Date.now() }
    });

    const result = await router.routeRequest(request);
    
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    expect(MockedOpenAIModelProviderConstructor).toHaveBeenCalledWith('mock-openai-secret-from-config', MOCK_AWS_CLIENT_REGION, mockDatabaseProvider, 'gpt-3.5-turbo');
    expect(mockOpenAIGenerateResponse).toHaveBeenCalledWith(request);
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.text).toBe('Response from default (dynamically initialized openai)');
    }
  });

  test('should dynamically initialize OpenAI provider if not present and use default provider from config', async () => {
    router.clearProviders(); 

    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext 
    };
    
    mockOpenAIGenerateResponse.mockClear();
    mockOpenAIGenerateResponse.mockResolvedValueOnce({
      ok: true,
      text: 'Response from default (dynamically initialized openai)',
      tokens: { prompt: 10, completion: 5, total: 15 },
      meta: { provider: 'openai', model:'gpt-3.5-turbo', features: [], region: MOCK_AWS_CLIENT_REGION, latency: 100, timestamp: Date.now() }
    });

    const result = await router.routeRequest(request);
    
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    expect(MockedOpenAIModelProviderConstructor).toHaveBeenCalledWith('mock-openai-secret-from-config', MOCK_AWS_CLIENT_REGION, mockDatabaseProvider, 'gpt-3.5-turbo');
    expect(mockOpenAIGenerateResponse).toHaveBeenCalledWith(request);
    expect(result.ok).toBe(true);
    if(result.ok){
      expect(result.text).toBe('Response from default (dynamically initialized openai)');
    }
  });

  test('should return 503 and not call provider if circuit breaker is OPEN (blocks request)', async () => {
    const request: AIModelRequest = {
      prompt: 'Test prompt',
      preferredProvider: 'openai',
      context: { ...mockContext, region: MOCK_AWS_CLIENT_REGION }
    };
    mockIsRequestAllowed.mockResolvedValue(false); // Circuit breaker blocks
    // Ensure provider mocks are reset or not called
    (mockGenericOpenAIProvider.generateResponse as jest.Mock).mockClear();
    mockRecordSuccess.mockClear();
    mockRecordFailure.mockClear();

    const result = await router.routeRequest(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TIMEOUT'); // Or our specific 'CIRCUIT_OPEN' if defined
      expect(result.status).toBe(503);
    }
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(`openai#${MOCK_AWS_CLIENT_REGION}`);
    expect(mockGenericOpenAIProvider.generateResponse).not.toHaveBeenCalled();
    expect(mockRecordSuccess).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled(); // Not called because provider was not even attempted
  });

  test('should call recordFailure for retryable provider errors', async () => {
    const request: AIModelRequest = {
      prompt: 'Test prompt',
      preferredProvider: 'openai',
      context: { ...mockContext, region: MOCK_AWS_CLIENT_REGION }
    };
    // Provider will return a retryable error
    mockGenericOpenAIProvider = createMockProvider('openai', true, false, true, 'TIMEOUT');
    router = new AIModelRouter(mockConfigServiceInstance, MOCK_AWS_CLIENT_REGION, { openai: mockGenericOpenAIProvider });

    mockIsRequestAllowed.mockResolvedValue(true);
    mockRecordSuccess.mockClear();
    mockRecordFailure.mockClear();

    const result = await router.routeRequest(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TIMEOUT');
    
    const expectedProviderKey = `openai#${MOCK_AWS_CLIENT_REGION}`;
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(expectedProviderKey);
    expect(mockGenericOpenAIProvider.generateResponse).toHaveBeenCalledWith(request);
    expect(mockRecordFailure).toHaveBeenCalledWith(expectedProviderKey, expect.any(Number));
    expect(mockRecordSuccess).not.toHaveBeenCalled();
  });

  test('should NOT call recordFailure for non-retryable AUTH provider errors', async () => {
    const request: AIModelRequest = {
      prompt: 'Test prompt',
      preferredProvider: 'openai',
      context: { ...mockContext, region: MOCK_AWS_CLIENT_REGION }
    };
    mockGenericOpenAIProvider = createMockProvider('openai', true, false, false, 'AUTH'); // Non-retryable AUTH error
    router = new AIModelRouter(mockConfigServiceInstance, MOCK_AWS_CLIENT_REGION, { openai: mockGenericOpenAIProvider });

    mockIsRequestAllowed.mockResolvedValue(true);
    mockRecordFailure.mockClear();

    const result = await router.routeRequest(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AUTH');
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  test('should NOT call recordFailure for non-retryable CONTENT provider errors', async () => {
    const request: AIModelRequest = {
      prompt: 'Test prompt',
      preferredProvider: 'openai',
      context: { ...mockContext, region: MOCK_AWS_CLIENT_REGION }
    };
    mockGenericOpenAIProvider = createMockProvider('openai', true, false, false, 'CONTENT'); // Non-retryable CONTENT error
    router = new AIModelRouter(mockConfigServiceInstance, MOCK_AWS_CLIENT_REGION, { openai: mockGenericOpenAIProvider });
    
    mockIsRequestAllowed.mockResolvedValue(true);
    mockRecordFailure.mockClear();

    const result = await router.routeRequest(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CONTENT');
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  test('should call recordFailure if provider.generateResponse throws an unhandled exception', async () => {
    const request: AIModelRequest = {
      prompt: 'Test prompt',
      preferredProvider: 'openai',
      context: { ...mockContext, region: MOCK_AWS_CLIENT_REGION }
    };
    const unhandledError = new Error("Unhandled provider explosion!");
    (mockGenericOpenAIProvider.generateResponse as jest.Mock).mockRejectedValue(unhandledError);
    router = new AIModelRouter(mockConfigServiceInstance, MOCK_AWS_CLIENT_REGION, { openai: mockGenericOpenAIProvider });

    mockIsRequestAllowed.mockResolvedValue(true);
    mockRecordSuccess.mockClear();
    mockRecordFailure.mockClear();

    const result = await router.routeRequest(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
        expect(result.code).toBe('UNKNOWN');
        expect(result.detail).toContain("Unhandled provider explosion!");
    }
    const expectedProviderKey = `openai#${MOCK_AWS_CLIENT_REGION}`;
    expect(mockRecordFailure).toHaveBeenCalledWith(expectedProviderKey, expect.any(Number));
    expect(mockRecordSuccess).not.toHaveBeenCalled();
  });

  // ADDED: New tests for Anthropic provider
  test('should route to Anthropic provider if specified and call circuit breaker methods for success', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, Anthropic!',
      preferredProvider: 'anthropic',
      context: { ...mockContext, region: MOCK_AWS_CLIENT_REGION }
    };

    mockIsRequestAllowed.mockClear().mockResolvedValue(true);
    mockRecordSuccess.mockClear();
    mockRecordFailure.mockClear();
    (mockGenericAnthropicProvider.generateResponse as jest.Mock).mockClear().mockResolvedValueOnce({
      ok: true, text: 'Response from anthropic', tokens: { prompt: 10, completion: 5, total: 15 }, meta: { provider: 'anthropic', model: 'claude-test', features: [], region: MOCK_AWS_CLIENT_REGION, latency: 100, timestamp: Date.now() }
    });

    const result = await router.routeRequest(request);
    
    const expectedProviderKey = `anthropic#${MOCK_AWS_CLIENT_REGION}`;
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(expectedProviderKey);
    expect(mockGenericAnthropicProvider.canFulfill).toHaveBeenCalledWith(request);
    expect(mockGenericAnthropicProvider.generateResponse).toHaveBeenCalledWith(request);
    expect(mockRecordSuccess).toHaveBeenCalledWith(expectedProviderKey, expect.any(Number));
    expect(mockRecordFailure).not.toHaveBeenCalled();
    
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('Response from anthropic');
  });

  test('should dynamically initialize Anthropic provider if not present', async () => {
    router.clearProviders(); // Ensure no 'anthropic' provider exists initially

    const request: AIModelRequest = {
      prompt: 'Initialize Anthropic',
      preferredProvider: 'anthropic',
      context: mockContext
    };

    MockedAnthropicModelProviderConstructor.mockClear();
    mockAnthropicGenerateResponse.mockClear();
    mockAnthropicCanFulfill.mockClear();

    mockAnthropicGenerateResponse.mockResolvedValueOnce({
      ok: true,
      text: 'Response from dynamically initialized Anthropic',
      tokens: { prompt: 5, completion: 5, total: 10 },
      meta: { provider: 'anthropic', model: 'claude-dynamic', features:[], region: MOCK_AWS_CLIENT_REGION, latency: 50, timestamp: Date.now() }
    });

    const result = await router.routeRequest(request);
    
    expect(mockConfigServiceInstance.getConfiguration).toHaveBeenCalledTimes(1);
    expect(MockedAnthropicModelProviderConstructor).toHaveBeenCalledTimes(1);
    expect(MockedAnthropicModelProviderConstructor).toHaveBeenCalledWith(MOCK_ANTHROPIC_SECRET_ID, MOCK_AWS_CLIENT_REGION, mockDatabaseProvider, 'claude-3-haiku-20240307');
    
    expect(mockAnthropicGenerateResponse).toHaveBeenCalledTimes(1);
    expect(mockAnthropicGenerateResponse).toHaveBeenCalledWith(request);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Response from dynamically initialized Anthropic');
    }
  });

  test('should handle error during Anthropic provider initialization', async () => {
    router.clearProviders(); 

    const request: AIModelRequest = {
      prompt: 'Initialize Anthropic Error',
      preferredProvider: 'anthropic',
      context: mockContext
    };

    MockedAnthropicModelProviderConstructor.mockClear();
    const initError = new Error('Failed to initialize Anthropic provider');
    MockedAnthropicModelProviderConstructor.mockImplementation((_secretId, _awsClientRegion, _dbProvider, _defaultModel) => {
      throw initError;
    });

    const result = await router.routeRequest(request);

    expect(mockGetConfiguration).toHaveBeenCalledTimes(1);
    expect(MockedAnthropicModelProviderConstructor).toHaveBeenCalledTimes(1);
    expect(MockedAnthropicModelProviderConstructor).toHaveBeenCalledWith(MOCK_ANTHROPIC_SECRET_ID, MOCK_AWS_CLIENT_REGION, mockDatabaseProvider, 'claude-3-haiku-20240307');
    
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as AIModelError).code).toBe('UNKNOWN');
      expect((result as AIModelError).detail).toContain('Critical error routing request: Failed to initialize Anthropic provider');
    }
    MockedAnthropicModelProviderConstructor.mockImplementation(() => {}); // Reset for other tests
  });

  // ADDED: Test for simple fallback when preferred provider circuit is open
  test('should fallback to provider from preference order if preferred provider circuit is open', async () => { // Name slightly updated for clarity
    router.clearProviders(); // Start clean, force dynamic initialization

    const specificConfig: ProviderConfiguration = {
      version: '1.0.0', updatedAt: Date.now(),
      providers: {
        openai: {
          active: true, keyVersion: 1, secretId: 'mock-openai-secret-for-fallback-test',
          defaultModel: 'gpt-3.5-turbo',
          endpoints: { default: { url: '', region: '', priority: 1, active: true } }, models: { 'gpt-3.5-turbo': {} as any },
          rateLimits: { rpm: 1, tpm: 1 }, retryConfig: { maxRetries: 1, initialDelayMs:1, maxDelayMs:1}, apiVersion:'', rolloutPercentage: 100
        } as any,
        anthropic: {
          active: true, keyVersion: 1, secretId: 'mock-anthropic-secret-for-fallback-test',
          defaultModel: 'claude-3-haiku-20240307',
          endpoints: { default: { url: '', region: '', priority: 1, active: true } }, models: { 'claude-3-haiku-20240307': {} as any },
          rateLimits: { rpm: 1, tpm: 1 }, retryConfig: { maxRetries: 1, initialDelayMs:1, maxDelayMs:1}, apiVersion:'', rolloutPercentage: 100
        } as any
      },
      // IMPORTANT: openai is preferred, then anthropic is in the preference order for fallback
      routing: { rules: [], weights: { cost: 0.1, quality: 0.1, latency: 0.1, availability: 0.1 }, providerPreferenceOrder: ['openai', 'anthropic'], defaultModel: 'claude-3-haiku-20240307' }, 
      featureFlags: {}
    };
    mockGetConfiguration.mockResolvedValue(specificConfig);

    const request: AIModelRequest = {
      prompt: 'Test fallback',
      preferredProvider: 'openai', // OpenAI is preferred
      context: mockContext
    };

    const openaiHealthKey = `openai#${MOCK_AWS_CLIENT_REGION}`;
    const anthropicHealthKey = `anthropic#${MOCK_AWS_CLIENT_REGION}`;

    // Simulate OpenAI (preferred) circuit is OPEN, Anthropic (from preference order) is ALLOWED
    mockIsRequestAllowed.mockImplementation(key => Promise.resolve(key === anthropicHealthKey)); 

    MockedOpenAIModelProviderConstructor.mockClear();
    MockedAnthropicModelProviderConstructor.mockClear();
    mockAnthropicGenerateResponse.mockClear().mockResolvedValueOnce({
      ok: true, text: 'Response from fallback Anthropic', 
      tokens: { prompt: 1, completion: 1, total: 2 }, 
      meta: { provider: 'anthropic', model:'claude-fallback', features:[], region:MOCK_AWS_CLIENT_REGION, latency:10, timestamp:Date.now() }
    });

    const result = await router.routeRequest(request);

    expect(mockGetConfiguration).toHaveBeenCalledTimes(1);
    // Check that isRequestAllowed was called for both openai (preferred) and anthropic (fallback)
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(openaiHealthKey);
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(anthropicHealthKey);
    
    // OpenAI (preferred) should not have been initialized because its circuit was open
    expect(MockedOpenAIModelProviderConstructor).not.toHaveBeenCalled(); 
    // Anthropic (fallback) should be initialized
    expect(MockedAnthropicModelProviderConstructor).toHaveBeenCalledTimes(1); 
    expect(MockedAnthropicModelProviderConstructor).toHaveBeenCalledWith(
      'mock-anthropic-secret-for-fallback-test', 
      MOCK_AWS_CLIENT_REGION, 
      mockDatabaseProvider, 
      'claude-3-haiku-20240307'
    );
    expect(mockAnthropicGenerateResponse).toHaveBeenCalledTimes(1);
    expect(mockAnthropicGenerateResponse).toHaveBeenCalledWith(request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Response from fallback Anthropic');
      expect(result.meta.provider).toBe('anthropic');
    }

    // Reset mockIsRequestAllowed for other tests
    mockIsRequestAllowed.mockImplementation(() => Promise.resolve(true));
  });
}); 