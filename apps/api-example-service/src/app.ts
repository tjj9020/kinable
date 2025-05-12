import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SampleType, SampleEnum } from '@kinable/common-types';

export const lambdaHandler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const exampleData: SampleType = {
        id: '123',
        name: 'Example Data from API'
    };

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: 'Hello from Example API!',
            data: exampleData,
            option: SampleEnum.Option2
        }),
    };
}; 