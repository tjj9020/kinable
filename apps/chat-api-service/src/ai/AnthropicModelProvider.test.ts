import { AnthropicModelProvider } from './AnthropicModelProvider';
import { AIModelRequest, ChatMessage } from '../../../../packages/common-types/src/ai-interfaces';
import { RequestContext } from '../../../../packages/common-types/src/core-interfaces';
import { GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import Anthropic from '@anthropic-ai/sdk';

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

describe('AnthropicModelProvider', () => {
  let provider: AnthropicModelProvider;
  let mockAnthropicClient: {
    messages: {
      create: jest.Mock<Promise<any>, [Anthropic.Messages.MessageCreateParams]>;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    globalMockSecretsManagerSend.mockClear();

    mockAnthropicClient = {
      messages: {
        create: jest.fn(),
      },
    };
  });

  // --- Tests for when Anthropic client IS INJECTED ---
  describe('with injected Anthropic client', () => {
    beforeEach(() => {
      provider = new AnthropicModelProvider(MOCK_SECRET_ID, MOCK_AWS_REGION, mockAnthropicClient as any);
      provider.setProviderConfig({
        provider: 'anthropic',
        active: true,
        defaultModel: 'claude-3-haiku-20240307',
        models: {
          'claude-3-haiku-20240307': {
            contextSize: 200000,
            costs: { prompt: 0.25 / 1000000, completion: 1.25 / 1000000 },
          }
        },
        rateLimits: { rpm: 100, tpm: 40000 }
      } as any);
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
      mockAnthropicClient.messages.create.mockResolvedValue(mockApiResponse);

      const result = await provider.generateResponse(mockRequest);

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(1);
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
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
      expect(globalMockSecretsManagerSend).not.toHaveBeenCalled();
    });

    test('should handle API errors from injected client', async () => {
      const mockRequest: AIModelRequest = { prompt: 'Test error', context: mockContext };
      const apiError = new Anthropic.APIError(400, { error: { type: 'invalid_request_error', message: 'Mock Anthropic API Error' } }, 'Mock Anthropic API Error', undefined);
      mockAnthropicClient.messages.create.mockRejectedValue(apiError);

      const result = await provider.generateResponse(mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CAPABILITY'); // Or other appropriate code based on error mapping
        expect(result.detail).toContain('Mock Anthropic API Error');
      }
    });

    test('should still respect rate limits even with injected client', async () => {
      const testLimits = { rpm: 1, tpm: 10 };
      jest.spyOn(provider, 'getProviderLimits').mockReturnValue(testLimits);
      // @ts-expect-error - Accessing private member for test setup
      provider.tokenBucket.tokens = testLimits.tpm;
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
      expect(mockAnthropicClient.messages.create).not.toHaveBeenCalled();
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

      test('should handle empty conversationHistory (single prompt)', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'Current user prompt.',
          context: { ...mockContext, conversationHistory: [] },
          preferredModel: defaultModel
        };
        mockAnthropicClient.messages.create.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Response to current prompt.', citations: [] }],
        });

        await provider.generateResponse(mockRequest);

        expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
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
        mockAnthropicClient.messages.create.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Response to latest question.', citations: [] }],
        });
        
        await provider.generateResponse(mockRequest);

        expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
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
         mockAnthropicClient.messages.create.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Response to query with system prompt.', citations: [] }],
        });

        await provider.generateResponse(mockRequest);

        expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
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
        mockAnthropicClient.messages.create.mockResolvedValue({
          ...mockBaseApiResponse,
          content: [{ type: 'text', text: 'Final response.', citations: [] }],
        });

        await provider.generateResponse(mockRequest);

        expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
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
        mockAnthropicClient.messages.create.mockResolvedValue(mockAnthropicResponse);

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
      provider = new AnthropicModelProvider(MOCK_SECRET_ID, MOCK_AWS_REGION);
      provider.setProviderConfig({
        provider: 'anthropic',
        active: true,
        defaultModel: 'claude-3-haiku-20240307',
        models: {
          'claude-3-haiku-20240307': { contextSize: 200000, costs: { prompt: 0.25/1000000, completion: 1.25/1000000 }},
          'claude-3-opus-20240229': { contextSize: 200000, costs: { prompt: 15/1000000, completion: 75/1000000 }},
        },
        rateLimits: { rpm: 1000, tpm: 400000 }
      } as any);
    });

    test('should successfully fetch API keys and prepare to generate response', async () => {
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
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: 'not-a-json-string',
      } as GetSecretValueCommandOutput);

      const result = await provider.generateResponse({ prompt: 'Test malformed secret', context: mockContext });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toMatch(/\\[AnthropicModelProvider\\] Failed to initialize client or load API credentials: Failed to load API keys from Secrets Manager: Unexpected token.*/);
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
  });
}); 