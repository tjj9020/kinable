import { lambdaHandler } from './app';
import { APIGatewayProxyEvent } from 'aws-lambda';

describe('Lambda Handler', () => {
  test('returns successful response', async () => {
    const event = {} as APIGatewayProxyEvent;
    const result = await lambdaHandler(event);
    
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('Hello from Example API!');
    
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Hello from Example API!');
    expect(body.data.id).toBe('123');
    expect(body.data.name).toBe('Example Data from API');
  });
}); 