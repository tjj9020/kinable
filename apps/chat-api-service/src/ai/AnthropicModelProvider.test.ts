import { AIModelRequest, ChatMessage, AIModelError } from '@kinable/common-types';
import { RequestContext, IDatabaseProvider } from '@kinable/common-types';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import OriginalAnthropicSDK, { APIError as OriginalAnthropicAPIError } from '@anthropic-ai/sdk';
import { ProviderConfig, ModelConfig } from '@kinable/common-types';
import { mockClient } from 'aws-sdk-client-mock';
import { ConfigurationService } from './ConfigurationService';

// Define constants locally
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-haiku-20240307';
const DEFAULT_MAX_TOKENS = 4096;

// This is the mock for the Anthropic SDK's default export (the constructor)
const mockAnthropicSdkConstructor = jest.fn();

// Use jest.doMock for non-hoisted behavior.
// This block executes before any imports in AnthropicModelProvider if it's dynamically imported later.
jest.doMock('@anthropic-ai/sdk', () => {
  const actualAnthropicSdk = jest.requireActual('@anthropic-ai/sdk');
  return {
    __esModule: true,
    default: mockAnthropicSdkConstructor,
    APIError: actualAnthropicSdk.APIError,
  };
});

// Create the mock SecretsManagerClient instance at the top level
const mockSecretsManager = mockClient(new SecretsManagerClient({ region: 'us-test-1' }));

// Simplified mockContext, assuming common fields. Will verify against actual RequestContext later.
const mockContext: RequestContext = {
  requestId: 'test-request-id',
  region: 'us-test-1',
  traceId: 'test-trace-id',
};

const anthropicSpecificProviderConfig: ProviderConfig = {
  secretId: 'test-anthropic-secret',
  models: {
    [DEFAULT_ANTHROPIC_MODEL]: {
      id: DEFAULT_ANTHROPIC_MODEL,
      name: 'Claude 3 Haiku',
      contextWindow: 200000,
      maxOutputTokens: DEFAULT_MAX_TOKENS,
      costPerMillionInputTokens: 0.25,
      costPerMillionOutputTokens: 1.25,
      active: true,
      visionSupport: true,
      functionCallingSupport: false,
      capabilities: ['fast', 'vision'],
      streamingSupport: true,
    },
  },
  active: true,
  defaultModel: DEFAULT_ANTHROPIC_MODEL,
  rateLimits: { rpm: 100, tpm: 100000 },
};

// Full mockProviderConfig (as used in ConfigurationService mock)
const mockProviderConfig = {
  providers: {
    anthropic: anthropicSpecificProviderConfig,
    // other providers if needed by ConfigurationService mock
  },
  modelRouting: { defaultPreferences: ['anthropic'], strategy: 'cost' },
  globalMaxOutputTokens: DEFAULT_MAX_TOKENS,
};

const defaultModel = DEFAULT_ANTHROPIC_MODEL;

const mockBaseUsage = { input_tokens: 10, output_tokens: 20 };
const mockBaseApiResponse = {
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: defaultModel,
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: mockBaseUsage,
};

// Simplified mockDbProvider, assuming common methods. Will verify against actual IDatabaseProvider later.
const mockDbProvider: jest.Mocked<IDatabaseProvider> = {
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  query: jest.fn(),
} as unknown as jest.Mocked<IDatabaseProvider>; // Cast to bypass strict checks temporarily

// Default model configurations for tests
const claude21ModelConfig: ModelConfig = {
  id: 'claude-2.1',
  name: 'Claude 2.1',
  contextWindow: 200000,
  maxOutputTokens: 4096,
  active: true,
  visionSupport: false,
  functionCallingSupport: false,
  capabilities: ["general"],
  streamingSupport: true,
  costPerMillionInputTokens: 8,
  costPerMillionOutputTokens: 24,
};
const claudeInstantModelConfig: ModelConfig = {
  id: 'claude-instant-1.2',
  name: 'Claude Instant 1.2',
  contextWindow: 100000,
  maxOutputTokens: 4096,
  active: true,
  visionSupport: false,
  functionCallingSupport: false,
  capabilities: ["general"],
  streamingSupport: true,
  costPerMillionInputTokens: 0.8,
  costPerMillionOutputTokens: 2.4,
};
const claudeHaikuModelConfig: ModelConfig = {
  id: 'claude-3-haiku-20240307',
  name: 'Claude Haiku',
  contextWindow: 200000,
  maxOutputTokens: 4096,
  active: true,
  visionSupport: true,
  functionCallingSupport: false,
  capabilities: ["general", "vision"],
  streamingSupport: true,
  costPerMillionInputTokens: 0.25,
  costPerMillionOutputTokens: 1.25,
};

describe('AnthropicModelProvider', () => {
  let AnthropicModelProviderClass: typeof import('./AnthropicModelProvider').AnthropicModelProvider;
  let provider: import('./AnthropicModelProvider').AnthropicModelProvider;
  let mockConfigService: jest.Mocked<ConfigurationService>;

  let currentMockMessagesCreate: jest.Mock;
  let FreshGetSecretValueCommand: typeof import('@aws-sdk/client-secrets-manager').GetSecretValueCommand;

  beforeEach(async () => {
    jest.resetModules();
    mockSecretsManager.reset(); 

    const SecretsManagerModule = await import('@aws-sdk/client-secrets-manager');
    FreshGetSecretValueCommand = SecretsManagerModule.GetSecretValueCommand;

    // RESTORED: Default successful mock for GetSecretValueCommand
    mockSecretsManager.on(FreshGetSecretValueCommand).resolves({ 
      SecretString: JSON.stringify({ current: 'fresh-universal-success-key' })
    });

    const providerModule = await import('./AnthropicModelProvider');
    AnthropicModelProviderClass = providerModule.AnthropicModelProvider;

    mockAnthropicSdkConstructor.mockClear();
    currentMockMessagesCreate = jest.fn(); 
    mockAnthropicSdkConstructor.mockImplementation(() => ({
      messages: { create: currentMockMessagesCreate },
    }));
    
    mockConfigService = {
        getConfiguration: jest.fn().mockResolvedValue(mockProviderConfig as any),
        getGlobalMaxOutputTokens: jest.fn().mockReturnValue(DEFAULT_MAX_TOKENS),
        getProviderConfig: jest.fn().mockImplementation((name) => {
            if (name === 'anthropic') return anthropicSpecificProviderConfig;
            return undefined;
        }),
        getModelConfig: jest.fn().mockImplementation((providerName, modelName) => {
            if (providerName === 'anthropic' && anthropicSpecificProviderConfig.models[modelName]) {
                return anthropicSpecificProviderConfig.models[modelName];
            }
            return undefined;
        }),
        isProviderModelActive: jest.fn().mockReturnValue(true),
        getCredentialsForProvider: jest.fn(),
        getProviderNames: jest.fn().mockReturnValue(['anthropic']),
        refreshConfiguration: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ConfigurationService>;
        
    provider = new AnthropicModelProviderClass(
      anthropicSpecificProviderConfig.secretId, 
      mockContext.region,      
      mockDbProvider,          
      DEFAULT_ANTHROPIC_MODEL, 
      anthropicSpecificProviderConfig, 
      mockSecretsManager as unknown as SecretsManagerClient 
    );
  });

  describe('with mocked Anthropic client (via SDK constructor mock)', () => {
    beforeEach(() => {
      // REMOVED: No longer need to add specific mock here if default is restored
      // mockSecretsManager.on(FreshGetSecretValueCommand).resolves({
      //   SecretString: JSON.stringify({ current: 'mock-sdk-test-key' }),
      // });
    });

    test('should use mocked client to generate response', async () => {
      const mockRequest: AIModelRequest = { prompt: 'Hello Anthropic', context: mockContext, preferredModel: 'claude-3-haiku-20240307' };
      const mockApiResponse = {
        ...mockBaseApiResponse,
        content: [{ type: 'text', text: 'Mocked Anthropic Response' }],
      };
      currentMockMessagesCreate.mockResolvedValue(mockApiResponse);

      const result = await provider.generateResponse(mockRequest);

      expect(currentMockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(currentMockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'Hello Anthropic' }],
          max_tokens: 1024,
          system: undefined,
          temperature: undefined,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe('Mocked Anthropic Response');
      }
    });

    test('should handle API errors from mocked client', async () => {
      const mockRequest: AIModelRequest = { context: mockContext, prompt: 'Test prompt' };
      const mockGenericError = new Error('Mock Anthropic API Error');
      currentMockMessagesCreate.mockRejectedValueOnce(mockGenericError);
      const result = await provider.generateResponse(mockRequest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
         // Generic errors from SDK are standardized to 'UNKNOWN' by BaseAIModelProvider if not an APIError instance
        expect(result.code).toBe('UNKNOWN'); 
        expect(result.detail).toContain('Mock Anthropic API Error');
      }
    });

    test('should respect token limits and return RATE_LIMIT', async () => {
      // @ts-expect-error - Accessing private member for test setup
      provider.tokenBucket.tokens = 0; 
      // @ts-expect-error
      provider.tokenBucket.lastRefill = Date.now();

      const request: AIModelRequest = {
        prompt: 'test '.repeat(10000), // A long prompt
        context: mockContext,
      };
      
      const result = await provider.generateResponse(request);
      expect(result.ok).toBe(false);
      if(!result.ok) {
        expect(result.code).toBe('RATE_LIMIT');
      }
      expect(currentMockMessagesCreate).not.toHaveBeenCalled();
    });

    // --- CONVERSATION HISTORY TESTS ---
    describe('conversation history handling', () => {
      beforeEach(() => {
        // REMOVED: No longer need to add specific mock here if default is restored
        // mockSecretsManager.on(FreshGetSecretValueCommand).resolves({
        //     SecretString: JSON.stringify({ current: 'conv-hist-test-key' }),
        // });
      });

      test('should handle empty conversationHistory correctly (single prompt)', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'Current user prompt.',
          context: { ...mockContext, history: [] },
          preferredModel: defaultModel
        };
        currentMockMessagesCreate.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Response to current prompt.'}],
        });

        await provider.generateResponse(mockRequest);

        expect(currentMockMessagesCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: defaultModel,
            messages: [{ role: 'user', content: 'Current user prompt.' }],
            system: undefined,
          })
        );
      });

      test('should include user and assistant messages from history', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'Latest user question.',
          context: {
            ...mockContext,
            history: [
              { role: 'user', content: 'Previous user question.' },
              { role: 'assistant', content: 'Previous assistant answer.' },
            ],
          },
          preferredModel: defaultModel
        };
        currentMockMessagesCreate.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Response to latest question.'}],
        });
        
        await provider.generateResponse(mockRequest);

        expect(currentMockMessagesCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: defaultModel,
            messages: [
              { role: 'user', content: 'Previous user question.' },
              { role: 'assistant', content: 'Previous assistant answer.' },
              { role: 'user', content: 'Latest user question.' },
            ],
            system: undefined,
          })
        );
      });

      test('should use request.systemPrompt for Anthropic system parameter', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'User query.',
          systemPrompt: 'System instruction for Claude.',
          context: {
            ...mockContext,
            history: [
              { role: 'user', content: 'Older user message.' },
              { role: 'assistant', content: 'Older assistant reply.' },
            ],
          },
          preferredModel: defaultModel
        };
         currentMockMessagesCreate.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Response to query with system prompt.'}],
        });

        await provider.generateResponse(mockRequest);

        expect(currentMockMessagesCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: defaultModel,
            messages: [
              { role: 'user', content: 'Older user message.' },
              { role: 'assistant', content: 'Older assistant reply.' },
              { role: 'user', content: 'User query.' },
            ],
            system: 'System instruction for Claude.',
          })
        );
      });

      test('should use request.systemPrompt and ignore system messages in history', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'Final user prompt.',
          systemPrompt: 'Primary system instruction.',
          context: {
            ...mockContext,
            history: [
              { role: 'user', content: 'First user message.' },
              { role: 'assistant', content: 'First assistant response.' },
              { role: 'user', content: 'Second user message.' },
            ],
          },
          preferredModel: defaultModel
        };
        currentMockMessagesCreate.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Final response.'}],
        });

        await provider.generateResponse(mockRequest);

        expect(currentMockMessagesCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: defaultModel,
            messages: [
              { role: 'user', content: 'First user message.' },
              { role: 'assistant', content: 'First assistant response.' },
              { role: 'user', content: 'Second user message.' },
              { role: 'user', content: 'Final user prompt.' },
            ],
            system: 'Primary system instruction.',
          })
        );
      });
      
      test('should correctly map Anthropic content array to single string for AIModelSuccess', async () => {
        const mockRequest: AIModelRequest = { prompt: 'Test Vision', context: mockContext, preferredModel: defaultModel };
        const mockAnthropicResponse = {
            ...mockBaseApiResponse,
            content: [
                { type: 'text', text: 'Hello ' },
                { type: 'text', text: 'World!' }
            ],
            usage: mockBaseUsage,
        };
        currentMockMessagesCreate.mockResolvedValue(mockAnthropicResponse);

        const result = await provider.generateResponse(mockRequest);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.text).toBe('Hello World!');
        }
      });
    });
  });

  // --- Tests for when Anthropic client IS NOT INJECTED (fetches keys) ---
  describe('without injected Anthropic client (fetches keys)', () => {
    let fetchKeysSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      // REMOVED: No longer need to add specific mock here if default is restored
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      if (fetchKeysSpy) {
        fetchKeysSpy.mockRestore();
      }
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
    
    test('should fetch API keys and generate response', async () => {
      // This test will use the default successful GetSecretValueCommand mock
      currentMockMessagesCreate.mockResolvedValueOnce({
        id: 'msg_internal_fetch', type: 'message', role: 'assistant',
        content: [{ type: 'text', text: 'Response from fetched key client' }],
        model: defaultModel, stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 }
      });

      const request: AIModelRequest = { prompt: 'Test API key fetch', context: mockContext };
      const result = await provider.generateResponse(request);

      expect(currentMockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(currentMockMessagesCreate).toHaveBeenCalledWith(expect.objectContaining({
          messages: [{ role: 'user', content: 'Test API key fetch' }],
      }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe('Response from fetched key client');
      }
    });

    test('should handle API errors from mocked client', async () => {
      // This test will use the default successful GetSecretValueCommand mock for key loading
      const mockRequest: AIModelRequest = { context: mockContext, prompt: 'Test prompt' };
      const mockGenericError = new Error('Mock Anthropic API Error from SDK');
      currentMockMessagesCreate.mockRejectedValueOnce(mockGenericError);
      const result = await provider.generateResponse(mockRequest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
         // StandardizeError should map this generic error to UNKNOWN if it doesn't match specific patterns
        expect(result.code).toBe('UNKNOWN'); 
        expect(result.detail).toContain('Mock Anthropic API Error from SDK');
      }
    });

    test('should throw if API key fetching fails', async () => {
      fetchKeysSpy = jest.spyOn(AnthropicModelProviderClass.prototype as any, '_fetchAndParseApiKeys')
        .mockRejectedValueOnce(new Error('Mocked _fetchAndParseApiKeys: failed to load api keys - simulated network error'));
      
      const request: AIModelRequest = { prompt: 'Test key failure', context: mockContext };
      const result = await provider.generateResponse(request);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toBe('Anthropic key/initialization error: Mocked _fetchAndParseApiKeys: failed to load api keys - simulated network error');
      }
      expect(mockAnthropicSdkConstructor).not.toHaveBeenCalled();
      expect(currentMockMessagesCreate).not.toHaveBeenCalled();
    });

    test('should throw if fetched API key is invalid JSON', async () => {
      fetchKeysSpy = jest.spyOn(AnthropicModelProviderClass.prototype as any, '_fetchAndParseApiKeys')
        .mockRejectedValueOnce(new Error('Mocked _fetchAndParseApiKeys: failed to load api keys - simulated parsing error'));
        
      const request: AIModelRequest = { prompt: 'Test invalid JSON key', context: mockContext };
      const result = await provider.generateResponse(request);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toBe('Anthropic key/initialization error: Mocked _fetchAndParseApiKeys: failed to load api keys - simulated parsing error');
      }
      expect(mockAnthropicSdkConstructor).not.toHaveBeenCalled();
      expect(currentMockMessagesCreate).not.toHaveBeenCalled();
    });
    
    test('should throw if fetched API key JSON is missing "current" field', async () => {
      // This test will use its specific mock for GetSecretValueCommand as it tests specific content of secret
      mockSecretsManager.reset(); // Clear default before setting specific
      mockSecretsManager.on(FreshGetSecretValueCommand)
                        .resolves({ SecretString: JSON.stringify({ old: 'key' }) } as any);

      const request: AIModelRequest = { prompt: 'Test missing current key', context: mockContext };
      const result = await provider.generateResponse(request);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toContain('Fetched secret does not contain a "current" API key');
      }
    });

    test('should throw if SecretString is missing in Secrets Manager response', async () => {
      // This test will use its specific mock for GetSecretValueCommand
      mockSecretsManager.reset(); // Clear default before setting specific
      mockSecretsManager.on(FreshGetSecretValueCommand)
                        .resolves({} as any); // No SecretString
        
      const request: AIModelRequest = { prompt: 'Test no secret string', context: mockContext };
      const result = await provider.generateResponse(request);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toContain('SecretString is empty or not found');
      }
    });

    test('should respect token limits and return RATE_LIMIT', async () => {
      // This test will use the default successful GetSecretValueCommand mock
      // @ts-expect-error - Accessing private member for test setup
      provider.tokenBucket.tokens = 0; 
      // @ts-expect-error
      provider.tokenBucket.lastRefill = Date.now();

      const request: AIModelRequest = {
        prompt: 'test '.repeat(10000), // A long prompt
        context: mockContext,
      };
      
      const result = await provider.generateResponse(request);
      expect(result.ok).toBe(false);
      if(!result.ok) {
        expect(result.code).toBe('RATE_LIMIT');
      }
      expect(currentMockMessagesCreate).not.toHaveBeenCalled();
    });

    test('getProviderHealth should return current health status (keys loaded)', async () => {
      // This test will use the default successful GetSecretValueCommand mock
      const health = await provider.getProviderHealth();
      expect(health).toBeDefined();
      expect(health.available).toBe(true); // Should be true as keys are loaded and client would be init'd
      expect(mockAnthropicSdkConstructor).toHaveBeenCalled(); // Client should be created
    });

    test('getProviderHealth should return unavailable if key loading fails', async () => {
      // This test needs to mock GetSecretValueCommand to fail
      mockSecretsManager.reset(); // Clear default before setting specific
      mockSecretsManager.on(FreshGetSecretValueCommand)
                        .rejects(new Error('Health check key fail'));
        
      const health = await provider.getProviderHealth();
      expect(health.available).toBe(false);
      expect(mockAnthropicSdkConstructor).not.toHaveBeenCalled(); 
    });
  });

  // --- GENERAL PROVIDER METHODS ---
  describe('general provider methods', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      // REMOVED: No longer need to add specific mock here if default is restored
      // mockSecretsManager.on(FreshGetSecretValueCommand).resolves({
      //   SecretString: JSON.stringify({ current: 'general-method-test-key' }),
      // });
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    test('getProviderName should return correct name', () => {
      expect(provider.getProviderName()).toBe('anthropic');
    });

    test('canFulfill should return true for configured active model', async () => {
      const request: AIModelRequest = { context: mockContext, prompt: '', preferredModel: defaultModel };
      expect(await provider.canFulfill(request)).toBe(true);
    });

    test('canFulfill should return false for unsupported model', async () => {
      const request: AIModelRequest = { context: mockContext, prompt: '', preferredModel: 'unsupported-model' };
      expect(await provider.canFulfill(request)).toBe(false);
    });

    test('canFulfill should return false for model with missing required capabilities', async () => {
      const request: AIModelRequest = {
        context: mockContext,
        prompt: '',
        preferredModel: defaultModel,
        requiredCapabilities: ['telepathy'], // Not in mock Claude Haiku config
      };
      expect(await provider.canFulfill(request)).toBe(false);
    });

    test('getModelCapabilities should return defined capabilities for known models', () => {
      const caps = provider.getModelCapabilities(defaultModel);
      expect(caps).toBeDefined();
      expect(caps.contextWindow).toBe(200000);

      // Test for an unknown model
      expect(() => provider.getModelCapabilities('unknown-model'))
        .toThrowError(/Model configuration for "unknown-model" not found/);
    });
  });
}); 