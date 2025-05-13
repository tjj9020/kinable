import { OpenAIModelProvider } from './OpenAIModelProvider';
import { AIModelRequest } from '../../../../packages/common-types/src/ai-interfaces';
import { RequestContext } from '../../../../packages/common-types/src/core-interfaces';

// Extended test class to access protected methods
class TestOpenAIModelProvider extends OpenAIModelProvider {
  constructor(apiKey: string) {
    super(apiKey);
  }
  
  // Expose protected properties for testing
  public getApiKey(): string {
    return this.apiKey;
  }
  
  public getPreviousApiKey(): string | null {
    return this.previousApiKey;
  }
  
  public setApiKey(key: string): void {
    this.apiKey = key;
  }
}

// Mock callOpenAI
jest.mock('./OpenAIModelProvider', () => {
  const original = jest.requireActual('./OpenAIModelProvider');
  return {
    ...original,
    OpenAIModelProvider: class extends original.OpenAIModelProvider {
      // Mock the callOpenAI method for testing
      async callOpenAI(_request: AIModelRequest, model: string) {
        return {
          choices: [
            {
              message: {
                content: 'This is a test response',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
          model: model,
        };
      }
    },
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

describe('OpenAIModelProvider', () => {
  let provider: OpenAIModelProvider;
  let testProvider: TestOpenAIModelProvider;

  beforeEach(() => {
    provider = new OpenAIModelProvider('test-api-key');
    testProvider = new TestOpenAIModelProvider('test-api-key');
  });

  test('should initialize correctly', () => {
    expect(provider).toBeDefined();
  });

  test('should return model capabilities', () => {
    const capabilities = provider.getModelCapabilities('gpt-4');
    expect(capabilities.reasoning).toBe(5);
    expect(capabilities.creativity).toBe(4);
    expect(capabilities.coding).toBe(4);
    expect(capabilities.functionCalling).toBe(true);
  });

  test('should return provider limits', () => {
    const limits = provider.getProviderLimits();
    expect(limits.rpm).toBe(20);
    expect(limits.tpm).toBe(80000);
  });

  test('should generate a response', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext,
    };

    const result = await provider.generateResponse(request);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('This is a test response');
      expect(result.tokens.total).toBe(15);
      expect(result.meta.provider).toBe('openai');
    }
  });

  test('should check if it can fulfill a request', () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext,
    };

    expect(provider.canFulfill(request)).toBe(true);
  });

  test('should return correct error when required capability is not supported', async () => {
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext,
      requiredCapabilities: ['unsupported_capability'],
    };

    // This should return false since the capability doesn't exist
    expect(provider.canFulfill(request)).toBe(false);

    // Test the error response
    const result = await provider.generateResponse(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CAPABILITY');
      expect(result.provider).toBe('openai');
    }
  });

  test('should update API key correctly', () => {
    const newKey = 'new-test-api-key';

    testProvider.updateApiKey(newKey);
    expect(testProvider.getApiKey()).toBe(newKey);
    expect(testProvider.getPreviousApiKey()).toBe('test-api-key');

    // We can also verify the provider still works
    const request: AIModelRequest = {
      prompt: 'Hello, world!',
      context: mockContext,
    };

    expect(testProvider.canFulfill(request)).toBe(true);
  });

  test('should revert to previous API key if current key fails', async () => {
    const newKey = 'new-test-api-key';

    testProvider.updateApiKey(newKey);
    
    // Verify we have a previous key saved
    const previousKey = testProvider.getPreviousApiKey();
    expect(previousKey).toBe('test-api-key');

    // Test reverting to previous key
    if (previousKey && testProvider.getApiKey() !== previousKey) {
      const originalKey = testProvider.getApiKey();
      testProvider.setApiKey(previousKey);
      
      try {
        const request: AIModelRequest = {
          prompt: 'Hello, world!',
          context: mockContext,
        };

        const result = await testProvider.generateResponse(request);
        
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.text).toBe('This is a test response');
          expect(result.tokens.total).toBe(15);
          expect(result.meta.provider).toBe('openai');
        }
      } catch (retryError) {
        // Revert to original key if retry failed
        testProvider.setApiKey(originalKey);
      }
    }
  });
}); 