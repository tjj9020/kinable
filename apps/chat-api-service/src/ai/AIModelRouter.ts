import { 
  IAIModelProvider, 
  AIModelRequest, 
  AIModelResult,
  AIModelError
} from '../../../../packages/common-types/src/ai-interfaces';
import { ProviderConfiguration } from '../../../../packages/common-types/src/config-schema';
import { ConfigurationService } from './ConfigurationService';
import { OpenAIModelProvider } from './OpenAIModelProvider';
import { AnthropicModelProvider } from './AnthropicModelProvider';
import { CircuitBreakerManager } from './CircuitBreakerManager';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Tracer } from '@aws-lambda-powertools/tracer';

// TODO: Get this from environment variables like other table names
const DEFAULT_PROVIDER_HEALTH_TABLE_NAME = process.env.PROVIDER_HEALTH_TABLE || 'KinableProviderHealth-dev';

const tracer = new Tracer({ serviceName: 'AIModelRouter' });

/**
 * AIModelRouter selects the appropriate AI provider and model based on request requirements
 */
export class AIModelRouter {
  private providers: Map<string, IAIModelProvider> = new Map();
  private configService: ConfigurationService;
  private routerAwsRegion: string;
  private circuitBreakerManager: CircuitBreakerManager;
  
  /**
   * Create a new AIModelRouter
   * @param configService An instance of ConfigurationService.
   * @param routerRegion The AWS region for AWS service clients initiated by the router itself.
   * @param initialProviders Optional initial providers.
   */
  constructor(
    configService: ConfigurationService,
    routerRegion: string,
    initialProviders: Record<string, IAIModelProvider> = {}
  ) {
    this.configService = configService;
    this.routerAwsRegion = routerRegion;
    
    const ddbClient = new DynamoDBClient({ region: this.routerAwsRegion });
    const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

    const providerHealthTableNameToUse = process.env.PROVIDER_HEALTH_TABLE || DEFAULT_PROVIDER_HEALTH_TABLE_NAME;
    if (!providerHealthTableNameToUse) {
        throw new Error("PROVIDER_HEALTH_TABLE environment variable is not set.");
    }
    this.circuitBreakerManager = new CircuitBreakerManager(ddbDocClient, providerHealthTableNameToUse);
    
    Object.entries(initialProviders).forEach(([name, provider]) => {
      this.providers.set(name, provider);
    });
  }
  
  /**
   * Initialize the OpenAI provider if it doesn't exist yet.
   * @param appConfig The application configuration containing provider details.
   */
  private async initializeOpenAI(appConfig: ProviderConfiguration): Promise<OpenAIModelProvider> {
    if (!this.providers.has('openai')) {
      const openAIConfig = appConfig.providers.openai as any;

      if (!openAIConfig || !openAIConfig.secretId) {
        throw new Error("OpenAI provider configuration or secretId missing from ConfigurationService.");
      }

      const dbProvider = this.configService.getDBProvider();
      if (!dbProvider) {
        throw new Error("Database provider not available from ConfigurationService in AIModelRouter");
      }
      
      const defaultOpenAIModel = openAIConfig.defaultModel || "gpt-3.5-turbo";
      const provider = new OpenAIModelProvider(
        openAIConfig.secretId, 
        this.routerAwsRegion,
        dbProvider, 
        defaultOpenAIModel
      );
      this.providers.set('openai', provider);
    }
    return this.providers.get('openai') as OpenAIModelProvider;
  }

  /**
   * Initialize the Anthropic provider if it doesn't exist yet.
   * @param appConfig The application configuration containing provider details.
   */
  private async initializeAnthropic(appConfig: ProviderConfiguration): Promise<AnthropicModelProvider> {
    if (!this.providers.has('anthropic')) {
      const anthropicConfig = appConfig.providers.anthropic as any;

      if (!anthropicConfig || !anthropicConfig.secretId) {
        throw new Error("Anthropic provider configuration or secretId missing from ConfigurationService.");
      }

      const dbProvider = this.configService.getDBProvider();
      if (!dbProvider) {
        throw new Error("Database provider not available from ConfigurationService in AIModelRouter");
      }
      
      const defaultAnthropicModel = anthropicConfig.defaultModel || "claude-3-haiku-20240307"; // Example default
      const provider = new AnthropicModelProvider(
        anthropicConfig.secretId,
        this.routerAwsRegion,
        dbProvider,
        defaultAnthropicModel
      );
      this.providers.set('anthropic', provider);
    }
    return this.providers.get('anthropic') as AnthropicModelProvider;
  }
  
  /**
   * Route a request to the appropriate provider
   */
  @tracer.captureMethod()
  public async routeRequest(request: AIModelRequest): Promise<AIModelResult> {
    let chosenProviderName = ''; 
    const providerCallRegion = this.routerAwsRegion; 
    let currentProviderHealthKey = ''; // To store the health key of the final chosen provider

    try {
      const config = await this.configService.getConfiguration();
      let primaryChoiceProviderName = request.preferredProvider || config.routing.defaultProvider;
      chosenProviderName = primaryChoiceProviderName;
      currentProviderHealthKey = `${chosenProviderName}#${providerCallRegion}`;

      if (!(await this.circuitBreakerManager.isRequestAllowed(currentProviderHealthKey))) {
        console.warn(`[AIModelRouter] Circuit breaker OPEN for ${chosenProviderName} (${currentProviderHealthKey}).`);
        
        const fallbackProviderName = config.routing.defaultProvider === chosenProviderName 
                                      ? (chosenProviderName === 'openai' && config.providers.anthropic?.active ? 'anthropic' : (chosenProviderName === 'anthropic' && config.providers.openai?.active ? 'openai' : null)) 
                                      : (config.providers[config.routing.defaultProvider]?.active ? config.routing.defaultProvider : null);

        if (fallbackProviderName && fallbackProviderName !== chosenProviderName) {
          console.log(`[AIModelRouter] Attempting fallback to ${fallbackProviderName}`);
          const fallbackHealthKey = `${fallbackProviderName}#${providerCallRegion}`;
          if (await this.circuitBreakerManager.isRequestAllowed(fallbackHealthKey)) {
            chosenProviderName = fallbackProviderName;
            currentProviderHealthKey = fallbackHealthKey; // Update health key for the chosen fallback
            console.log(`[AIModelRouter] Fallback to ${chosenProviderName} is allowed by its circuit breaker.`);
          } else {
            console.warn(`[AIModelRouter] Fallback provider ${fallbackProviderName} circuit breaker also OPEN.`);
            return this.createError(
              'TIMEOUT', 
              `Primary provider ${primaryChoiceProviderName} and fallback provider ${fallbackProviderName} are temporarily unavailable (circuit open).`,
              503, 
              true 
            );
          }
        } else {
          return this.createError(
            'TIMEOUT', 
            `Provider ${primaryChoiceProviderName} in region ${providerCallRegion} is unavailable (circuit open), and no suitable active fallback found.`,
            503, 
            true 
          );
        }
      }
      
      // Dynamic provider initialization for the chosen (or fallback) provider
      if (!this.providers.has(chosenProviderName)) {
        if (chosenProviderName === 'openai') {
          await this.initializeOpenAI(config);
        } else if (chosenProviderName === 'anthropic') {
          await this.initializeAnthropic(config);
        } else {
          await this.circuitBreakerManager.recordFailure(currentProviderHealthKey); 
          return this.createError(
            'UNKNOWN',
            `Provider ${chosenProviderName} not configured for dynamic initialization.`,
            500,
            false
          );
        }
      }
      
      const provider = this.providers.get(chosenProviderName);
      
      if (!provider) {
        await this.circuitBreakerManager.recordFailure(currentProviderHealthKey);
        return this.createError(
          'UNKNOWN',
          `Provider ${chosenProviderName} not available after initialization attempt.`,
          500,
          false
        );
      }
      
      if (!(await provider.canFulfill(request))) {
        // For capability issues, we might also consider a fallback, but this simple version does not.
        // This could be a place for future enhancement if the primary choice can't fulfill.
        console.warn(`[AIModelRouter] Provider ${chosenProviderName} cannot fulfill request capabilities.`);
        return this.createError(
          'CAPABILITY',
          `Provider ${chosenProviderName} cannot fulfill the current request capabilities.`,
          400,
          false
        );
      }
      
      const startTime = Date.now(); 
      let result: AIModelResult;
      let durationMs: number;

      try {
        result = await provider.generateResponse(request);
        durationMs = Date.now() - startTime; 
        if (result.ok) {
          await this.circuitBreakerManager.recordSuccess(currentProviderHealthKey, durationMs);
        } else {
          if (result.retryable || result.code === 'UNKNOWN' || result.code === 'TIMEOUT') {
            await this.circuitBreakerManager.recordFailure(currentProviderHealthKey, durationMs);
          }
        }
      } catch (error: any) {
        durationMs = Date.now() - startTime; 
        console.error(`[AIModelRouter] Unhandled error during provider.generateResponse for ${chosenProviderName}#${providerCallRegion}:`, error);
        await this.circuitBreakerManager.recordFailure(currentProviderHealthKey, durationMs);
        throw error; 
      }
      return result;

    } catch (error: unknown) {
      console.error(`[AIModelRouter] Outer catch: Unhandled error during request routing for ${chosenProviderName}#${providerCallRegion}:`, error);
      if (chosenProviderName && providerCallRegion && currentProviderHealthKey) { // Ensure health key was determined
        // Avoid double-recording if possible, but record failure if one occurred before/during provider selection.
        await this.circuitBreakerManager.recordFailure(currentProviderHealthKey);
      }
      return this.createError(
        'UNKNOWN',
        `Critical error routing request: ${(error instanceof Error ? error.message : 'Unknown error' )}`,
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