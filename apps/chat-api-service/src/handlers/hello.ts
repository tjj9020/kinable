import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

/**
 * @param {APIGatewayProxyEventV2} event - API Gateway Lambda Proxy Input Format
 * @returns {APIGatewayProxyStructuredResultV2}
 */
export const handler = async (
  _event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    // console.log("Event: ", JSON.stringify(_event, null, 2)); // For debugging

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Hello World from the chat-api-service! SAM is working!',
        // input: _event, // Optionally return the event for debugging
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'some error happened',
        error: (err as Error).message,
      }),
    };
  }
}; 