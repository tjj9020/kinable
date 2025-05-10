import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SampleType, SampleEnum } from '@kinable/common-types';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log("Event: ", JSON.stringify(event, null, 2));

    const exampleData: SampleType = {
        id: '123',
        name: 'Example Data from API'
    };

    console.log("Using shared type: ", exampleData);
    console.log("Using shared enum: ", SampleEnum.Option1);

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