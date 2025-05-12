import { APIGatewayRequestAuthorizerEventV2, APIGatewayAuthorizerResult, APIGatewayAuthorizerResultContext } from 'aws-lambda';
import { CognitoAuthProvider } from '../auth/CognitoAuthProvider';
// import type { IUserIdentity } from '@kinable/common-types'; // Removed as userIdentity type is inferred
import { DynamoDBProvider } from '../data/DynamoDBProvider';
import { FamilyData, ProfileData, IUserIdentity } from '@kinable/common-types'; // Added IUserIdentity back for clarity

const userPoolId = process.env.COGNITO_USER_POOL_ID || '';
const clientId = process.env.COGNITO_CLIENT_ID || '';
const tokenUse = (process.env.TOKEN_USE === 'access' || process.env.TOKEN_USE === 'id') ? process.env.TOKEN_USE : 'id';
const familiesTableName = process.env.FAMILIES_TABLE_NAME || '';
const profilesTableName = process.env.PROFILES_TABLE_NAME || '';
const awsRegion = process.env.AWS_REGION || '';

// Initialize providers outside the handler for reuse
let authProvider: CognitoAuthProvider;
if (userPoolId && clientId) {
  authProvider = new CognitoAuthProvider({ userPoolId, clientId, tokenUse });
} else {
  console.error('Cognito User Pool ID or Client ID not configured in environment variables.');
}

let dbProvider: DynamoDBProvider;
if (awsRegion && familiesTableName && profilesTableName) { // Ensure necessary env vars for DB provider are present
  dbProvider = new DynamoDBProvider(awsRegion);
} else {
  console.error('AWS Region or DynamoDB table names not configured in environment variables for DBProvider.');
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2
): Promise<APIGatewayAuthorizerResult> => {
  // console.log('Authorizer event:', JSON.stringify(event, null, 2)); // For debugging

  if (!authProvider) {
    console.error('AuthProvider not initialized due to missing configuration.');
    // Policy to deny access if auth provider isn't set up
    return generatePolicy('undefined', 'Deny', event.routeArn, { message: 'AuthProvider not initialized'}); 
  }
  if (!dbProvider) {
    console.error('DBProvider not initialized due to missing configuration.');
    return generatePolicy('undefined', 'Deny', event.routeArn, { message: 'DBProvider not initialized' });
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
    const userIdentity = await authProvider.verifyToken(bearerToken) as IUserIdentity | null;

    if (userIdentity && userIdentity.isAuthenticated) {
      // console.log('User authenticated:', userIdentity.userId);

      // === Start DB Checks ===
      if (!userIdentity.profileId || !userIdentity.familyId || !userIdentity.region) {
        console.error('User identity from token is missing critical IDs or region.', userIdentity);
        return generatePolicy(userIdentity.userId || 'unknown', 'Deny', event.routeArn, { message: 'Incomplete user identity for DB checks.' });
      }

      try {
        const profile = await dbProvider.getItem<ProfileData>(
          profilesTableName,
          'profileId',
          userIdentity.profileId,
          userIdentity.region
        );

        if (!profile) {
          console.log(`Profile not found for profileId: ${userIdentity.profileId} in region: ${userIdentity.region}`);
          return generatePolicy(userIdentity.userId, 'Deny', event.routeArn, { message: 'Profile not found.' });
        }

        if (profile.pauseStatusProfile) {
          console.log(`Profile ${userIdentity.profileId} is paused.`);
          return generatePolicy(userIdentity.userId, 'Deny', event.routeArn, null);
        }

        const family = await dbProvider.getItem<FamilyData>(
          familiesTableName,
          'familyId',
          userIdentity.familyId,
          userIdentity.region
        );

        if (!family) {
          console.log(`Family not found for familyId: ${userIdentity.familyId} in region: ${userIdentity.region}`);
          return generatePolicy(userIdentity.userId, 'Deny', event.routeArn, { message: 'Family not found.' });
        }

        if (family.pauseStatusFamily) {
          console.log(`Family ${userIdentity.familyId} is paused.`);
          return generatePolicy(userIdentity.userId, 'Deny', event.routeArn, { message: 'Family is paused.' });
        }

        if (family.tokenBalance === undefined || family.tokenBalance === null || family.tokenBalance <= 0) {
          console.log(`Family ${userIdentity.familyId} has insufficient token balance: ${family.tokenBalance}`);
          return generatePolicy(userIdentity.userId, 'Deny', event.routeArn, { message: 'Insufficient token balance.' });
        }
        // === End DB Checks ===

      } catch (dbError) {
        console.error('Error during database checks:', dbError);
        return generatePolicy(userIdentity.userId || 'unknown', 'Deny', event.routeArn, { message: 'Error during database validation.' });
      }
      
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
export const generatePolicy = (
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: APIGatewayAuthorizerResultContext | null // Make context optional and allow null
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
  };

  // Only add context to the response if it is provided and not null
  if (context) {
    authResponse.context = context;
  }
  
  // console.log("Generated policy:", JSON.stringify(authResponse, null, 2));
  return authResponse;
}; 