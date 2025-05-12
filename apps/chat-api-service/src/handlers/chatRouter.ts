import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { IApiResponse, RequestContext } from '../../../../packages/common-types/src/core-interfaces';
import { AIModelRequest } from '../../../../packages/common-types/src/ai-interfaces';
import { AIModelRouter } from '../ai/AIModelRouter';

/**
 * Main handler for the chat endpoint
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('ChatRouter handler invoked');
  
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
    
    // Get router instance
    const router = new AIModelRouter();
    
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