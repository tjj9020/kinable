import { APIGatewayRequestAuthorizerEventV2, APIGatewayAuthorizerResult, APIGatewayAuthorizerResultContext } from 'aws-lambda';
import { CognitoAuthProvider } from '../auth/CognitoAuthProvider';
// import type { IUserIdentity } from '@kinable/common-types'; // Removed as userIdentity type is inferred

const userPoolId = process.env.COGNITO_USER_POOL_ID || '';
const clientId = process.env.COGNITO_CLIENT_ID || '';
const tokenUse = (process.env.TOKEN_USE === 'access' || process.env.TOKEN_USE === 'id') ? process.env.TOKEN_USE : 'id';

// Initialize the provider outside the handler for reuse (if container stays warm)
let authProvider: CognitoAuthProvider;
if (userPoolId && clientId) {
  authProvider = new CognitoAuthProvider(userPoolId, clientId, tokenUse);
} else {
  console.error('Cognito User Pool ID or Client ID not configured in environment variables.');
  // Optionally, throw an error here to fail fast during Lambda initialization if critical
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2
): Promise<APIGatewayAuthorizerResult> => {
  // console.log('Authorizer event:', JSON.stringify(event, null, 2)); // For debugging

  if (!authProvider) {
    console.error('AuthProvider not initialized due to missing configuration.');
    // Policy to deny access if auth provider isn't set up
    return generatePolicy('undefined', 'Deny', event.routeArn, {}); 
  }

  // API Gateway V2 HTTP APIs pass the token in identitySource, typically $request.header.Authorization
  // The event.identitySource array will contain the value of the first identity source that has a value.
  const token = event.identitySource && event.identitySource.length > 0 ? event.identitySource[0] : null;

  if (!token) {
    console.log('No token found in event.identitySource');
    return generatePolicy('unauthorized', 'Deny', event.routeArn, { message: 'Unauthorized' });
  }

  // Assuming Bearer token format: "Bearer <token>"
  const bearerToken = token.startsWith('Bearer ') ? token.substring(7) : token;

  try {
    const userIdentity = await authProvider.verifyToken(bearerToken);

    if (userIdentity && userIdentity.isAuthenticated) {
      // console.log('User authenticated:', userIdentity.userId);
      // Pass context to the backend Lambda. This is crucial.
      // The context object here will be available in the event.requestContext.authorizer.lambda object of the backend Lambda.
      return generatePolicy(userIdentity.userId, 'Allow', event.routeArn, userIdentity as unknown as APIGatewayAuthorizerResultContext);
    } else {
      console.log('Token verification failed or user not authenticated');
      return generatePolicy('unauthorized', 'Deny', event.routeArn, { message: 'Unauthorized' });
    }
  } catch (error) {
    console.error('Error during token verification:', error);
    return generatePolicy('unauthorized', 'Deny', event.routeArn, { message: 'Unauthorized - Internal Server Error' });
  }
};

// Helper function to generate an IAM policy
const generatePolicy = (
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: APIGatewayAuthorizerResultContext // Context passed to the integrated Lambda
): APIGatewayAuthorizerResult => {
  const authResponse: APIGatewayAuthorizerResult = {
    principalId: principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource, // Or be more specific, e.g., for specific methods/paths
        },
      ],
    },
    context: context, // This context is passed to the backend Lambda
  };
  // console.log("Generated policy:", JSON.stringify(authResponse, null, 2));
  return authResponse;
}; 