import { /* APIGatewayProxyEventV2, */ APIGatewayProxyResultV2 } from 'aws-lambda';

/**
 * Sample Lambda function which returns a hello world response
 */
export const handler = async (/* unused parameter */): Promise<APIGatewayProxyResultV2> => {
    // Basic response structure
    const response: APIGatewayProxyResultV2 = {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: 'Hello from the API service!'
        })
    };
    
    return response;
}; 