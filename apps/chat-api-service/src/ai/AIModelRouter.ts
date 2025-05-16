import { 
  IAIModelProvider, 
  AIModelRequest, 
  AIModelResult,
  AIModelError,
  AiServiceConfiguration, 
  DEFAULT_ROUTING_WEIGHTS 
} from '@kinable/common-types';
import { CircuitBreakerManager } from './CircuitBreakerManager';
import { ConfigurationService } from './ConfigurationService';
import { OpenAIModelProvider } from './OpenAIModelProvider';
import { AnthropicModelProvider } from './AnthropicModelProvider';
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
  private routerStage: string;
  private circuitBreakerManager: CircuitBreakerManager;
  
  /**
   * Create a new AIModelRouter
   * @param configService An instance of ConfigurationService.
   * @param routerRegion The AWS region for AWS service clients initiated by the router itself.
   * @param routerStage The deployment stage (e.g., 'kinable-dev') for placeholder replacement.
   * @param initialProviders Optional initial providers.
   */
  constructor(
    configService: ConfigurationService,
    routerRegion: string,
    routerStage: string,
    initialProviders: Record<string, IAIModelProvider> = {}
  ) {
    this.configService = configService;
    this.routerAwsRegion = routerRegion;
    this.routerStage = routerStage;
    
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
  private async initializeOpenAI(appConfig: AiServiceConfiguration): Promise<OpenAIModelProvider> {
    if (!this.providers.has('openai')) {
      const openAIConfig = appConfig.providers.openai;

      if (!openAIConfig) {
        throw new Error("OpenAI provider configuration missing from ConfigurationService.");
      }

      const dbProvider = this.configService.getDBProvider();
      if (!dbProvider) {
        throw new Error("Database provider not available from ConfigurationService in AIModelRouter");
      }
      
      let secretId = openAIConfig.secretId;
      if (!secretId) {
        throw new Error("OpenAI provider secretId missing from configuration");
      }
      secretId = secretId.replace('{env}', this.routerStage).replace('{region}', this.routerAwsRegion);
      
      const defaultOpenAIModel = openAIConfig.defaultModel || appConfig.routing?.defaultModel || "gpt-3.5-turbo";
      const provider = new OpenAIModelProvider(
        secretId,
        this.routerAwsRegion,
        dbProvider, 
        defaultOpenAIModel,
        openAIConfig
      );
      this.providers.set('openai', provider);
    }
    return this.providers.get('openai') as OpenAIModelProvider;
  }

  /**
   * Initialize the Anthropic provider if it doesn't exist yet.
   * @param appConfig The application configuration containing provider details.
   */
  private async initializeAnthropic(appConfig: AiServiceConfiguration): Promise<AnthropicModelProvider> {
    if (!this.providers.has('anthropic')) {
      const anthropicConfig = appConfig.providers.anthropic;

      if (!anthropicConfig) {
        throw new Error("Anthropic provider configuration missing from ConfigurationService.");
      }

      const dbProvider = this.configService.getDBProvider();
      if (!dbProvider) {
        throw new Error("Database provider not available from ConfigurationService in AIModelRouter");
      }
      
      let secretId = anthropicConfig.secretId;
      if (!secretId) {
        throw new Error("Anthropic provider secretId missing from configuration");
      }
      secretId = secretId.replace('{env}', this.routerStage).replace('{region}', this.routerAwsRegion);
      
      const defaultAnthropicModel = anthropicConfig.defaultModel || appConfig.routing?.defaultModel || "claude-3-haiku-20240307";
      const provider = new AnthropicModelProvider(
        secretId,
        this.routerAwsRegion,
        dbProvider,
        defaultAnthropicModel,
        anthropicConfig
      );
      this.providers.set('anthropic', provider);
    }
    return this.providers.get('anthropic') as AnthropicModelProvider;
  }
  
  /**
   * Route a request to the appropriate provider
   */
  @tracer.captureMethod()
  public async routeRequest(request: AIModelRequest & { estimatedInputTokens?: number; estimatedOutputTokens?: number }): Promise<AIModelResult> {
    const providerCallRegion = this.routerAwsRegion;
    let triedProvidersInfo: Array<{ name: string; reason?: string }> = [];

    try {
      const config = await this.configService.getConfiguration();
      const { 
        estimatedInputTokens,
        estimatedOutputTokens,
        maxTokens: requestMaxTokens,
        prompt
      } = request;

      let candidateProviders: Array<{ 
        name: string; 
        provider: IAIModelProvider; // Added for direct access post-initialization
        modelName: string; 
        estimatedCost: number; 
        score: number; 
        healthKey: string;
      }> = [];

      // Use providerPreferenceOrder from config or fallback to a default if not available
      const providerOrder = config.routing?.providerPreferenceOrder || 
                          ['openai', 'anthropic'];  // Default fallback

      const initialProvidersToConsider = request.preferredProvider
        ? [{ name: request.preferredProvider, reason: 'request_preferred' }]
        : providerOrder.map((name: string) => ({ name, reason: 'preference_order' }));

      for (const { name: providerName } of initialProvidersToConsider) {
        if (triedProvidersInfo.some(p => p.name === providerName)) continue; // Already evaluated or tried

        const providerConfig = config.providers[providerName];
        if (!providerConfig || !providerConfig.active) {
          triedProvidersInfo.push({ name: providerName, reason: 'inactive_or_not_configured' });
          console.warn(`[AIModelRouter] Provider ${providerName} is not configured or not active. Skipping.`);
          continue;
        }

        const healthKey = `${providerName}#${providerCallRegion}`;
        if (!(await this.circuitBreakerManager.isRequestAllowed(healthKey))) {
          triedProvidersInfo.push({ name: providerName, reason: 'circuit_open' });
          console.warn(`[AIModelRouter] Circuit breaker OPEN for ${providerName} (${healthKey}). Skipping.`);
          continue;
        }

        // Ensure provider is initialized for capability checks and model info
        let providerInstance = this.providers.get(providerName);
        if (!providerInstance) {
          try {
            if (providerName === 'openai') providerInstance = await this.initializeOpenAI(config);
            else if (providerName === 'anthropic') providerInstance = await this.initializeAnthropic(config);
            else throw new Error(`Provider ${providerName} not configured for dynamic initialization.`);
          } catch (initError: any) {
            if (
              initError.message &&
              (initError.message.includes('provider configuration missing') ||
               initError.message.includes('not configured for dynamic initialization'))
            ) {
              console.error(`[AIModelRouter] Critical initialization error for provider ${providerName}: ${initError.message}. Re-throwing.`);
              throw initError;
            }
            triedProvidersInfo.push({ name: providerName, reason: `initialization_failed: ${initError.message}` });
            console.error(`[AIModelRouter] Failed to initialize provider ${providerName}: ${initError.message}`);
            await this.circuitBreakerManager.recordFailure(healthKey);
            continue;
          }
        }
        if (!providerInstance) { // Should not happen if init succeeded
            triedProvidersInfo.push({ name: providerName, reason: 'initialization_failed_no_instance' });
            console.error(`[AIModelRouter] Provider ${providerName} instance not available after init attempt.`);
            await this.circuitBreakerManager.recordFailure(healthKey);
            continue;
        }

        if (!(await providerInstance.canFulfill(request))) {
          triedProvidersInfo.push({ name: providerName, reason: 'cannot_fulfill' });
          console.warn(`[AIModelRouter] Provider ${providerName} cannot fulfill request capabilities. Skipping.`);
          continue;
        }

        const modelName = request.preferredModel && providerConfig.models[request.preferredModel]
          ? request.preferredModel
          : providerConfig.defaultModel;
        
        if (!modelName) {
            triedProvidersInfo.push({ name: providerName, reason: 'no_model_available' });
            console.warn(`[AIModelRouter] No suitable model found for provider ${providerName}. Skipping.`);
            continue;
        }
        const modelConfig = providerConfig.models[modelName];
        if (!modelConfig || !modelConfig.active) {
          triedProvidersInfo.push({ name: providerName, reason: `model_${modelName}_inactive_or_not_configured` });
          console.warn(`[AIModelRouter] Model ${modelName} for provider ${providerName} is not configured or not active. Skipping.`);
          continue;
        }

        // Cost Calculation (per 1M tokens)
        const estInput = estimatedInputTokens ?? Math.ceil(prompt.length / 4); // Simple heuristic
        const estOutput = estimatedOutputTokens ?? requestMaxTokens ?? 256; // Default to 256 if no other estimate
        
        // Access new cost fields and adjust calculation from per 1K to per 1M
        const inputCostPerMillion = modelConfig.costPerMillionInputTokens ?? 0.50; // Default, e.g. gpt-3.5-turbo
        const outputCostPerMillion = modelConfig.costPerMillionOutputTokens ?? 1.50; // Default, e.g. gpt-3.5-turbo
        
        const cost = ((estInput / 1000000) * inputCostPerMillion) + ((estOutput / 1000000) * outputCostPerMillion);

        // Scoring (simplified for now)
        // Lower cost is better, so invert for score contribution if not 0.
        const costScoreFactor = cost > 0 ? 1 / cost : 1; // Avoid division by zero, higher is better for score part
        const availabilityScoreFactor = 1; // Already passed circuit breaker
        // TODO: Incorporate real latency and quality scores later
        const latencyScoreFactor = 1; 
        const qualityScoreFactor = 1; 

        const routingWeights = config.routing?.weights || DEFAULT_ROUTING_WEIGHTS; // Use imported default
        const score =
          (costScoreFactor * routingWeights.cost) +
          (availabilityScoreFactor * routingWeights.availability) +
          (latencyScoreFactor * routingWeights.latency) +
          (qualityScoreFactor * routingWeights.quality);

        candidateProviders.push({
          name: providerName,
          provider: providerInstance, // Store initialized instance
          modelName,
          estimatedCost: cost,
          score,
          healthKey
        });
        triedProvidersInfo.push({ name: providerName, reason: 'added_to_candidates' });
      }

      if (candidateProviders.length === 0) {
        const reasons = triedProvidersInfo.map(p => `${p.name}(${p.reason || 'unknown'})`).join(', ');
        return this.createError(
          'TIMEOUT', // Or 'CAPABILITY' if all were capability issues
          `No suitable active provider available after filtering. Attempted/Considered: ${reasons || 'None'}`,
          503,
          true
        );
      }

      // Sort candidates by score (descending - higher score is better)
      candidateProviders.sort((a, b) => b.score - a.score);
      
      // Attempt providers in order of score
      for (const candidate of candidateProviders) {
        console.log(`[AIModelRouter] Attempting provider ${candidate.name} (Model: ${candidate.modelName}, Score: ${candidate.score.toFixed(4)}, Est. Cost: ${candidate.estimatedCost.toFixed(6)})`);
        const providerToUse = candidate.provider; // Use the stored initialized instance
        const currentProviderHealthKey = candidate.healthKey;

        // Request might need model explicitly set if not just using provider default
        const finalRequest = { ...request, preferredModel: candidate.modelName };

        const startTime = Date.now();
        let result: AIModelResult;
        let durationMs: number;

        try {
          result = await providerToUse.generateResponse(finalRequest);
          durationMs = Date.now() - startTime;
          if (result.ok) {
            await this.circuitBreakerManager.recordSuccess(currentProviderHealthKey, durationMs);
            console.log(`[AIModelRouter] Successfully routed to ${candidate.name} with model ${candidate.modelName}.`);
            return result; // Success, return immediately
          } else {
            if (result.retryable || result.code === 'UNKNOWN' || result.code === 'TIMEOUT') {
              await this.circuitBreakerManager.recordFailure(currentProviderHealthKey, durationMs);
            }
            console.warn(`[AIModelRouter] Provider ${candidate.name} (Model: ${candidate.modelName}) returned error: ${result.detail}. Code: ${result.code}`);
            // Update the reason in triedProvidersInfo for this specific failure
            const infoIndex = triedProvidersInfo.findIndex(info => info.name === candidate.name && info.reason === 'added_to_candidates');
            if (infoIndex !== -1) {
              triedProvidersInfo[infoIndex].reason = result.code.toLowerCase();
            }
          }
        } catch (error: any) {
          durationMs = Date.now() - startTime;
          console.error(`[AIModelRouter] Unhandled error during provider.generateResponse for ${candidate.name}#${providerCallRegion} (Model: ${candidate.modelName}):`, error);
          await this.circuitBreakerManager.recordFailure(currentProviderHealthKey, durationMs);
          // Continue to next candidate if available
        }
        // If we reach here, the attempt failed, try next candidate from sorted list
      }
      
      // If all candidates failed
      const finalTriedReasons = triedProvidersInfo.map(p => `${p.name}(${p.reason || 'unknown'})`).join(', ');
      return this.createError(
        'TIMEOUT',
        `All candidate providers failed to generate a response. Attempted/Considered: ${finalTriedReasons || 'None'}`,
        503,
        true
      );

    } catch (error: unknown) {
      if (error instanceof Error &&
          (error.message.includes('provider configuration missing') ||
           error.message.includes('not configured for dynamic initialization'))) {
        console.error(`[AIModelRouter] Outer catch: Re-throwing critical initialization error:`, error.message);
        throw error; // Re-throw these specific errors
      }
      console.error(`[AIModelRouter] Outer catch: Unhandled error during request routing:`, error);
      return this.createError(
        'UNKNOWN',
        `Critical error routing request: ${error instanceof Error ? error.message : String(error)}`,
        500,
        true // Defaulting to retryable true for unknown outer errors, can be debated
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