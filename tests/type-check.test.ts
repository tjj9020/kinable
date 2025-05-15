import { 
  IAIModelProvider,
  AIModelRequest,
  ModelCapabilities,
  AIModelResult,
  ProviderHealthStatus
} from '../packages/common-types/src/ai-interfaces';

// Define a mock provider implementation
class MockProvider implements IAIModelProvider {
  async generateResponse(request: AIModelRequest): Promise<AIModelResult> {
    return {
      ok: true,
      text: "Mock response",
      tokens: { prompt: 10, completion: 5, total: 15 },
      meta: {
        provider: "mock",
        model: "mock-model",
        features: [],
        region: "us-east-1",
        latency: 100,
        timestamp: Date.now()
      }
    };
  }

  async canFulfill(request: AIModelRequest): Promise<boolean> {
    return true;
  }

  getModelCapabilities(modelName: string): ModelCapabilities {
    return {
      reasoning: 3,
      creativity: 3,
      coding: 3,
      retrieval: false,
      functionCalling: true,
      contextSize: 4096,
      streamingSupport: true,
      vision: true, // This was formerly optional, now required
      inputCost: 0.001,
      outputCost: 0.002
    };
  }

  async getProviderHealth(): Promise<ProviderHealthStatus> {
    return {
      available: true,
      errorRate: 0,
      latencyP95: 100,
      lastChecked: Date.now()
    };
  }

  getProviderLimits() {
    return {
      rpm: 100,
      tpm: 100000
    };
  }
}

describe('TypeScript Interface Tests', () => {
  it('should implement AIModelProvider correctly with our fixes', () => {
    const provider = new MockProvider();
    // This test will fail at compile time if our interfaces aren't right
    expect(provider).toBeDefined();
    
    // Test that getModelCapabilities returns a complete object with vision property
    const capabilities = provider.getModelCapabilities('test-model');
    expect(capabilities.vision).toBeDefined();
    expect(capabilities.inputCost).toBeDefined();
    expect(capabilities.outputCost).toBeDefined();
  });
}); 