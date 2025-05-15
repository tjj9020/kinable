import { AnthropicModelProvider } from './AnthropicModelProvider';
import { AIModelRequest, ChatMessage, AIModelError } from '../../../../packages/common-types/src/ai-interfaces';
import { RequestContext, IDatabaseProvider } from '../../../../packages/common-types/src/core-interfaces';
import { GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import Anthropic, { APIError as AnthropicAPIError } from '@anthropic-ai/sdk';
import { ProviderConfig } from '../../../../packages/common-types/src/config-schema';

// Mock @aws-sdk/client-secrets-manager
const globalMockSecretsManagerSend = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-secrets-manager');
  return {
    ...originalModule,
    SecretsManagerClient: jest.fn(() => ({
      send: globalMockSecretsManagerSend,
    })),
    GetSecretValueCommand: jest.fn((input) => ({ input })),
  };
});

// Mock @anthropic-ai/sdk
const mockAnthropicClientCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  const OriginalAnthropic = jest.requireActual('@anthropic-ai/sdk');
  return {
    ...OriginalAnthropic,
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: mockAnthropicClientCreate,
      },
    })),
    // Explicitly re-export APIError if it was part of the default export's namespace, 
    // or ensure it's picked up by ...OriginalAnthropic if it's a named export.
    // For safety, if APIError is a named export, it should be fine with ...OriginalAnthropic.
    // If it's namespaced under the default export usually, this mock structure changes that.
    // The direct import above (AnthropicAPIError) is the safer bet.
  };
});

// Sample request context
const mockContext: RequestContext = {
  requestId: 'test-request-id',
  jwtSub: 'test-user',
  familyId: 'test-family',
  profileId: 'test-profile',
  region: 'us-east-1', // Anthropic might have specific regions
  traceId: 'test-trace-id',
};

const MOCK_SECRET_ID = 'test-anthropic-secret';
const MOCK_AWS_REGION = 'us-test-1'; // Region for Secrets Manager
const MOCK_ANTHROPIC_DEFAULT_MODEL = 'claude-3-haiku-20240307'; // Added

// Mock IDatabaseProvider for Anthropic tests
const mockDbProvider: IDatabaseProvider = {
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  query: jest.fn(),
};

// Default mock provider config
const mockProviderConfig: ProviderConfig = {
  active: true,
  defaultModel: MOCK_ANTHROPIC_DEFAULT_MODEL,
  models: {
    [MOCK_ANTHROPIC_DEFAULT_MODEL]: {
      contextSize: 200000,
      tokenCost: 0.25 / 1000000,
      streamingSupport: true,
      functionCalling: true,
      priority: 1,
      capabilities: [],
      active: true,
      rolloutPercentage: 100,
    },
    'claude-3-opus-20240229': {
      contextSize: 200000,
      tokenCost: 15 / 1000000,
      streamingSupport: true,
      functionCalling: true,
      priority: 2,
      capabilities: [],
      active: true,
      rolloutPercentage: 100,
    }
  },
  rateLimits: { rpm: 100, tpm: 40000 },
  keyVersion: 1,
  endpoints: {
    'default': { url: 'https://api.anthropic.com', region: 'global', priority: 1, active: true }
  },
  retryConfig: { maxRetries: 3, initialDelayMs: 200, maxDelayMs: 1000 },
  apiVersion: '2023-06-01',
  rolloutPercentage: 100,
};

describe('AnthropicModelProvider', () => {
  let provider: AnthropicModelProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    globalMockSecretsManagerSend.mockClear();
    mockAnthropicClientCreate.mockClear();
  });

  // --- Tests for when Anthropic client IS SUCCESSFULLY INITIALIZED INTERNALLY ---
  describe('with successful internal client initialization', () => {
    beforeEach(() => {
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({ current: 'test-anthropic-api-key' }),
      } as GetSecretValueCommandOutput);

      provider = new AnthropicModelProvider(
        MOCK_SECRET_ID, 
        MOCK_AWS_REGION, 
        mockDbProvider,
        MOCK_ANTHROPIC_DEFAULT_MODEL
      );
      provider.setProviderConfig(mockProviderConfig);
    });

    test('should use injected client to generate response', async () => {
      const mockRequest: AIModelRequest = { prompt: 'Hello Anthropic', context: mockContext, preferredModel: 'claude-3-haiku-20240307' };
      const mockApiResponse: Anthropic.Messages.Message = {
        id: 'msg_01AbC',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there from Claude!', citations: [] }],
        model: 'claude-3-haiku-20240307',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { 
          input_tokens: 10, 
          output_tokens: 10, 
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use: { web_search_requests: 0 },
        },
      };
      mockAnthropicClientCreate.mockResolvedValue(mockApiResponse);

      const result = await provider.generateResponse(mockRequest);

      expect(mockAnthropicClientCreate).toHaveBeenCalledTimes(1);
      expect(mockAnthropicClientCreate).toHaveBeenCalledWith({
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'Hello Anthropic' }],
        max_tokens: expect.any(Number), // Anthropic SDK requires max_tokens
        system: undefined, // No system prompt in this request
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe('Hi there from Claude!');
        expect(result.tokens?.total).toBe(20); // 10 input + 10 output
      }
      expect(globalMockSecretsManagerSend).toHaveBeenCalledTimes(1);
    });

    test('should handle API errors from injected client', async () => {
      const mockRequest: AIModelRequest = { prompt: 'Test error', context: mockContext };
      // Use the directly imported AnthropicAPIError
      const apiError = new AnthropicAPIError(400, { error: { type: 'invalid_request_error', message: 'Mock Anthropic API Error' } }, 'Mock Anthropic API Error', undefined);
      mockAnthropicClientCreate.mockRejectedValue(apiError);

      const result = await provider.generateResponse(mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('UNKNOWN'); // Default fallback or specific mapping
        expect(result.detail).toContain('Mock Anthropic API Error');
      }
    });

    test('should still respect rate limits even with injected client', async () => {
      const testLimits = { rpm: 1, tpm: 10 };
      jest.spyOn(provider, 'getProviderLimits').mockReturnValue(testLimits);
      // @ts-expect-error - Accessing private member for test setup
      provider.tokenBucket.tokens = 0; // Exhaust tokens to trigger rate limit
      // @ts-expect-error - Accessing private member for test setup
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
      expect(mockAnthropicClientCreate).not.toHaveBeenCalled();
    });

    // --- CONVERSATION HISTORY TESTS ---
    describe('conversation history handling', () => {
      const defaultModel = 'claude-3-haiku-20240307';
      const mockBaseUsage: Anthropic.Messages.Usage = {
        input_tokens: 5, 
        output_tokens: 5, 
        cache_creation_input_tokens: 0, 
        cache_read_input_tokens: 0,
        server_tool_use: { web_search_requests: 0 },
      };
      const mockBaseApiResponse: Partial<Anthropic.Messages.Message> = {
        id: 'msg_hist_test',
        type: 'message',
        role: 'assistant',
        model: defaultModel,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: mockBaseUsage,
      };

      beforeEach(() => {
        globalMockSecretsManagerSend.mockResolvedValueOnce({
            SecretString: JSON.stringify({ current: 'test-anthropic-api-key' }),
        } as GetSecretValueCommandOutput);
      });

      test('should handle empty conversationHistory (single prompt)', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'Current user prompt.',
          context: { ...mockContext, conversationHistory: [] },
          preferredModel: defaultModel
        };
        mockAnthropicClientCreate.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Response to current prompt.', citations: [] }],
        });

        await provider.generateResponse(mockRequest);

        expect(mockAnthropicClientCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: defaultModel,
            messages: [{ role: 'user', content: 'Current user prompt.' }],
            max_tokens: 1024,
            temperature: undefined,
            system: undefined,
          })
        );
      });

      test('should include user and assistant messages from history', async () => {
        const history: ChatMessage[] = [
          { role: 'user', content: 'Previous user question.' },
          { role: 'assistant', content: 'Previous assistant answer.' },
        ];
        const mockRequest: AIModelRequest = {
          prompt: 'Latest user question.',
          context: { ...mockContext, conversationHistory: history },
          preferredModel: defaultModel
        };
        mockAnthropicClientCreate.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Response to latest question.', citations: [] }],
        });
        
        await provider.generateResponse(mockRequest);

        expect(mockAnthropicClientCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: defaultModel,
            messages: [
              { role: 'user', content: 'Previous user question.' },
              { role: 'assistant', content: 'Previous assistant answer.' },
              { role: 'user', content: 'Latest user question.' },
            ],
            max_tokens: 1024,
            temperature: undefined,
            system: undefined,
          })
        );
      });

      test('should use system message from conversationHistory for Anthropic system parameter', async () => {
        const history: ChatMessage[] = [
          { role: 'user', content: 'Older user message.' },
          { role: 'system', content: 'System instruction for Claude.' },
          { role: 'assistant', content: 'Older assistant reply.' },
        ];
        const mockRequest: AIModelRequest = {
          prompt: 'User query.',
          context: { ...mockContext, conversationHistory: history },
          preferredModel: defaultModel
        };
         mockAnthropicClientCreate.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Response to query with system prompt.', citations: [] }],
        });

        await provider.generateResponse(mockRequest);

        expect(mockAnthropicClientCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: defaultModel,
            messages: [
              { role: 'user', content: 'Older user message.' },
              { role: 'assistant', content: 'Older assistant reply.' },
              { role: 'user', content: 'User query.' },
            ],
            max_tokens: 1024,
            temperature: undefined,
            system: 'System instruction for Claude.',
          })
        );
      });

      test('should handle mixed history, using the first system message and filtering others', async () => {
        const history: ChatMessage[] = [
          { role: 'system', content: 'Primary system instruction.' },
          { role: 'user', content: 'First user message.' },
          { role: 'assistant', content: 'First assistant response.' },
          { role: 'system', content: 'This system message should be ignored.' },
          { role: 'user', content: 'Second user message.' },
        ];
        const mockRequest: AIModelRequest = {
          prompt: 'Final user prompt.',
          context: { ...mockContext, conversationHistory: history },
          preferredModel: defaultModel
        };
        mockAnthropicClientCreate.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Final response.', citations: [] }],
        });

        await provider.generateResponse(mockRequest);

        expect(mockAnthropicClientCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: defaultModel,
            messages: [
              { role: 'user', content: 'First user message.' },
              { role: 'assistant', content: 'First assistant response.' },
              { role: 'user', content: 'Second user message.' },
              { role: 'user', content: 'Final user prompt.' },
            ],
            max_tokens: 1024,
            temperature: undefined,
            system: 'Primary system instruction.',
          })
        );
      });
       test('should correctly map Anthropic content array to single string for AIModelSuccess', async () => {
        const mockRequest: AIModelRequest = { prompt: 'Map this content', context: mockContext, preferredModel: defaultModel };
        const mockAnthropicResponse: Anthropic.Messages.Message = {
            id: 'msg_map_test',
            type: 'message',
            role: 'assistant',
            content: [
                { type: 'text', text: 'Hello ', citations: [] },
                { type: 'text', text: 'World!', citations: [] },
                // Potentially other content block types here if supported/handled by provider
            ],
            model: defaultModel,
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: mockBaseUsage,
        };
        mockAnthropicClientCreate.mockResolvedValue(mockAnthropicResponse);

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
    beforeEach(() => {
      provider = new AnthropicModelProvider(
        MOCK_SECRET_ID, 
        MOCK_AWS_REGION, 
        mockDbProvider,
        MOCK_ANTHROPIC_DEFAULT_MODEL
      );
      provider.setProviderConfig(mockProviderConfig);
      globalMockSecretsManagerSend.mockReset(); // Reset mock for AWS SDK v3
    });

    test('should fetch API keys and generate response', async () => {
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({ current: 'test-anthropic-api-key' }),
      } as GetSecretValueCommandOutput);

      const mockApiResponse: Anthropic.Messages.Message = {
        id: 'msg_fetch_key_test', type: 'message', role: 'assistant',
        content: [{ type: 'text', text: 'Success after key fetch!', citations: [] }],
        model: 'claude-3-opus-20240229', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0 } },
      };
      
      // Spy on the internally created client's method after keys are loaded.
      const internalCreateMock = jest.fn().mockResolvedValue(mockApiResponse);
      
      // Call private method for testing setup to load keys
      // This assumes _ensureApiKeysLoaded correctly sets up this.anthropicClient
      await provider['_ensureApiKeysLoaded'](); 
      
      if (provider['anthropicClient']) {
        provider['anthropicClient'].messages = { create: internalCreateMock } as any;
      } else {
        throw new Error("Test setup error: anthropicClient not initialized after _ensureApiKeysLoaded");
      }

      const result = await provider.generateResponse({ prompt: 'Test key fetch', context: mockContext, preferredModel: 'claude-3-opus-20240229' });

      expect(globalMockSecretsManagerSend).toHaveBeenCalledTimes(1);
      expect(internalCreateMock).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if(result.ok) expect(result.text).toBe('Success after key fetch!');
    });

    test('should return AUTH error if API key fetch fails', async () => {
      globalMockSecretsManagerSend.mockRejectedValue(new Error('Secrets Manager Error for Anthropic'));
      const result = await provider.generateResponse({ prompt: 'Test key fail', context: mockContext });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toContain('[AnthropicModelProvider] Failed to initialize client or load API credentials: Failed to load API keys from Secrets Manager: Secrets Manager Error for Anthropic');
      }
    });
     test('should handle malformed secret string from Secrets Manager', async () => {
      globalMockSecretsManagerSend.mockResolvedValueOnce({ SecretString: 'not-a-json-string', $metadata: {} } as GetSecretValueCommandOutput);
      const malformedSecretRequest: AIModelRequest = { prompt: 'Test malformed secret', context: mockContext };
      const result = await provider.generateResponse(malformedSecretRequest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toContain('[AnthropicModelProvider] Failed to initialize client or load API credentials:');
        expect(result.detail).toMatch(/Failed to load API keys from Secrets Manager: Unexpected token .*JSON/i);
      }
    });

    test('should handle secret string missing "current" key', async () => {
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({ previous: 'some-old-key' }), // Missing 'current'
      } as GetSecretValueCommandOutput);

      const result = await provider.generateResponse({ prompt: 'Test missing current key', context: mockContext });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toBe('[AnthropicModelProvider] Failed to initialize client or load API credentials: Failed to load API keys from Secrets Manager: Fetched secret does not contain a "current" API key.');
      }
    });

    test('should handle undefined SecretString from Secrets Manager', async () => {
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: undefined,
      } as GetSecretValueCommandOutput);

      const result = await provider.generateResponse({ prompt: 'Test undefined SecretString', context: mockContext });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toContain('[AnthropicModelProvider] Failed to initialize client or load API credentials: Failed to load API keys from Secrets Manager: SecretString is empty or not found in Secrets Manager response.');
      }
    });
  });

  describe('general provider methods', () => {
    beforeEach(() => {
      provider = new AnthropicModelProvider(MOCK_SECRET_ID, MOCK_AWS_REGION, mockDbProvider, MOCK_ANTHROPIC_DEFAULT_MODEL);
      provider.setProviderConfig(mockProviderConfig);
    });

    test('canFulfill should return true for valid model and no specific capabilities', async () => {
      const request: AIModelRequest = { prompt: 'test', context: mockContext, preferredModel: 'claude-3-haiku-20240307' };
      const result = await provider.canFulfill(request);
      expect(result).toBe(true);
    });

    test('canFulfill should return false for unsupported model', async () => {
      const request: AIModelRequest = { prompt: 'test', context: mockContext, preferredModel: 'unsupported-anthropic-model' };
      const result = await provider.canFulfill(request);
      expect(result).toBe(false);
    });

    test('getModelCapabilities should return defined capabilities for known models', () => {
      const capabilitiesHaiku = provider.getModelCapabilities('claude-3-haiku-20240307');
      expect(capabilitiesHaiku).toBeDefined();
      if (capabilitiesHaiku) {
        expect(capabilitiesHaiku.functionCalling).toBe(true);
      }

      const capabilitiesOpus = provider.getModelCapabilities('claude-3-opus-20240229');
      expect(capabilitiesOpus).toBeDefined();
      if (capabilitiesOpus) {
        expect(capabilitiesOpus.functionCalling).toBe(true);
      }
    });

    test('getProviderLimits should return limits from config', () => {
      const limits = provider.getProviderLimits();
      expect(limits.rpm).toBe(mockProviderConfig.rateLimits.rpm);
      expect(limits.tpm).toBe(mockProviderConfig.rateLimits.tpm);
    });

    test('getProviderHealth should return current health status', async () => {
      const health = await provider.getProviderHealth();
      expect(health.available).toBe(true);
      expect(health.errorRate).toBe(0);
    });
  });
}); 