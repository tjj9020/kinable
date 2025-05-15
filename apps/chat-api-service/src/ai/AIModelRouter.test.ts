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
      getProviderHealth: jest.fn().mockReturnValue({ available: true, errorRate: 0, latencyP95: 200, lastChecked: Date.now() }), 
      getProviderLimits: jest.fn().mockReturnValue({ rpm: 20, tpm: 80000 })
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
      getProviderHealth: jest.fn().mockReturnValue({ available: true, errorRate: 0, latencyP95: 200, lastChecked: Date.now() }),
      getProviderLimits: jest.fn().mockReturnValue({ rpm: 20, tpm: 80000 })
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
        return { ok: false, code: errorCode, provider: name, detail: 'Test error', retryable: isRetryableError, status: 500 };
      }
    }),
    canFulfill: jest.fn().mockResolvedValue(canFulfill), // Ensure async if original is
    getModelCapabilities: jest.fn().mockReturnValue({ reasoning: 3, creativity: 3, coding: 3, retrieval: false, functionCalling: false, contextSize: 4096, streamingSupport: true, inputCost: 0.0001, outputCost: 0.0002, maxOutputTokens: 4096 }),
    getProviderHealth: jest.fn().mockReturnValue({ available: true, errorRate: 0, latencyP95: 200, lastChecked: Date.now() }),
    getProviderLimits: jest.fn().mockReturnValue({ rpm: 20, tpm: 80000 })
  };
};

const mockContext: RequestContext = { requestId: 'test-request-id', jwtSub: 'test-user', familyId: 'test-family', profileId: 'test-profile', region: 'us-east-1', traceId: 'test-trace-id' }; // region is lambda region

describe('AIModelRouter', () => {
  let router: AIModelRouter;
  let mockConfigServiceInstance: ConfigurationService;
  let mockGenericOpenAIProvider: IAIModelProvider;
  let mockGenericAnthropicProvider: IAIModelProvider;
  let mockDatabaseProvider: jest.Mocked<IDatabaseProvider>;

  const MOCK_ANTHROPIC_SECRET_ID = 'mock-anthropic-secret-id';
  const MOCK_AWS_CLIENT_REGION = 'us-west-2';
  const DEFAULT_OPENAI_MODEL = 'gpt-3.5-turbo';
  const DEFAULT_ANTHROPIC_MODEL = 'claude-3-haiku-20240307';

  const mockOpenAIModelConfig = {
    inputCost: 0.001, // Cost per 1K input tokens
    outputCost: 0.002, // Cost per 1K output tokens
    priority: 1, capabilities: ['general', 'chat'], contextSize: 4096, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100, reasoning: 3, creativity: 3, coding: 2, retrieval: true, vision: false, toolUse: false, configurable: true, maxOutputTokens: 4096
  };
  const mockAnthropicModelConfig = {
    inputCost: 0.00025, // Cost per 1K input tokens (Claude Haiku input)
    outputCost: 0.00125, // Cost per 1K output tokens (Claude Haiku output)
    priority: 1, capabilities: ['general', 'chat'], contextSize: 100000, streamingSupport: true, functionCalling: true, active: true, rolloutPercentage: 100, reasoning: 3, creativity: 3, coding: 1, retrieval: false, vision: true, toolUse: true, configurable: true, maxOutputTokens: 4096
  };


  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create consistent mock providers with full implementations
    mockGenericOpenAIProvider = createMockProvider('openai');
    (mockGenericOpenAIProvider.generateResponse as jest.Mock).mockImplementation(async (req: AIModelRequest) => ({
        ok: true, 
        text: `Response from openai model ${req.preferredModel || DEFAULT_OPENAI_MODEL}`, 
        tokens: { prompt: 10, completion: 5, total: 15 }, 
        meta: { provider: 'openai', model: req.preferredModel || DEFAULT_OPENAI_MODEL, features: [], region: MOCK_AWS_CLIENT_REGION, latency: 100, timestamp: Date.now() }
    }));

    mockGenericAnthropicProvider = createMockProvider('anthropic');
    (mockGenericAnthropicProvider.generateResponse as jest.Mock).mockImplementation(async (req: AIModelRequest) => ({
        ok: true, 
        text: `Response from anthropic model ${req.preferredModel || DEFAULT_ANTHROPIC_MODEL}`, 
        tokens: { prompt: 10, completion: 5, total: 15 }, 
        meta: { provider: 'anthropic', model: req.preferredModel || DEFAULT_ANTHROPIC_MODEL, features: [], region: MOCK_AWS_CLIENT_REGION, latency: 120, timestamp: Date.now() }
    }));
    
    // Reset the mock constructors
    MockedOpenAIModelProviderConstructor.mockReset();
    MockedAnthropicModelProviderConstructor.mockReset();
    
    // Setup the mock constructor implementations to return our pre-configured providers
    mockOpenAIGenerateResponse.mockReset();
    mockOpenAIGenerateResponse.mockImplementation(mockGenericOpenAIProvider.generateResponse);
    
    mockAnthropicGenerateResponse.mockReset();
    mockAnthropicGenerateResponse.mockImplementation(mockGenericAnthropicProvider.generateResponse);
    
    // Always allow requests by default
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
          defaultModel: DEFAULT_OPENAI_MODEL,
          endpoints: { default: { url: 'https://api.openai.com/v1', region: 'global', priority: 1, active: true } },
          models: { [DEFAULT_OPENAI_MODEL]: mockOpenAIModelConfig },
          rateLimits: { rpm: 100, tpm: 100000 },
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1',
          rolloutPercentage: 100
        },
        anthropic: {
          active: true, keyVersion: 1, secretId: MOCK_ANTHROPIC_SECRET_ID,
          defaultModel: DEFAULT_ANTHROPIC_MODEL,
          endpoints: { default: { url: 'https://api.anthropic.com/v1', region: 'global', priority: 2, active: true } },
          models: { [DEFAULT_ANTHROPIC_MODEL]: mockAnthropicModelConfig },
          rateLimits: { rpm: 100, tpm: 100000 },
          retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
          apiVersion: 'v1',
          rolloutPercentage: 100
        }
      },
      routing: {
        rules: [],
        weights: { cost: 0.7, quality: 0.1, latency: 0.1, availability: 0.1 },
        providerPreferenceOrder: ['openai', 'anthropic'],
        defaultModel: DEFAULT_OPENAI_MODEL
      },
      featureFlags: {}
    } as ProviderConfiguration);
    
    router = new AIModelRouter(
      mockConfigServiceInstance,
      MOCK_AWS_CLIENT_REGION
    );
    
    // Pre-populate the router's providers map to avoid dynamic initialization
    router.addProvider('openai', mockGenericOpenAIProvider);
    router.addProvider('anthropic', mockGenericAnthropicProvider);
  });

  test('should initialize correctly', () => {
    expect(router).toBeDefined();
    expect(CircuitBreakerManager).toHaveBeenCalledTimes(1);
  });

  test('should route to the specified (preferred) provider if active and circuit closed', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      preferredProvider: 'openai',
      context: { ...mockContext, region: MOCK_AWS_CLIENT_REGION }
    };
    
    // Create a specific mock response for this test
    const openaiSuccess = { 
      ok: true, 
      text: 'Response from openai', 
      tokens: {prompt:10, completion:5, total:15}, 
      meta: { provider: 'openai', model: DEFAULT_OPENAI_MODEL, features: [], region: MOCK_AWS_CLIENT_REGION, latency: 100, timestamp: Date.now() } 
    };
    
    // Create a fresh provider with the expected response
    const mockOpenAIProvider = createMockProvider('openai');
    (mockOpenAIProvider.generateResponse as jest.Mock).mockResolvedValue(openaiSuccess);
    
    // Clear and reset the router's providers
    router.clearProviders();
    router.addProvider('openai', mockOpenAIProvider);
    
    const result = await router.routeRequest(request);
    
    const expectedProviderKey = `openai#${MOCK_AWS_CLIENT_REGION}`;
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(expectedProviderKey);
    expect((mockOpenAIProvider.generateResponse as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ ...request, preferredModel: DEFAULT_OPENAI_MODEL})
    );
    expect(mockRecordSuccess).toHaveBeenCalledWith(expectedProviderKey, expect.any(Number));
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Response from openai');
      expect(result.meta.provider).toBe('openai');
    }
  });

  test('should select cheaper provider based on cost estimation when no preferred provider', async () => {
    const request: AIModelRequest = {
      prompt: 'This is a test prompt with about 50 characters.',
      estimatedInputTokens: 15,
      estimatedOutputTokens: 100,
      context: mockContext
    };

    // Make Anthropic cheaper for this test
    const config = JSON.parse(JSON.stringify(await mockConfigServiceInstance.getConfiguration()));
    config.providers.openai.models[DEFAULT_OPENAI_MODEL].inputCost = 0.002;
    config.providers.openai.models[DEFAULT_OPENAI_MODEL].outputCost = 0.003;
    config.providers.anthropic.models[DEFAULT_ANTHROPIC_MODEL].inputCost = 0.0001;
    config.providers.anthropic.models[DEFAULT_ANTHROPIC_MODEL].outputCost = 0.0005;
    mockGetConfiguration.mockReset();
    mockGetConfiguration.mockResolvedValue(config);

    // Set up fresh mock implementations for this test
    const anthropicResult = { 
      ok: true, 
      text: 'Response from anthropic', 
      tokens: {prompt:15, completion:100, total:115}, 
      meta: { provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL, features: [], region: MOCK_AWS_CLIENT_REGION, latency: 120, timestamp: Date.now() } 
    };
    const openaiResult = { 
      ok: true, 
      text: 'Response from openai', 
      tokens: {prompt:15, completion:100, total:115}, 
      meta: { provider: 'openai', model: DEFAULT_OPENAI_MODEL, features: [], region: MOCK_AWS_CLIENT_REGION, latency: 100, timestamp: Date.now() } 
    };
    
    const mockAnthropicProvider = createMockProvider('anthropic');
    (mockAnthropicProvider.generateResponse as jest.Mock).mockResolvedValue(anthropicResult);
    (mockAnthropicProvider.getModelCapabilities as jest.Mock).mockReturnValue({
      inputCost: 0.0001, outputCost: 0.0005, reasoning: 3, creativity: 3, coding: 1,
      contextSize: 100000, streamingSupport: true, functionCalling: true, 
      retrieval: false, vision: false, toolUse: false, configurable: true, maxOutputTokens: 4096
    });
    
    const mockOpenAIProvider = createMockProvider('openai');
    (mockOpenAIProvider.generateResponse as jest.Mock).mockResolvedValue(openaiResult);
    (mockOpenAIProvider.getModelCapabilities as jest.Mock).mockReturnValue({
      inputCost: 0.002, outputCost: 0.003, reasoning: 3, creativity: 3, coding: 2,
      contextSize: 4096, streamingSupport: true, functionCalling: true, 
      retrieval: true, vision: false, toolUse: false, configurable: true, maxOutputTokens: 4096
    });
    
    // Replace router's providers with our test-specific ones
    router.clearProviders();
    router.addProvider('anthropic', mockAnthropicProvider);
    router.addProvider('openai', mockOpenAIProvider);

    const result = await router.routeRequest(request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('anthropic');
      expect(result.text).toBe('Response from anthropic');
    }
    
    expect((mockAnthropicProvider.generateResponse as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ 
        ...request, 
        preferredModel: DEFAULT_ANTHROPIC_MODEL 
      })
    );
    expect((mockOpenAIProvider.generateResponse as jest.Mock)).not.toHaveBeenCalled();
  });
  
  test('should use prompt length heuristic for input tokens if not provided in request', async () => {
    const shortPrompt = "Hi";
    const request: AIModelRequest = {
      prompt: shortPrompt, 
      estimatedOutputTokens: 50,
      context: mockContext
    };

    mockAnthropicGenerateResponse.mockResolvedValueOnce({ ok: true, text: 'Response from anthropic', tokens: {prompt:1,completion:1,total:2}, meta: { provider: 'anthropic', model:DEFAULT_ANTHROPIC_MODEL, features:[], region: MOCK_AWS_CLIENT_REGION, latency:1, timestamp:1 } });
    MockedAnthropicModelProviderConstructor.mockImplementation(() => ({ generateResponse: mockAnthropicGenerateResponse, canFulfill: jest.fn().mockResolvedValue(true), getModelCapabilities: jest.fn().mockReturnValue(mockAnthropicModelConfig) }));
    MockedOpenAIModelProviderConstructor.mockImplementation(() => ({ generateResponse: mockOpenAIGenerateResponse, canFulfill: jest.fn().mockResolvedValue(true), getModelCapabilities: jest.fn().mockReturnValue(mockOpenAIModelConfig) }));

    const result = await router.routeRequest(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('anthropic');
    }
  });

  test('should use request.maxTokens for output token estimate if estimatedOutputTokens not provided', async () => {
    const request: AIModelRequest = {
      prompt: "A short prompt",
      estimatedInputTokens: 5,
      maxTokens: 200,
      context: mockContext
    };
    mockAnthropicGenerateResponse.mockResolvedValueOnce({ ok: true, text: 'Response from anthropic', tokens: {prompt:1,completion:1,total:2}, meta: { provider: 'anthropic', model:DEFAULT_ANTHROPIC_MODEL, features:[], region: MOCK_AWS_CLIENT_REGION, latency:1, timestamp:1 } });
    MockedAnthropicModelProviderConstructor.mockImplementation(() => ({ generateResponse: mockAnthropicGenerateResponse, canFulfill: jest.fn().mockResolvedValue(true), getModelCapabilities: jest.fn().mockReturnValue(mockAnthropicModelConfig) }));
    MockedOpenAIModelProviderConstructor.mockImplementation(() => ({ generateResponse: mockOpenAIGenerateResponse, canFulfill: jest.fn().mockResolvedValue(true), getModelCapabilities: jest.fn().mockReturnValue(mockOpenAIModelConfig) }));

    const result = await router.routeRequest(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('anthropic');
    }
  });
  
  test('should use default 256 for output token estimate if neither estimatedOutputTokens nor maxTokens provided', async () => {
    const request: AIModelRequest = {
      prompt: "A short prompt",
      estimatedInputTokens: 5,
      context: mockContext
    };
    mockAnthropicGenerateResponse.mockResolvedValueOnce({ ok: true, text: 'Response from anthropic', tokens: {prompt:1,completion:1,total:2}, meta: { provider: 'anthropic', model:DEFAULT_ANTHROPIC_MODEL, features:[], region: MOCK_AWS_CLIENT_REGION, latency:1, timestamp:1 } });
    MockedAnthropicModelProviderConstructor.mockImplementation(() => ({ generateResponse: mockAnthropicGenerateResponse, canFulfill: jest.fn().mockResolvedValue(true), getModelCapabilities: jest.fn().mockReturnValue(mockAnthropicModelConfig) }));
    MockedOpenAIModelProviderConstructor.mockImplementation(() => ({ generateResponse: mockOpenAIGenerateResponse, canFulfill: jest.fn().mockResolvedValue(true), getModelCapabilities: jest.fn().mockReturnValue(mockOpenAIModelConfig) }));
    
    const result = await router.routeRequest(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('anthropic');
    }
  });

  test('should prefer provider specified in request if its cheaper or similarly priced after scoring', async () => {
    const request: AIModelRequest = {
      prompt: 'A short prompt with preference',
      preferredProvider: 'anthropic',
      estimatedInputTokens: 10,
      estimatedOutputTokens: 10,
      context: mockContext
    };

    // Create provider instances with specific behaviors
    const mockOpenAIProvider = createMockProvider('openai');
    const mockAnthropicProvider = createMockProvider('anthropic');
    
    const anthropicSuccess = { 
      ok: true, 
      text: 'Response from anthropic', 
      tokens: {prompt:10, completion:10, total:20}, 
      meta: { provider: 'anthropic', model:DEFAULT_ANTHROPIC_MODEL, features:[], region: MOCK_AWS_CLIENT_REGION, latency:120, timestamp: Date.now() } 
    };
    
    (mockAnthropicProvider.generateResponse as jest.Mock).mockResolvedValue(anthropicSuccess);
    
    // Replace router's providers
    router.clearProviders();
    router.addProvider('openai', mockOpenAIProvider);
    router.addProvider('anthropic', mockAnthropicProvider);
    
    // Make sure Anthropic is at least slightly cheaper for the test
    const config = JSON.parse(JSON.stringify(await mockConfigServiceInstance.getConfiguration()));
    config.providers.openai.models[DEFAULT_OPENAI_MODEL].inputCost = 0.002;
    config.providers.openai.models[DEFAULT_OPENAI_MODEL].outputCost = 0.003;
    config.providers.anthropic.models[DEFAULT_ANTHROPIC_MODEL].inputCost = 0.00025;
    config.providers.anthropic.models[DEFAULT_ANTHROPIC_MODEL].outputCost = 0.00125;
    mockGetConfiguration.mockReset();
    mockGetConfiguration.mockResolvedValue(config);

    const result = await router.routeRequest(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('anthropic');
    }
    
    expect((mockAnthropicProvider.generateResponse as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((mockOpenAIProvider.generateResponse as jest.Mock)).not.toHaveBeenCalled();
  });

  test('should fallback to next provider if highest scored provider fails', async () => {
    const request: AIModelRequest = {
      prompt: 'Test fallback after scored failure',
      estimatedInputTokens: 15,
      estimatedOutputTokens: 100, // Anthropic should be cheaper
      context: mockContext
    };

    // Make Anthropic cheaper but set it to fail
    const config = JSON.parse(JSON.stringify(await mockConfigServiceInstance.getConfiguration()));
    config.providers.openai.models[DEFAULT_OPENAI_MODEL].inputCost = 0.002;
    config.providers.openai.models[DEFAULT_OPENAI_MODEL].outputCost = 0.003;
    config.providers.anthropic.models[DEFAULT_ANTHROPIC_MODEL].inputCost = 0.0001;
    config.providers.anthropic.models[DEFAULT_ANTHROPIC_MODEL].outputCost = 0.0005;
    mockGetConfiguration.mockReset();
    mockGetConfiguration.mockResolvedValue(config);

    // Create provider instances with specific behaviors
    const mockAnthropicProvider = createMockProvider('anthropic', true, false, true, 'TIMEOUT');
    const mockOpenAIProvider = createMockProvider('openai');
    
    const anthropicError = { 
      ok: false, 
      code: 'TIMEOUT' as const, 
      provider: 'anthropic', 
      detail: 'Anthropic timed out', 
      retryable: true,
      status: 408
    };
    
    const openaiSuccess = { 
      ok: true, 
      text: 'Response from openai fallback', 
      tokens: {prompt:15, completion:100, total:115}, 
      meta: { provider: 'openai', model: DEFAULT_OPENAI_MODEL, features: [], region: MOCK_AWS_CLIENT_REGION, latency: 100, timestamp: Date.now() } 
    };
    
    (mockAnthropicProvider.generateResponse as jest.Mock).mockResolvedValue(anthropicError);
    (mockOpenAIProvider.generateResponse as jest.Mock).mockResolvedValue(openaiSuccess);
    
    // Replace router's providers
    router.clearProviders();
    router.addProvider('anthropic', mockAnthropicProvider);
    router.addProvider('openai', mockOpenAIProvider);

    const result = await router.routeRequest(request);

    expect(mockRecordFailure).toHaveBeenCalledWith(`anthropic#${MOCK_AWS_CLIENT_REGION}`, expect.any(Number));
    expect(mockRecordSuccess).toHaveBeenCalledWith(`openai#${MOCK_AWS_CLIENT_REGION}`, expect.any(Number));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Response from openai fallback');
      expect(result.meta.provider).toBe('openai');
    }
    
    expect((mockAnthropicProvider.generateResponse as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((mockOpenAIProvider.generateResponse as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  test('should return error if all candidate providers fail', async () => {
    const request: AIModelRequest = { prompt: 'Test all failing', context: mockContext };

    // Create provider instances that all fail
    const mockOpenAIProvider = createMockProvider('openai', true, false, false, 'UNKNOWN');
    const mockAnthropicProvider = createMockProvider('anthropic', true, false, false, 'UNKNOWN');
    
    const openaiError = { 
      ok: false as const, 
      code: 'UNKNOWN' as const, 
      provider: 'openai', 
      detail: 'OpenAI failed hard', 
      retryable: false,
      status: 500
    };
    const anthropicError = { 
      ok: false as const, 
      code: 'UNKNOWN' as const, 
      provider: 'anthropic', 
      detail: 'Anthropic failed hard', 
      retryable: false,
      status: 500
    };
    
    (mockOpenAIProvider.generateResponse as jest.Mock).mockResolvedValue(openaiError);
    (mockAnthropicProvider.generateResponse as jest.Mock).mockResolvedValue(anthropicError);
    
    // Replace router's providers
    router.clearProviders();
    router.addProvider('openai', mockOpenAIProvider);
    router.addProvider('anthropic', mockAnthropicProvider);

    const result = await router.routeRequest(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TIMEOUT');
      expect(result.detail).toContain('All candidate providers failed to generate a response.');
    }

    expect((mockOpenAIProvider.generateResponse as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((mockAnthropicProvider.generateResponse as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  test('should return error if provider cannot fulfill request (checking one candidate)', async () => {
    // Create a config with only OpenAI provider
    const specificConfig = JSON.parse(JSON.stringify(await mockConfigServiceInstance.getConfiguration()));
    specificConfig.routing.providerPreferenceOrder = ['openai'];
    delete specificConfig.providers.anthropic;
    mockGetConfiguration.mockResolvedValue(specificConfig);

    // Create a provider instance that cannot fulfill the request
    const mockOpenAIProvider = createMockProvider('openai', false);
    
    // Replace router's providers
    router.clearProviders();
    router.addProvider('openai', mockOpenAIProvider);

    const request: AIModelRequest = { prompt: 'Test fulfillment fail', context: mockContext };
    const result = await router.routeRequest(request);

    expect((mockOpenAIProvider.canFulfill as jest.Mock)).toHaveBeenCalledWith(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TIMEOUT');
      expect(result.detail).toContain('No suitable active provider available');
      expect(result.detail).toContain('cannot_fulfill');
    }
  });

  test('should pass through provider errors (checking one candidate)', async () => {
    // Create a config with only OpenAI provider
    const specificConfig = JSON.parse(JSON.stringify(await mockConfigServiceInstance.getConfiguration()));
    specificConfig.routing.providerPreferenceOrder = ['openai'];
    delete specificConfig.providers.anthropic;
    mockGetConfiguration.mockResolvedValue(specificConfig);

    // Create a provider instance that returns an error
    const mockOpenAIProvider = createMockProvider('openai', true, false, false, 'AUTH');
    const openAIError = { 
      ok: false as const, 
      code: 'AUTH' as const, 
      provider: 'openai', 
      detail: 'Auth error from mock', 
      retryable: false,
      status: 401
    };
    (mockOpenAIProvider.generateResponse as jest.Mock).mockResolvedValue(openAIError);
    
    // Replace router's providers
    router.clearProviders();
    router.addProvider('openai', mockOpenAIProvider);

    const request: AIModelRequest = { prompt: 'Test provider error', context: mockContext };
    const result = await router.routeRequest(request);

    expect((mockOpenAIProvider.generateResponse as jest.Mock)).toHaveBeenCalledTimes(1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TIMEOUT');
      expect(result.detail).toContain('All candidate providers failed to generate a response');
      expect(result.detail).toContain('openai(added_to_candidates)');
    }
  });

  test('should call recordFailure for retryable provider errors (single candidate)', async () => {
    // Create a config with only OpenAI provider
    const specificConfig = JSON.parse(JSON.stringify(await mockConfigServiceInstance.getConfiguration()));
    specificConfig.routing.providerPreferenceOrder = ['openai'];
    delete specificConfig.providers.anthropic;
    mockGetConfiguration.mockResolvedValue(specificConfig);
    mockRecordFailure.mockClear();

    // Create a provider that returns a retryable error
    const mockOpenAIProvider = createMockProvider('openai', true, false, true, 'TIMEOUT');
    const openAIError = { 
      ok: false as const, 
      code: 'TIMEOUT' as const, 
      provider: 'openai', 
      detail: 'Retryable timeout from mock', 
      retryable: true,
      status: 408
    };
    (mockOpenAIProvider.generateResponse as jest.Mock).mockResolvedValue(openAIError);
    
    // Replace router's providers
    router.clearProviders();
    router.addProvider('openai', mockOpenAIProvider);

    const request: AIModelRequest = { prompt: 'Test retryable failure', context: mockContext };
    await router.routeRequest(request);

    expect((mockOpenAIProvider.generateResponse as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(mockRecordFailure).toHaveBeenCalledWith(`openai#${MOCK_AWS_CLIENT_REGION}`, expect.any(Number));
  });
  
  test('should NOT call recordFailure for non-retryable AUTH provider errors (single candidate)', async () => {
    const specificConfig = JSON.parse(JSON.stringify(await mockConfigServiceInstance.getConfiguration()));
    specificConfig.routing.providerPreferenceOrder = ['openai'];
    mockGetConfiguration.mockResolvedValue(specificConfig);

    mockOpenAIGenerateResponse.mockResolvedValueOnce({ ok: false, code: 'AUTH', provider: 'openai', detail: 'Non-retryable auth', retryable: false });
     MockedOpenAIModelProviderConstructor.mockImplementation(() => ({ 
        generateResponse: mockOpenAIGenerateResponse, 
        canFulfill: jest.fn().mockResolvedValue(true), 
        getModelCapabilities: jest.fn().mockReturnValue(mockOpenAIModelConfig) 
    }));
    
    const request: AIModelRequest = { prompt: 'Test non-retryable auth', context: mockContext };
    await router.routeRequest(request);
    expect(mockRecordFailure).not.toHaveBeenCalledWith(`openai#${MOCK_AWS_CLIENT_REGION}`, expect.any(Number));
  });

  test('should fallback to next preferred provider if first preferred is OPEN, and select cheaper of remaining', async () => {
    const request: AIModelRequest = {
      prompt: 'Test fallback to cheapest of remaining',
      estimatedInputTokens: 10,
      estimatedOutputTokens: 10,
      context: mockContext
    };

    // Create a new test configuration with a third dummy provider that's the cheapest
    const specificConfig = JSON.parse(JSON.stringify(await mockConfigServiceInstance.getConfiguration()));
    specificConfig.providers.openai.models[DEFAULT_OPENAI_MODEL].inputCost = 0.002;
    specificConfig.providers.openai.models[DEFAULT_OPENAI_MODEL].outputCost = 0.003;
    specificConfig.providers.anthropic.models[DEFAULT_ANTHROPIC_MODEL].inputCost = 0.00025;
    specificConfig.providers.anthropic.models[DEFAULT_ANTHROPIC_MODEL].outputCost = 0.00125;
    
    const dummyModelConfig = { 
      inputCost: 0.0001, 
      outputCost: 0.0001, 
      priority: 1, 
      capabilities: [], 
      contextSize: 1000, 
      streamingSupport: true, 
      functionCalling: false, 
      active: true, 
      rolloutPercentage: 100, 
      reasoning: 1, 
      creativity: 1, 
      coding: 1, 
      retrieval: false, 
      vision: false, 
      toolUse: false, 
      configurable: true, 
      maxOutputTokens: 1000 
    };
    
    specificConfig.providers['dummy'] = {
      active: true, 
      keyVersion: 1, 
      secretId: 'dummy-secret', 
      defaultModel: 'dummy-model',
      endpoints: { default: { url: '', region: 'global', priority: 3, active: true } },
      models: { 'dummy-model': dummyModelConfig },
      rateLimits: { rpm: 10, tpm: 1000 }, 
      retryConfig: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 1 }, 
      apiVersion: 'v1',
      rolloutPercentage: 100
    };
    specificConfig.routing.providerPreferenceOrder = ['openai', 'anthropic', 'dummy'];
    mockGetConfiguration.mockReset();
    mockGetConfiguration.mockResolvedValue(specificConfig);

    // Create provider instances with specific behaviors
    const mockOpenAIProvider = createMockProvider('openai');
    const mockAnthropicProvider = createMockProvider('anthropic');
    const mockDummyProvider = createMockProvider('dummy');
    
    const dummySuccess = { 
      ok: true, 
      text: 'Response from dummy', 
      tokens: {prompt:10, completion:10, total:20}, 
      meta: { provider: 'dummy', model:'dummy-model', features:[], region: MOCK_AWS_CLIENT_REGION, latency:1, timestamp:Date.now() } 
    };
    
    (mockDummyProvider.generateResponse as jest.Mock).mockResolvedValue(dummySuccess);
    (mockDummyProvider.getModelCapabilities as jest.Mock).mockReturnValue(dummyModelConfig);
    
    // Replace router's providers
    router.clearProviders();
    router.addProvider('openai', mockOpenAIProvider);
    router.addProvider('anthropic', mockAnthropicProvider);
    router.addProvider('dummy', mockDummyProvider);

    // Mock the circuit breaker to only block openai
    mockIsRequestAllowed.mockImplementation(key => {
      if (key === `openai#${MOCK_AWS_CLIENT_REGION}`) return Promise.resolve(false);
      return Promise.resolve(true);
    });

    const result = await router.routeRequest(request);

    expect(mockIsRequestAllowed).toHaveBeenCalledWith(`openai#${MOCK_AWS_CLIENT_REGION}`);
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(`anthropic#${MOCK_AWS_CLIENT_REGION}`);
    expect(mockIsRequestAllowed).toHaveBeenCalledWith(`dummy#${MOCK_AWS_CLIENT_REGION}`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('dummy');
    }
    
    expect((mockDummyProvider.generateResponse as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((mockAnthropicProvider.generateResponse as jest.Mock)).not.toHaveBeenCalled();
    expect((mockOpenAIProvider.generateResponse as jest.Mock)).not.toHaveBeenCalled();
    
    // Reset for other tests
    mockIsRequestAllowed.mockImplementation(() => Promise.resolve(true));
  });

});
