import { OpenAIModelProvider } from './OpenAIModelProvider';
import { AIModelRequest } from '../../../../packages/common-types/src/ai-interfaces';
import { RequestContext, IDatabaseProvider } from '../../../../packages/common-types/src/core-interfaces';
import { GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import { OpenAI } from 'openai';
// Removed all jest.mock('openai', ...) and related MockOpenAI, MockAPIError definitions

// Mock @aws-sdk/client-secrets-manager - This remains relevant for testing key fetching
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
  region: 'us-east-2',
  traceId: 'test-trace-id',
};

const MOCK_SECRET_ID = 'test-openai-secret';
const MOCK_AWS_REGION = 'us-test-1';
const MOCK_DEFAULT_MODEL = 'gpt-3.5-turbo';

// Mock Database Provider
const mockDbProvider: IDatabaseProvider = {
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  query: jest.fn(),
  // ensureRegionalKeyPrefix: jest.fn(key => key), // REMOVED
  // isRegionPrefixed: jest.fn().mockReturnValue(false) // REMOVED
};

describe('OpenAIModelProvider', () => {
  let provider: OpenAIModelProvider;
  let mockOpenAIClient: {
    chat: {
      completions: {
        create: jest.Mock<Promise<any>, [any]>; // Adjust typing as per actual OpenAI SDK if more specific needed
      };
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    globalMockSecretsManagerSend.mockClear();

    // Create a fresh mock OpenAI client for each test
    mockOpenAIClient = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };
  });

  // --- Tests for when OpenAI client IS INJECTED ---
  describe('with injected OpenAI client', () => {
    beforeEach(() => {
      provider = new OpenAIModelProvider(MOCK_SECRET_ID, MOCK_AWS_REGION, mockDbProvider, MOCK_DEFAULT_MODEL, mockOpenAIClient as any);
      jest.spyOn(provider as any, '_getCircuitState').mockImplementation(async (...args: any[]) => {
        const region = args[0] as string;
        if (region === mockContext.region) { // us-east-2
          return { status: 'CLOSED', consecutiveFailures: 0, successesInHalfOpen: 0, lastStateChangeTimestamp: Date.now(), providerRegion: `openai#${mockContext.region}` };
        }
        return { status: 'CLOSED', consecutiveFailures: 0, successesInHalfOpen: 0, lastStateChangeTimestamp: Date.now(), providerRegion: `openai#${region}` };
      });
      jest.spyOn(provider as any, '_updateCircuitState').mockResolvedValue(undefined);
    });

    test('should use injected client to generate response', async () => {
      const mockRequest: AIModelRequest = { prompt: 'Hello', context: mockContext, preferredModel: 'gpt-3.5-turbo' };
      const mockApiResponse = {
        choices: [{ message: { content: 'Hi there!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        model: 'gpt-3.5-turbo',
      };
      mockOpenAIClient.chat.completions.create.mockResolvedValue(mockApiResponse);

      const result = await provider.generateResponse(mockRequest);

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledTimes(1);
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: undefined, // Assuming default behavior if not specified
        temperature: undefined,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe('Hi there!');
        expect(result.tokens?.total).toBe(10);
      }
      // SecretsManager should NOT be called if client is injected
      expect(globalMockSecretsManagerSend).not.toHaveBeenCalled();
    });

    test('should handle API errors from injected client', async () => {
      const mockRequest: AIModelRequest = { prompt: 'Hello', context: mockContext };
      const apiError = new OpenAI.APIError(401, { message: 'Mock OpenAI API Error', type: 'auth_error' }, 'Auth Error', {});
      mockOpenAIClient.chat.completions.create.mockRejectedValue(apiError);
      
      const result = await provider.generateResponse(mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toContain('Mock OpenAI API Error');
      }
    });
    
    test('should still respect rate limits even with injected client', async () => {
      const mockOpenAIClient = {
        chat: { completions: { create: jest.fn() } },
      } as unknown as OpenAI;

      const provider = new OpenAIModelProvider(
        'test-secret', 
        'test-region', 
        mockDbProvider,
        MOCK_DEFAULT_MODEL,
        mockOpenAIClient
      );
      
      const testLimits = { rpm: 1, tpm: 10 };
      jest.spyOn(provider, 'getProviderLimits').mockReturnValue(testLimits);

      // Manually adjust the token bucket to reflect the new low limits for the test
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
      expect(mockOpenAIClient.chat.completions.create).not.toHaveBeenCalled();
    });

    // --- NEW TESTS FOR CONVERSATION HISTORY ---
    describe('conversation history handling', () => {
      test('should handle empty conversationHistory correctly (single prompt)', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'Current user prompt.',
          context: { ...mockContext, conversationHistory: [] },
          preferredModel: 'gpt-3.5-turbo'
        };
        const mockApiResponse = {
          choices: [{ message: { content: 'Response to current prompt.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          model: 'gpt-3.5-turbo',
        };
        mockOpenAIClient.chat.completions.create.mockResolvedValue(mockApiResponse);

        await provider.generateResponse(mockRequest);

        expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [{ role: 'user', content: 'Current user prompt.' }],
          })
        );
      });

      test('should include user and assistant messages from conversationHistory', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'Latest user question.',
          context: {
            ...mockContext,
            conversationHistory: [
              { role: 'user', content: 'Previous user question.' },
              { role: 'assistant', content: 'Previous assistant answer.' },
            ],
          },
          preferredModel: 'gpt-3.5-turbo'
        };
        const mockApiResponse = {
          choices: [{ message: { content: 'Response to latest question.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
          model: 'gpt-3.5-turbo',
        };
        mockOpenAIClient.chat.completions.create.mockResolvedValue(mockApiResponse);

        await provider.generateResponse(mockRequest);

        expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              { role: 'user', content: 'Previous user question.' },
              { role: 'assistant', content: 'Previous assistant answer.' },
              { role: 'user', content: 'Latest user question.' },
            ],
          })
        );
      });

      test('should place system message from conversationHistory first', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'User query.',
          context: {
            ...mockContext,
            conversationHistory: [
              { role: 'user', content: 'Older user message.' },
              { role: 'system', content: 'System instruction.' },
              { role: 'assistant', content: 'Older assistant reply.' },
            ],
          },
          preferredModel: 'gpt-3.5-turbo'
        };
        const mockApiResponse = {
          choices: [{ message: { content: 'Response to query.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          model: 'gpt-3.5-turbo',
        };
        mockOpenAIClient.chat.completions.create.mockResolvedValue(mockApiResponse);

        await provider.generateResponse(mockRequest);

        expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              { role: 'system', content: 'System instruction.' },
              { role: 'user', content: 'Older user message.' },
              { role: 'assistant', content: 'Older assistant reply.' },
              { role: 'user', content: 'User query.' },
            ],
          })
        );
      });

      test('should handle mixed conversation history and only one system message', async () => {
        const mockRequest: AIModelRequest = {
          prompt: 'Final user prompt.',
          context: {
            ...mockContext,
            conversationHistory: [
              { role: 'system', content: 'Initial system prompt.' },
              { role: 'user', content: 'First user message.' },
              { role: 'assistant', content: 'First assistant response.' },
              { role: 'system', content: 'This system message should be ignored if one already processed.' },
              { role: 'user', content: 'Second user message.' },
            ],
          },
          preferredModel: 'gpt-3.5-turbo'
        };
         const mockApiResponse = {
          choices: [{ message: { content: 'Final response.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 25, completion_tokens: 5, total_tokens: 30 },
          model: 'gpt-3.5-turbo',
        };
        mockOpenAIClient.chat.completions.create.mockResolvedValue(mockApiResponse);
        
        await provider.generateResponse(mockRequest);

        expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              { role: 'system', content: 'Initial system prompt.' },
              { role: 'user', content: 'First user message.' },
              { role: 'assistant', content: 'First assistant response.' },
              // The second system message is filtered out by the implementation
              { role: 'user', content: 'Second user message.' },
              { role: 'user', content: 'Final user prompt.' },
            ],
          })
        );
      });
    });
    // --- END OF NEW TESTS ---

  });

  // --- Tests for when OpenAI client IS NOT INJECTED (fetches keys) ---
  describe('without injected OpenAI client (fetches keys)', () => {
    beforeEach(() => {
      provider = new OpenAIModelProvider(MOCK_SECRET_ID, MOCK_AWS_REGION, mockDbProvider, MOCK_DEFAULT_MODEL);
      globalMockSecretsManagerSend.mockReset();
      jest.spyOn(provider as any, '_getCircuitState').mockImplementation(async (...args: any[]) => {
        const region = args[0] as string;
        if (region === mockContext.region) { // us-east-2
          return { status: 'CLOSED', consecutiveFailures: 0, successesInHalfOpen: 0, lastStateChangeTimestamp: Date.now(), providerRegion: `openai#${mockContext.region}` };
        }
        return { status: 'CLOSED', consecutiveFailures: 0, successesInHalfOpen: 0, lastStateChangeTimestamp: Date.now(), providerRegion: `openai#${region}` };
      });
      jest.spyOn(provider as any, '_updateCircuitState').mockResolvedValue(undefined);
    });

    test('should fetch API keys and generate response', async () => {
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: '{"current":"test-api-key"}',
      } as GetSecretValueCommandOutput);

      const mockApiResponse = {
        choices: [{ message: { content: 'Success after key fetch!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: MOCK_DEFAULT_MODEL,
      };

      // Call _ensureApiKeysLoaded to trigger key fetching and client initialization
      await (provider as any)['_ensureApiKeysLoaded']();

      // Now that the internal client should be initialized, mock its create method
      if (!provider['openaiClient']) {
        throw new Error('Test setup error: openaiClient not initialized after _ensureApiKeysLoaded');
      }
      const internalCreateMock = jest.fn().mockResolvedValue(mockApiResponse);
      provider['openaiClient'].chat.completions.create = internalCreateMock;

      const mockRequest: AIModelRequest = { prompt: 'Hello', context: mockContext };
      const result = await provider.generateResponse(mockRequest);

      expect(globalMockSecretsManagerSend).toHaveBeenCalledTimes(1);
      expect(internalCreateMock).toHaveBeenCalledTimes(1); // Check if the mocked internal client method was called
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe('Success after key fetch!');
      }
    });

    test('should handle Secrets Manager error when fetching keys', async () => {
      globalMockSecretsManagerSend.mockRejectedValueOnce(new Error('Secrets Manager Error'));
      const mockRequest: AIModelRequest = { prompt: 'Error test', context: mockContext };
      const result = await provider.generateResponse(mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH'); // Changed from UNKNOWN, as key loading failure is an AUTH class error
        expect(result.detail).toMatch(/Failed to load API credentials: Failed to load API keys from Secrets Manager: Secrets Manager Error/);
      }
    });

    test('should handle malformed secret string from Secrets Manager', async () => {
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: 'not-a-valid-json',
      } as GetSecretValueCommandOutput);
      const mockRequest: AIModelRequest = { prompt: 'Malformed secret', context: mockContext };
      const result = await provider.generateResponse(mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH'); // Changed from UNKNOWN
        expect(result.detail).toMatch(/Failed to load API credentials: Failed to load API keys from Secrets Manager: Unexpected token 'o', "not-a-valid-json" is not valid JSON/i);
      }
    });

    test('should handle secret string without "current" key', async () => {
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: '{"previous":"old-key-only"}',
      } as GetSecretValueCommandOutput);
      const mockRequest: AIModelRequest = { prompt: 'Missing current key', context: mockContext };
      const result = await provider.generateResponse(mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH'); // Changed from UNKNOWN
        expect(result.detail).toMatch(/Failed to load API credentials: Failed to load API keys from Secrets Manager: Fetched secret does not contain a "current" API key/);
      }
    });
    
    test('should handle undefined SecretString from Secrets Manager', async () => {
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretBinary: Buffer.from("some data"), 
        $metadata: {} // Added to satisfy GetSecretValueCommandOutput type
      } as GetSecretValueCommandOutput);
      const mockRequest: AIModelRequest = { prompt: 'Undefined SecretString', context: mockContext };
      const result = await provider.generateResponse(mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('AUTH');
        expect(result.detail).toMatch(/Failed to load API credentials: Failed to load API keys from Secrets Manager: SecretString is empty or not found in Secrets Manager response./i);
      }
    });

    // Test for 'should retry with previous key...' is complex and was previously skipped.
    // Keeping it skipped or refactoring it requires deeper OpenAI SDK client mocking strategy.
    test.skip('should retry with previous key if current key fails and previous key exists (COMPLEX TEST - SKIPPED)', async () => {
      // This test is more involved as it requires:
      // 1. Mocking SecretsManager to return current and previous keys.
      // 2. Mocking the first OpenAI API call (with current key) to fail with an auth error.
      // 3. Mocking the second OpenAI API call (with previous key) to succeed.
      // This requires a more sophisticated mock of the internally created OpenAI client.
      console.warn("Skipping test 'should retry with previous key...' as it's too complex without module-level OpenAI SDK mocking.");
    });
  });

  // Other tests from the original file (e.g., canFulfill, estimateTokens, getModelCapabilities)
  // These typically don't involve the OpenAI client instance directly, or use it in simple ways.
  describe('general provider methods', () => {
    beforeEach(() => {
      provider = new OpenAIModelProvider(MOCK_SECRET_ID, MOCK_AWS_REGION, mockDbProvider, MOCK_DEFAULT_MODEL, mockOpenAIClient as any);
      globalMockSecretsManagerSend.mockReset(); // Add reset here too for consistency if canFulfill invokes key loading
      jest.spyOn(provider as any, '_getCircuitState').mockImplementation(async (...args: any[]) => {
        const region = args[0] as string;
        if (region === mockContext.region) { // us-east-2
          return { status: 'CLOSED', consecutiveFailures: 0, successesInHalfOpen: 0, lastStateChangeTimestamp: Date.now(), providerRegion: `openai#${mockContext.region}` };
        }
        return { status: 'CLOSED', consecutiveFailures: 0, successesInHalfOpen: 0, lastStateChangeTimestamp: Date.now(), providerRegion: `openai#${region}` };
      });
      jest.spyOn(provider as any, '_updateCircuitState').mockResolvedValue(undefined);
    });

    test('canFulfill should return true for valid model and no specific capabilities', async () => {
      const request: AIModelRequest = { context: mockContext, prompt: '', preferredModel: 'gpt-3.5-turbo' };
      // Ensure API keys are loaded successfully for this test if provider tries to load them
      globalMockSecretsManagerSend.mockResolvedValueOnce({
        SecretString: '{"current":"test-api-key"}',
      } as GetSecretValueCommandOutput);
      expect(await provider.canFulfill(request)).toBe(true);
    });

    test('canFulfill should return false for unsupported model', async () => {
      const request: AIModelRequest = { context: mockContext, prompt: '', preferredModel: 'unsupported-model' };
      // Ensure API keys are loaded successfully for this test if provider tries to load them
      // globalMockSecretsManagerSend.mockResolvedValueOnce({
      //   SecretString: '{"current":"test-api-key"}',
      // } as GetSecretValueCommandOutput);
      const capabilities = provider.getModelCapabilities(request.preferredModel || '');
      // --- DEBUG LOG ---
      console.log('[TEST DEBUG] OpenAIModelProvider.test.ts - canFulfill - capabilities for unsupported-model:', capabilities);
      // --- END DEBUG LOG ---
      expect(await provider.canFulfill(request)).toBe(false);
    });

    test('getModelCapabilities should return defined capabilities for known models', () => {
      const capsGpt35 = provider.getModelCapabilities('gpt-3.5-turbo');
      expect(capsGpt35).toBeDefined();
      expect(capsGpt35.contextSize).toBeGreaterThan(0);

      const capsGpt4 = provider.getModelCapabilities('gpt-4');
      expect(capsGpt4).toBeDefined();
      expect(capsGpt4.contextSize).toBeGreaterThan(0);
    });
  });
}); 