import fetch from 'node-fetch';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  ICognitoUserPoolData,
  ICognitoUserData,
  IAuthenticationDetailsData,
} from 'amazon-cognito-identity-js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import * as dotenv from 'dotenv';

// Load environment variables from .env.dev.remote if it exists
dotenv.config({ path: '.env.dev.remote' });

// --- Configuration ---
const COGNITO_USER_POOL_ID = process.env.TEST_COGNITO_USER_POOL_ID || '';
const COGNITO_CLIENT_ID = process.env.TEST_COGNITO_CLIENT_ID || '';
const API_ENDPOINT = process.env.TEST_API_ENDPOINT || '';
const AWS_REGION = process.env.TEST_AWS_REGION || 'us-east-2';
const AWS_PROFILE = process.env.AWS_PROFILE;

// Table names should match your deployed tables from SAM
const DYNAMODB_TABLE_FAMILIES = process.env.TEST_DYNAMODB_TABLE_FAMILIES || 'KinableFamilies-dev';
const DYNAMODB_TABLE_PROFILES = process.env.TEST_DYNAMODB_TABLE_PROFILES || 'KinableProfiles-dev';

// Test user credentials (this user must exist in your Cognito User Pool)
const TEST_USER_USERNAME = process.env.TEST_USER_USERNAME || '';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || '';

// Setup DynamoDB client
const dynamoDbConfig: any = { region: AWS_REGION };
if (AWS_PROFILE) {
  dynamoDbConfig.credentials = { profile: AWS_PROFILE };
}
const dynamoDbClient = new DynamoDBClient(dynamoDbConfig);
const docClient = DynamoDBDocumentClient.from(dynamoDbClient);

// Get user's JWT token
async function getJwtToken(username: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
      return reject(new Error('Cognito User Pool ID or Client ID is not configured'));
    }
    if (!username || !password) {
      return reject(new Error('Test user credentials are not configured'));
    }

    const poolData: ICognitoUserPoolData = {
      UserPoolId: COGNITO_USER_POOL_ID,
      ClientId: COGNITO_CLIENT_ID,
    };
    const userPool = new CognitoUserPool(poolData);

    const userData: ICognitoUserData = {
      Username: username,
      Pool: userPool,
    };
    const cognitoUser = new CognitoUser(userData);

    const authDetailsData: IAuthenticationDetailsData = {
      Username: username,
      Password: password,
    };
    const authenticationDetails = new AuthenticationDetails(authDetailsData);

    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (session) => {
        resolve(session.getIdToken().getJwtToken());
      },
      onFailure: (err) => {
        reject(new Error(`Failed to authenticate: ${err.message}`));
      },
      newPasswordRequired: () => {
        reject(new Error('New password required'));
      }
    });
  });
}

// Test API call with token
async function callApiWithToken(token: string): Promise<{ status: number, body: any }> {
  try {
    const response = await fetch(`${API_ENDPOINT}/hello`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    let body;
    try {
      body = await response.json();
    } catch (e) {
      body = await response.text();
    }
    
    return { status: response.status, body };
  } catch (error) {
    console.error('Error calling API:', error);
    throw error;
  }
}

// Database helpers
async function setupItem(tableName: string, item: any) {
  const params = { TableName: tableName, Item: item };
  try {
    await docClient.send(new PutCommand(params));
    console.log(`Added item to ${tableName}`);
  } catch (error) {
    console.error(`Error adding item to ${tableName}:`, error);
    throw error;
  }
}

async function cleanupItem(tableName: string, key: any) {
  const params = { TableName: tableName, Key: key };
  try {
    await docClient.send(new DeleteCommand(params));
    console.log(`Deleted item from ${tableName}`);
  } catch (error) {
    console.error(`Error deleting from ${tableName}:`, error);
  }
}

async function getItem(tableName: string, key: any) {
  const params = { TableName: tableName, Key: key };
  try {
    const response = await docClient.send(new GetCommand(params));
    return response.Item;
  } catch (error) {
    console.error(`Error getting item from ${tableName}:`, error);
    return null;
  }
}

describe('JWT Authorizer DynamoDB Checks Integration Test', () => {
  // Extract actual user claims from token for testing
  let idToken: string;
  let familyId: string;
  let profileId: string;
  let userRegion: string;
  
  // Skip all tests if we can't authenticate
  beforeAll(async () => {
    try {
      // This ensures environment variables are set
      if (!TEST_USER_USERNAME || !TEST_USER_PASSWORD || !API_ENDPOINT) {
        console.warn('Missing required environment variables for integration tests');
        return;
      }
      
      // Get token for the test user
      idToken = await getJwtToken(TEST_USER_USERNAME, TEST_USER_PASSWORD);
      console.log('Successfully obtained ID token for tests');
      
      // For integration testing, we need to parse the token to get the actual claims
      // that would be used in the real application
      // This is not ideal but a pragmatic approach for integration testing
      const tokenParts = idToken.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid JWT token format');
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      
      // Extract claims from token
      familyId = payload['custom:familyId'] || ''; 
      profileId = payload['custom:profileId'] || '';
      userRegion = payload['custom:region'] || AWS_REGION;
      
      if (!familyId || !profileId) {
        console.warn('Token is missing required custom claims. Tests may fail.');
      }
      
      console.log(`Using familyId: ${familyId}, profileId: ${profileId}, region: ${userRegion}`);
      
    } catch (error) {
      console.error('Failed to set up integration tests:', error);
      // Don't throw - we'll skip tests individually
    }
  }, 30000);
  
  // Test 1: Happy Path - Valid token with active profile, family and sufficient tokens
  test('should allow access with valid token, non-paused profile/family and sufficient tokens', async () => {
    // Skip if we couldn't authenticate
    if (!idToken || !familyId || !profileId) {
      console.warn('Skipping test - missing required token or claims');
      return;
    }
    
    try {
      // Set up valid family and profile data
      const testFamilyData = {
        familyId: `FAMILY#${userRegion}#${familyId}`,
        tokenBalance: 100,
        pauseStatusFamily: false,
        primaryRegion: userRegion
      };
      
      const testProfileData = {
        profileId: `PROFILE#${userRegion}#${profileId}`,
        familyId: `FAMILY#${userRegion}#${familyId}`,
        role: 'child',
        pauseStatusProfile: false,
        userRegion: userRegion
      };
      
      // Create the test data in DynamoDB
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData);
      
      // Call API with valid token
      const response = await callApiWithToken(idToken);
      
      // Should get a 200 OK
      expect(response.status).toBe(200);
      
    } finally {
      // Clean up
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { 
        familyId: `FAMILY#${userRegion}#${familyId}` 
      });
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { 
        profileId: `PROFILE#${userRegion}#${profileId}` 
      });
    }
  }, 10000);
  
  // Test 2: Check paused profile behavior
  test('should deny access when profile is paused', async () => {
    // Skip if we couldn't authenticate
    if (!idToken || !familyId || !profileId) {
      console.warn('Skipping test - missing required token or claims');
      return;
    }
    
    try {
      // Set up family data (normal) and profile data (paused)
      const testFamilyData = {
        familyId: `FAMILY#${userRegion}#${familyId}`,
        tokenBalance: 100,
        pauseStatusFamily: false,
        primaryRegion: userRegion
      };
      
      const testProfileData = {
        profileId: `PROFILE#${userRegion}#${profileId}`,
        familyId: `FAMILY#${userRegion}#${familyId}`,
        role: 'child',
        pauseStatusProfile: true, // Profile is paused
        userRegion: userRegion
      };
      
      // Create the test data in DynamoDB
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData);
      
      // Call API with valid token - should be denied
      const response = await callApiWithToken(idToken);
      
      // Should get a 403 Forbidden
      expect(response.status).toBe(403);
      
    } finally {
      // Clean up
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { 
        familyId: `FAMILY#${userRegion}#${familyId}` 
      });
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { 
        profileId: `PROFILE#${userRegion}#${profileId}` 
      });
    }
  }, 10000);
  
  // Test 3: Check paused family behavior
  test('should deny access when family is paused', async () => {
    // Skip if we couldn't authenticate
    if (!idToken || !familyId || !profileId) {
      console.warn('Skipping test - missing required token or claims');
      return;
    }
    
    try {
      // Set up family data (paused) and profile data (normal)
      const testFamilyData = {
        familyId: `FAMILY#${userRegion}#${familyId}`,
        tokenBalance: 100,
        pauseStatusFamily: true, // Family is paused
        primaryRegion: userRegion
      };
      
      const testProfileData = {
        profileId: `PROFILE#${userRegion}#${profileId}`,
        familyId: `FAMILY#${userRegion}#${familyId}`,
        role: 'child',
        pauseStatusProfile: false,
        userRegion: userRegion
      };
      
      // Create the test data in DynamoDB
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData);
      
      // Call API with valid token - should be denied
      const response = await callApiWithToken(idToken);
      
      // Should get a 403 Forbidden
      expect(response.status).toBe(403);
      
    } finally {
      // Clean up
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { 
        familyId: `FAMILY#${userRegion}#${familyId}` 
      });
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { 
        profileId: `PROFILE#${userRegion}#${profileId}` 
      });
    }
  }, 10000);
  
  // Test 4: Check token balance behavior
  test('should deny access when token balance is zero or negative', async () => {
    // Skip if we couldn't authenticate
    if (!idToken || !familyId || !profileId) {
      console.warn('Skipping test - missing required token or claims');
      return;
    }
    
    try {
      // Set up family data (zero balance) and profile data (normal)
      const testFamilyData = {
        familyId: `FAMILY#${userRegion}#${familyId}`,
        tokenBalance: 0, // Zero balance
        pauseStatusFamily: false,
        primaryRegion: userRegion
      };
      
      const testProfileData = {
        profileId: `PROFILE#${userRegion}#${profileId}`,
        familyId: `FAMILY#${userRegion}#${familyId}`,
        role: 'child',
        pauseStatusProfile: false,
        userRegion: userRegion
      };
      
      // Create the test data in DynamoDB
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData);
      
      // Call API with valid token - should be denied
      const response = await callApiWithToken(idToken);
      
      // Should get a 403 Forbidden
      expect(response.status).toBe(403);
      
    } finally {
      // Clean up
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { 
        familyId: `FAMILY#${userRegion}#${familyId}` 
      });
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { 
        profileId: `PROFILE#${userRegion}#${profileId}` 
      });
    }
  }, 10000);
  
  // Test 5: Check missing profile behavior
  test('should deny access when profile does not exist', async () => {
    // Skip if we couldn't authenticate
    if (!idToken || !familyId || !profileId) {
      console.warn('Skipping test - missing required token or claims');
      return;
    }
    
    try {
      // Only set up family data, not profile data
      const testFamilyData = {
        familyId: `FAMILY#${userRegion}#${familyId}`,
        tokenBalance: 100,
        pauseStatusFamily: false,
        primaryRegion: userRegion
      };
      
      // Create family but NOT profile
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      
      // Call API with valid token - should be denied
      const response = await callApiWithToken(idToken);
      
      // Should get a 403 Forbidden
      expect(response.status).toBe(403);
      
    } finally {
      // Clean up
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { 
        familyId: `FAMILY#${userRegion}#${familyId}` 
      });
    }
  }, 10000);
  
  // Test 6: Check missing family behavior
  test('should deny access when family does not exist', async () => {
    // Skip if we couldn't authenticate
    if (!idToken || !familyId || !profileId) {
      console.warn('Skipping test - missing required token or claims');
      return;
    }
    
    try {
      // Only set up profile data, not family data
      const testProfileData = {
        profileId: `PROFILE#${userRegion}#${profileId}`,
        familyId: `FAMILY#${userRegion}#${familyId}`,
        role: 'child',
        pauseStatusProfile: false,
        userRegion: userRegion
      };
      
      // Create profile but NOT family
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData);
      
      // Call API with valid token - should be denied
      const response = await callApiWithToken(idToken);
      
      // Should get a 403 Forbidden
      expect(response.status).toBe(403);
      
    } finally {
      // Clean up
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { 
        profileId: `PROFILE#${userRegion}#${profileId}` 
      });
    }
  }, 10000);
}); 