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
      const openAIConfig = appConfig.providers.openai;

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
      const anthropicConfig = appConfig.providers.anthropic;

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
    let chosenProviderName: string | null = null;
    const providerCallRegion = this.routerAwsRegion; 
    let currentProviderHealthKey = ''; 
    let triedProviders: string[] = [];

    try {
      const config = await this.configService.getConfiguration();
      const preferredProviderFromRequest = request.preferredProvider;

      // Attempt preferred provider first if specified
      if (preferredProviderFromRequest) {
        triedProviders.push(preferredProviderFromRequest);
        const providerConfig = config.providers[preferredProviderFromRequest];
        if (providerConfig && providerConfig.active) {
          currentProviderHealthKey = `${preferredProviderFromRequest}#${providerCallRegion}`;
          if (await this.circuitBreakerManager.isRequestAllowed(currentProviderHealthKey)) {
            chosenProviderName = preferredProviderFromRequest;
            console.log(`[AIModelRouter] Preferred provider ${chosenProviderName} selected. Circuit breaker is closed.`);
          } else {
            console.warn(`[AIModelRouter] Circuit breaker OPEN for preferred provider ${preferredProviderFromRequest} (${currentProviderHealthKey}). Attempting fallback.`);
          }
        } else {
          console.warn(`[AIModelRouter] Preferred provider ${preferredProviderFromRequest} is not configured or not active. Attempting fallback.`);
        }
      }

      // If no provider chosen yet (either no preferred, or preferred failed), try preference order
      if (!chosenProviderName) {
        const preferenceOrder = config.routing.providerPreferenceOrder;
        if (!preferenceOrder || preferenceOrder.length === 0) {
          if (!preferredProviderFromRequest) { // Only error if no preferred was even specified
            return this.createError(
              'UNKNOWN',
              'No provider preference order configured and no preferred provider in request.',
              500,
              false
            );
          }
          // If preferredProviderFromRequest failed, and preferenceOrder is empty, we'll hit the final error below.
        } else {
          for (const providerNameFromOrder of preferenceOrder) {
            if (providerNameFromOrder === preferredProviderFromRequest) {
              // Already tried (and failed) this provider if it was the preferred one
              continue; 
            }
            triedProviders.push(providerNameFromOrder);
            const providerConfig = config.providers[providerNameFromOrder];
            if (!providerConfig || !providerConfig.active) {
              console.warn(`[AIModelRouter] Provider ${providerNameFromOrder} from preference order is not configured or not active. Skipping.`);
              continue;
            }

            currentProviderHealthKey = `${providerNameFromOrder}#${providerCallRegion}`;
            if (await this.circuitBreakerManager.isRequestAllowed(currentProviderHealthKey)) {
              chosenProviderName = providerNameFromOrder;
              console.log(`[AIModelRouter] Fallback provider ${chosenProviderName} selected from preference order. Circuit breaker is closed.`);
              break; 
            } else {
              console.warn(`[AIModelRouter] Circuit breaker OPEN for ${providerNameFromOrder} (${currentProviderHealthKey}) from preference order. Trying next.`);
            }
          }
        }
      }

      if (!chosenProviderName) {
        return this.createError(
          'TIMEOUT', 
          `All attempted providers are temporarily unavailable (circuit open or inactive). Tried: ${[...new Set(triedProviders)].join(', ')}.`,
          503, 
          true 
        );
      }
      
      // Dynamic provider initialization for the chosen provider
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