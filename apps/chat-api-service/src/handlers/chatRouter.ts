import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { IApiResponse, RequestContext } from '../../../../packages/common-types/src/core-interfaces';
import { AIModelRequest } from '../../../../packages/common-types/src/ai-interfaces';
import { AIModelRouter } from '../ai/AIModelRouter';
import { DynamoDBProvider } from '../data/DynamoDBProvider';
import { ConfigurationService } from '../ai/ConfigurationService';

// Environment variables - use names exactly as defined in sam.yaml
const PROVIDER_CONFIG_TABLE_ENV = process.env.PROVIDER_CONFIG_TABLE_NAME;
const ACTIVE_CONFIG_ID_ENV = process.env.ACTIVE_CONFIG_ID;
const OPENAI_API_KEY_SECRET_ENV = process.env.OPENAI_API_KEY_SECRET_ID;
const SERVICE_REGION_ENV = process.env.AWS_REGION || 'us-east-2'; // Default if not set by Lambda environment

// Initialize clients and services once per Lambda cold start if possible
// For simplicity in this example, they are initialized per invocation, but can be moved outside handler
let dbProvider: DynamoDBProvider;
let configService: ConfigurationService;
let router: AIModelRouter;

/**
 * Main handler for the chat endpoint
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('ChatRouter handler invoked');
  
  // Note: Environment variable checks and service initialization are moved 
  // to after basic request validation to prevent unnecessary instantiation 
  // if the request is invalid early on.
  
  try {
    // Parse request body
    if (!event.body) {
      return createErrorResponse(400, 'Request body is required');
    }
    
    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return createErrorResponse(400, 'Invalid JSON in request body');
    }
    
    // Validate required fields
    if (!requestBody.prompt) {
      return createErrorResponse(400, 'Prompt is required');
    }

    // --- Dependency Initialization --- 
    // Check for required environment variables for AI services
    if (!PROVIDER_CONFIG_TABLE_ENV || !ACTIVE_CONFIG_ID_ENV || !OPENAI_API_KEY_SECRET_ENV) {
      console.error('Missing required environment variables for AI services configuration. Check PROVIDER_CONFIG_TABLE_NAME, ACTIVE_CONFIG_ID, OPENAI_API_KEY_SECRET_ID.');
      return createErrorResponse(500, 'Internal server configuration error', 'CONFIG_ERROR');
    }

    // Initialize provider and services if not already initialized (for Lambda cold starts)
    if (!dbProvider) { 
      dbProvider = new DynamoDBProvider(SERVICE_REGION_ENV);
    }
    if (!configService) { 
      configService = new ConfigurationService(
        dbProvider,
        PROVIDER_CONFIG_TABLE_ENV,
        SERVICE_REGION_ENV,
        ACTIVE_CONFIG_ID_ENV
      );
    }
    if (!router) { 
      router = new AIModelRouter(
        configService,
        SERVICE_REGION_ENV
      );
    }
    // --- End Dependency Initialization ---
    
    // Extract context from authorizer
    const authContext = event.requestContext.authorizer || {};
    
    // Create request context
    const requestContext: RequestContext = {
      requestId: event.requestContext.requestId || '',
      jwtSub: authContext.sub || '',
      familyId: authContext.familyId || '',
      profileId: authContext.profileId || '',
      region: process.env.AWS_REGION || 'us-east-2',
      traceId: event.headers['X-Amzn-Trace-Id'] || event.requestContext.requestId || ''
    };
    
    // Create model request
    const modelRequest: AIModelRequest = {
      prompt: requestBody.prompt,
      conversationId: requestBody.conversationId,
      preferredProvider: requestBody.provider,
      preferredModel: requestBody.model,
      maxTokens: requestBody.maxTokens || 500,
      temperature: requestBody.temperature || 0.7,
      streaming: requestBody.streaming || false,
      requiredCapabilities: requestBody.capabilities || [],
      context: requestContext
    };
    
    // Route the request
    const result = await router.routeRequest(modelRequest);
    
    if (result.ok) {
      // Success response
      return createSuccessResponse(200, {
        text: result.text,
        tokenUsage: result.tokens,
        model: result.meta.model,
        provider: result.meta.provider
      });
    } else {
      // Error response
      const statusCode = result.status || 500;
      return createErrorResponse(
        statusCode,
        result.detail || 'Error generating response',
        result.code
      );
    }
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return createErrorResponse(
      500,
      'An unexpected error occurred',
      'INTERNAL_ERROR',
      { message: error.message }
    );
  }
};

/**
 * Create a success response
 */
function createSuccessResponse<T>(
  statusCode: number,
  data: T
): APIGatewayProxyResult {
  const response: IApiResponse<T> = {
    success: true,
    statusCode,
    data
  };
  
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // For CORS
      'Access-Control-Allow-Credentials': 'true'
    },
    body: JSON.stringify(response)
  };
}

/**
 * Create an error response
 */
function createErrorResponse(
  statusCode: number,
  message: string,
  code: string = 'BAD_REQUEST',
  details?: any
): APIGatewayProxyResult {
  const response: IApiResponse = {
    success: false,
    statusCode,
    message,
    error: {
      code,
      details
    }
  };
  
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // For CORS
      'Access-Control-Allow-Credentials': 'true'
    },
    body: JSON.stringify(response)
  };
} 