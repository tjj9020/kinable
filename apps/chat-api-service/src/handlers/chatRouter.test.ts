// import { ConfigurationService } from '../ai/ConfigurationService'; // Removed
// import { DynamoDBProvider } from '../data/DynamoDBProvider'; // Removed
import { handler as _chatRouterHandler } from './chatRouter'; // Prefixed as it IS used.
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AIModelResult } from '../../../../packages/common-types/src/ai-interfaces';

// Mock AIModelRouter - This mock will be active for dynamic imports after jest.resetModules()
jest.mock('../ai/AIModelRouter', () => {
  return {
    AIModelRouter: jest.fn().mockImplementation(() => {
      return {
        routeRequest: jest.fn() // Default instance mock
      };
    })
  };
});

/**
 * Helper function to create a mock API Gateway event
 */
const createMockEvent = (body: Record<string, any> = {}, authorizer: Record<string, any> | null = {}): APIGatewayProxyEvent => {
  return {
    body: JSON.stringify(body),
    requestContext: {
      requestId: 'test-request-id',
      authorizer
    },
    headers: {
      'X-Amzn-Trace-Id': 'test-trace-id'
    },
    // All other required properties not used in tests
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    resource: '/chat',
    path: '/chat',
    httpMethod: 'POST',
    isBase64Encoded: false
  } as unknown as APIGatewayProxyEvent; // Cast through unknown to avoid TypeScript errors
};

describe('ChatRouter Handler', () => {
  let mockEvent: APIGatewayProxyEvent;
  let mockRouteRequest: jest.Mock;
  // Define handler type. It will be dynamically imported.
  let handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>; 
  let ActualMockedAIModelRouterConstructor: jest.Mock; // To store the dynamically imported mock constructor

  beforeEach(async () => {
    // Set environment variables *before* resetting and importing modules
    process.env.AWS_REGION = 'us-east-2'; // Used as SERVICE_REGION_ENV
    process.env.PROVIDER_CONFIG_TABLE_NAME = 'test-provider-config-table'; // Changed from PROVIDER_CONFIG_TABLE
    process.env.ACTIVE_CONFIG_ID = 'test-active-config-id'; // This one was correct
    process.env.OPENAI_API_KEY_SECRET_ID = 'test-openai-secret-id'; // Changed from OPENAI_API_KEY_SECRET

    // Reset modules to ensure chatRouter is loaded with the above env vars
    // and that it picks up a fresh version of the AIModelRouter mock.
    jest.resetModules();

    // Dynamically import the handler *after* env vars are set and modules reset
    const chatRouterModule = await import('./chatRouter');
    handler = chatRouterModule.handler;

    // Dynamically import the AIModelRouter mock. This is the constructor that the handler will use.
    const { AIModelRouter: DynamicallyImportedMockRouter } = await import('../ai/AIModelRouter');
    ActualMockedAIModelRouterConstructor = DynamicallyImportedMockRouter as jest.Mock;
    
    // Clear any previous calls on mocks from other tests.
    // This specifically clears calls on ActualMockedAIModelRouterConstructor and its instances.
    jest.clearAllMocks(); 

    // Prepare the mock for routeRequest for instances created by ActualMockedAIModelRouterConstructor
    mockRouteRequest = jest.fn();
    ActualMockedAIModelRouterConstructor.mockImplementation(() => {
      return {
        routeRequest: mockRouteRequest
      };
    });
    
    // Create a mock event
    mockEvent = createMockEvent(
      {
        prompt: 'Hello, world!',
        maxTokens: 100,
        temperature: 0.7
      },
      {
        sub: 'test-user',
        familyId: 'test-family',
        profileId: 'test-profile'
      }
    );
    // Note: Environment variables are set above, before module import.
  });
  
  test('should return 400 when request body is missing', async () => {
    // Modify the event for this test
    const eventWithoutBody = { ...mockEvent, body: null };
    
    const response = await handler(eventWithoutBody);
    
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toBe('Request body is required');
    // Use the dynamically imported mock constructor for assertion
    expect(ActualMockedAIModelRouterConstructor).not.toHaveBeenCalled();
  });
  
  test('should return 400 when request body is invalid JSON', async () => {
    const eventWithInvalidJson = { ...mockEvent, body: 'invalid-json' };
    
    const response = await handler(eventWithInvalidJson);
    
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toBe('Invalid JSON in request body');
    expect(ActualMockedAIModelRouterConstructor).not.toHaveBeenCalled();
  });
  
  test('should return 400 when prompt is missing', async () => {
    const eventWithoutPrompt = createMockEvent(
      { maxTokens: 100 },
      {
        sub: 'test-user',
        familyId: 'test-family',
        profileId: 'test-profile'
      }
    );
    
    const response = await handler(eventWithoutPrompt);
    
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toBe('Prompt is required');
    expect(ActualMockedAIModelRouterConstructor).not.toHaveBeenCalled();
  });
  
  test('should return successful response from the AI model', async () => {
    // Mock successful response from router
    const successResponse: AIModelResult = {
      ok: true,
      text: 'Hello there! How can I help you?',
      tokens: {
        prompt: 10,
        completion: 20,
        total: 30
      },
      meta: {
        provider: 'openai',
        model: 'gpt-4',
        features: [],
        region: 'us-east-2',
        latency: 500,
        timestamp: Date.now()
      }
    };
    
    mockRouteRequest.mockResolvedValue(successResponse);
    
    const response = await handler(mockEvent);
    
    expect(response.statusCode).toBe(200);
    const parsedBody = JSON.parse(response.body);
    expect(parsedBody.success).toBe(true);
    expect(parsedBody.data.text).toBe('Hello there! How can I help you?');
    expect(parsedBody.data.provider).toBe('openai');
    expect(parsedBody.data.model).toBe('gpt-4');
    expect(parsedBody.data.tokenUsage.total).toBe(30);
    
    // Verify router was called with the correct request
    expect(ActualMockedAIModelRouterConstructor).toHaveBeenCalledTimes(1);
    expect(mockRouteRequest).toHaveBeenCalledTimes(1);
    expect(mockRouteRequest.mock.calls[0][0]).toMatchObject({
      prompt: 'Hello, world!',
      maxTokens: 100,
      temperature: 0.7,
      context: {
        requestId: 'test-request-id',
        jwtSub: 'test-user',
        familyId: 'test-family',
        profileId: 'test-profile',
        region: 'us-east-2',
        traceId: 'test-trace-id'
      }
    });
  });
  
  test('should handle error response from the AI model', async () => {
    // Mock error response from router
    const errorResponse: AIModelResult = {
      ok: false,
      code: 'CONTENT',
      provider: 'openai',
      status: 400,
      retryable: false,
      detail: 'Content policy violation'
    };
    
    mockRouteRequest.mockResolvedValue(errorResponse);
    
    const response = await handler(mockEvent);
    
    expect(response.statusCode).toBe(400);
    const parsedBody = JSON.parse(response.body);
    expect(parsedBody.success).toBe(false);
    expect(parsedBody.message).toBe('Content policy violation');
    expect(parsedBody.error.code).toBe('CONTENT');
    
    // Verify router was called
    expect(ActualMockedAIModelRouterConstructor).toHaveBeenCalledTimes(1);
    expect(mockRouteRequest).toHaveBeenCalledTimes(1);
  });
  
  test('should handle unexpected errors', async () => {
    // Force an exception
    mockRouteRequest.mockImplementation(() => {
      throw new Error('Unexpected internal error');
    });
    
    const response = await handler(mockEvent);
    
    expect(response.statusCode).toBe(500);
    const parsedBody = JSON.parse(response.body);
    expect(parsedBody.success).toBe(false);
    expect(parsedBody.message).toBe('An unexpected error occurred');
    expect(parsedBody.error.code).toBe('INTERNAL_ERROR');
    expect(parsedBody.error.details.message).toBe('Unexpected internal error');
  });
  
  test('should handle missing authorizer context', async () => {
    // Create an event with missing authorizer
    const eventWithoutAuthorizer = createMockEvent(
      { prompt: 'Hello with no auth!' },
      null
    );
    
    // Mock successful response
    mockRouteRequest.mockResolvedValue({
      ok: true,
      text: 'Response',
      tokens: { prompt: 5, completion: 5, total: 10 },
      meta: {
        provider: 'openai',
        model: 'gpt-4',
        features: [],
        region: 'us-east-2',
        latency: 300,
        timestamp: Date.now()
      }
    });
    
    const response = await handler(eventWithoutAuthorizer);
    
    expect(response.statusCode).toBe(200);
    
    // Check that request was routed with empty context values
    expect(mockRouteRequest.mock.calls[0][0].context).toMatchObject({
      jwtSub: '',
      familyId: '',
      profileId: ''
    });
  });
  
  test('should use default values when optional parameters are missing', async () => {
    // Create event with minimal request body
    const minimalEvent = createMockEvent(
      { prompt: 'Minimal request' },
      {
        sub: 'test-user',
        familyId: 'test-family',
        profileId: 'test-profile'
      }
    );
    
    // Mock successful response
    mockRouteRequest.mockResolvedValue({
      ok: true,
      text: 'Response to minimal request',
      tokens: { prompt: 5, completion: 5, total: 10 },
      meta: {
        provider: 'openai',
        model: 'gpt-4',
        features: [],
        region: 'us-east-2',
        latency: 300,
        timestamp: Date.now()
      }
    });
    
    await handler(minimalEvent);
    
    // Check that defaults were applied
    expect(mockRouteRequest.mock.calls[0][0]).toMatchObject({
      prompt: 'Minimal request',
      maxTokens: 500,         // default value
      temperature: 0.7,       // default value
      streaming: false        // default value
    });
  });
}); 