import { 
  IAIModelProvider, 
  AIModelRequest, 
  AIModelResult,
  AIModelError
} from '../../../../packages/common-types/src/ai-interfaces';
import { ConfigurationService } from './ConfigurationService';
import { OpenAIModelProvider } from './OpenAIModelProvider';
import { CircuitBreakerManager } from './CircuitBreakerManager';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Tracer } from '@aws-lambda-powertools/tracer';

// TODO: Get this from environment variables like other table names
const DEFAULT_PROVIDER_HEALTH_TABLE_NAME = process.env.PROVIDER_HEALTH_TABLE || 'KinableProviderHealth-dev';

const tracer = new Tracer({ serviceName: 'AIModelRouter' });

/**
 * AIModelRouter selects the appropriate AI provider and model based on request requirements
 * This initial version is focused on a single provider
 */
export class AIModelRouter {
  private providers: Map<string, IAIModelProvider> = new Map();
  private configService: ConfigurationService;
  private openAISecretId: string;
  private routerAwsRegion: string;
  private circuitBreakerManager: CircuitBreakerManager;
  
  /**
   * Create a new AIModelRouter
   * @param configService An instance of ConfigurationService.
   * @param openAISecretId The AWS Secrets Manager secret ID for the OpenAI API key.
   * @param routerRegion The AWS region for AWS service clients initiated by the router itself.
   * @param initialProviders Optional initial providers.
   */
  constructor(
    configService: ConfigurationService,
    openAISecretId: string,
    routerRegion: string,
    initialProviders: Record<string, IAIModelProvider> = {}
  ) {
    this.configService = configService;
    this.openAISecretId = openAISecretId;
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
   * Uses secretId and region provided in the constructor.
   */
  private async initializeOpenAI(): Promise<OpenAIModelProvider> {
    if (!this.providers.has('openai')) {
      const dbProvider = this.configService.getDBProvider();
      if (!dbProvider) {
        throw new Error("Database provider not available from ConfigurationService in AIModelRouter");
      }
      const defaultOpenAIModel = "gpt-3.5-turbo";
      const provider = new OpenAIModelProvider(
        this.openAISecretId, 
        this.routerAwsRegion,
        dbProvider, 
        defaultOpenAIModel
      );
      this.providers.set('openai', provider);
    }
    return this.providers.get('openai') as OpenAIModelProvider;
  }
  
  /**
   * Route a request to the appropriate provider
   * This initial version is focused on a single provider (OpenAI)
   */
  @tracer.captureMethod()
  public async routeRequest(request: AIModelRequest): Promise<AIModelResult> {
    let chosenProviderName = ''; 
    const providerCallRegion = this.routerAwsRegion;

    try {
      const config = await this.configService.getConfiguration();
      chosenProviderName = request.preferredProvider || config.routing.defaultProvider;
      
      if (chosenProviderName !== 'openai') { 
        console.warn(`[AIModelRouter] Routing to non-OpenAI provider (${chosenProviderName}) is not fully implemented. Defaulting to OpenAI if available.`);
        chosenProviderName = 'openai'; 
      }

      const providerHealthKey = `${chosenProviderName}#${providerCallRegion}`;

      if (!(await this.circuitBreakerManager.isRequestAllowed(providerHealthKey))) {
        console.log(`[AIModelRouter] Circuit breaker OPEN for ${providerHealthKey}. Request blocked.`);
        return this.createError(
          'TIMEOUT', 
          `Provider ${chosenProviderName} in region ${providerCallRegion} is temporarily unavailable. Please try again later.`,
          503, 
          true 
        );
      }
      
      if (chosenProviderName === 'openai' && !this.providers.has('openai')) {
        await this.initializeOpenAI();
      }
      
      const provider = this.providers.get(chosenProviderName);
      
      if (!provider) {
        await this.circuitBreakerManager.recordFailure(providerHealthKey);
        return this.createError(
          'UNKNOWN',
          `Provider ${chosenProviderName} not configured or available`,
          500,
          false
        );
      }
      
      if (!(await provider.canFulfill(request))) {
        return this.createError(
          'CAPABILITY',
          `Provider ${chosenProviderName} cannot fulfill the current request capabilities.`,
          400,
          false
        );
      }
      
      const result = await provider.generateResponse(request);

      if (result.ok) {
        await this.circuitBreakerManager.recordSuccess(providerHealthKey);
      } else {
        if (result.retryable || result.code === 'UNKNOWN' || result.code === 'TIMEOUT') {
          await this.circuitBreakerManager.recordFailure(providerHealthKey);
        }
      }
      return result;

    } catch (error: unknown) {
      console.error(`[AIModelRouter] Unhandled error during request routing for ${chosenProviderName}#${providerCallRegion}:`, error);
      if (chosenProviderName && providerCallRegion) {
        await this.circuitBreakerManager.recordFailure(`${chosenProviderName}#${providerCallRegion}`);
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