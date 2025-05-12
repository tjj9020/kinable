import { 
  IAIModelProvider, 
  AIModelRequest, 
  AIModelResult,
  AIModelError
} from '../../../../packages/common-types/src/ai-interfaces';
import { ConfigurationService } from './ConfigurationService';
import { OpenAIModelProvider } from './OpenAIModelProvider';

/**
 * AIModelRouter selects the appropriate AI provider and model based on request requirements
 * This initial version is focused on a single provider
 */
export class AIModelRouter {
  private providers: Map<string, IAIModelProvider> = new Map();
  private configService: ConfigurationService;
  
  /**
   * Create a new AIModelRouter
   * In production, providers would be initialized lazily with keys from Secrets Manager
   */
  constructor(
    configService = ConfigurationService.getInstance(),
    initialProviders: Record<string, IAIModelProvider> = {}
  ) {
    this.configService = configService;
    
    // Add any initial providers
    Object.entries(initialProviders).forEach(([name, provider]) => {
      this.providers.set(name, provider);
    });
  }
  
  /**
   * Initialize the OpenAI provider if it doesn't exist yet
   * In production, this would fetch the key from Secrets Manager
   */
  private async initializeOpenAI(): Promise<OpenAIModelProvider> {
    if (!this.providers.has('openai')) {
      // In production, get the key from Secrets Manager
      // For now, use a placeholder key
      const mockApiKey = 'sk-mock-key-12345';
      const provider = new OpenAIModelProvider(mockApiKey);
      this.providers.set('openai', provider);
    }
    
    return this.providers.get('openai') as OpenAIModelProvider;
  }
  
  /**
   * Route a request to the appropriate provider
   * This initial version is focused on a single provider (OpenAI)
   */
  public async routeRequest(request: AIModelRequest): Promise<AIModelResult> {
    try {
      // Get the current configuration
      const config = await this.configService.getConfiguration();
      
      // Determine which provider to use
      let providerName = request.preferredProvider;
      
      // If no preferred provider, use the default
      if (!providerName) {
        providerName = config.routing.defaultProvider;
      }
      
      // In a more complex implementation, we would apply routing rules here
      // For now, we just use OpenAI
      if (providerName !== 'openai') {
        providerName = 'openai';
      }
      
      // Initialize the provider if needed
      if (providerName === 'openai' && !this.providers.has('openai')) {
        await this.initializeOpenAI();
      }
      
      // Get the provider
      const provider = this.providers.get(providerName);
      
      if (!provider) {
        return this.createError(
          'UNKNOWN',
          `Provider ${providerName} not available`,
          500,
          false
        );
      }
      
      // Check if the provider can fulfill the request
      if (!provider.canFulfill(request)) {
        return this.createError(
          'CAPABILITY',
          `Provider ${providerName} cannot fulfill the request`,
          400,
          false
        );
      }
      
      // Send the request to the provider
      return await provider.generateResponse(request);
    } catch (error: unknown) {
      return this.createError(
        'UNKNOWN',
        `Error routing request: ${(error instanceof Error ? error.message : 'Unknown error' )}`,
        500,
        true
      );
    }
  }
  
  /**
   * Create a standard error response
   */
  private createError(
    code: AIModelError['code'],
    detail?: string,
    status?: number,
    retryable = true
  ): AIModelError {
    return {
      ok: false,
      code,
      provider: 'router',
      detail,
      status,
      retryable
    };
  }
  
  /**
   * Add or update a provider
   */
  public addProvider(name: string, provider: IAIModelProvider): void {
    this.providers.set(name, provider);
  }
  
  /**
   * Get a provider by name
   */
  public getProvider(name: string): IAIModelProvider | undefined {
    return this.providers.get(name);
  }
  
  /**
   * Clear all providers
   */
  public clearProviders(): void {
    this.providers.clear();
  }
} 