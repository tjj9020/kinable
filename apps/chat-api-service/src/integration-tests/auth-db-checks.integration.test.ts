import fetch from 'node-fetch';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  ICognitoUserPoolData,
  ICognitoUserData,
  IAuthenticationDetailsData,
} from 'amazon-cognito-identity-js';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
  AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

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

// Setup Cognito Client for admin operations
const cognitoAdminClient = new CognitoIdentityProviderClient({ region: AWS_REGION });

// Variables for the dynamically created user
let dynamicTestUsername: string;
let dynamicTestPasswordGenerated: string;

// Setup DynamoDB client
const dynamoDbConfig: any = { region: AWS_REGION };
if (AWS_PROFILE) {
  // SDK v3 picks up profile from environment. Explicitly setting credentials here is less common.
  console.log(`[AuthDbChecks] Using AWS_PROFILE: ${AWS_PROFILE} (if SDK configured to use it)`);
}
const dynamoDbClient = new DynamoDBClient(dynamoDbConfig);
const docClient = DynamoDBDocumentClient.from(dynamoDbClient);

// Helper function to create a test user (copied and adapted from auth.integration.test.ts)
async function createDynamicallyGeneratedTestUser(username: string, password: string, familyIdAttrib: string, profileIdAttrib: string, regionAttrib: string) {
  const userAttributes: AttributeType[] = [
    { Name: 'email', Value: username }, // Assuming email is used as username
    { Name: 'email_verified', Value: 'true' },
    { Name: 'custom:familyId', Value: familyIdAttrib },
    { Name: 'custom:profileId', Value: profileIdAttrib },
    { Name: 'custom:region', Value: regionAttrib },
  ];
  try {
    await cognitoAdminClient.send(new AdminCreateUserCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Username: username,
      TemporaryPassword: password,
      UserAttributes: userAttributes,
      MessageAction: 'SUPPRESS',
    }));
    console.log(`[AuthDbChecks] AdminCreateUserCommand successful for ${username}`);
    await cognitoAdminClient.send(new AdminSetUserPasswordCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Username: username,
      Password: password,
      Permanent: true,
    }));
    console.log(`[AuthDbChecks] AdminSetUserPasswordCommand successful for ${username}`);
  } catch (error) {
    console.error(`[AuthDbChecks] Error creating user ${username} for auth-db-checks:`, error);
    throw error;
  }
}

// Helper function to delete a test user
async function deleteDynamicallyGeneratedTestUser(username: string) {
  if (!username) return;
  try {
    await cognitoAdminClient.send(new AdminDeleteUserCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Username: username,
    }));
    console.log(`[AuthDbChecks] Successfully deleted dynamic user ${username}`);
  } catch (error: any) {
    if (error.name === 'UserNotFoundException') {
      console.log(`[AuthDbChecks] Dynamic user ${username} not found for deletion, assuming already deleted.`);
    } else {
      console.error(`[AuthDbChecks] Error deleting dynamic user ${username}:`, error);
    }
  }
}

// Get user's JWT token (this function remains as it's used for standard auth flow)
async function getJwtToken(username: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
      return reject(new Error('[AuthDbChecks] Cognito User Pool ID or Client ID is not configured'));
    }
    if (!username || !password) {
      // This case should ideally not be hit if called after dynamic user creation
      return reject(new Error('[AuthDbChecks] Username or password not provided for JWT generation'));
    }

    const poolData: ICognitoUserPoolData = {
      UserPoolId: COGNITO_USER_POOL_ID,
      ClientId: COGNITO_CLIENT_ID,
    };
    const userPool = new CognitoUserPool(poolData);
    const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: username, Password: password });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: (err) => reject(new Error(`[AuthDbChecks] Failed to authenticate ${username}: ${err.message}`)),
      newPasswordRequired: () => reject(new Error('[AuthDbChecks] New password required for dynamic user - unexpected.')),
    });
  });
}

// Test API call with token (remains unchanged)
async function callApiWithToken(token: string): Promise<{ status: number, body: any }> {
  try {
    const response = await fetch(`${API_ENDPOINT}/hello`, { // Assuming /hello for tests
      headers: { Authorization: `Bearer ${token}` },
    });
    let body;
    try { body = await response.json(); } catch (e) { body = await response.text(); }
    return { status: response.status, body };
  } catch (error) {
    console.error('[AuthDbChecks] Error calling API:', error);
    throw error;
  }
}

// Database helpers (remain unchanged)
async function setupItem(tableName: string, item: any) {
  const params = { TableName: tableName, Item: item };
  try {
    await docClient.send(new PutCommand(params));
    console.log(`[AuthDbChecks] Added item to ${tableName}: ${JSON.stringify(item)}`);
  } catch (error) {
    console.error(`[AuthDbChecks] Error adding item to ${tableName}:`, error);
    throw error; // Re-throw to fail tests if setup is critical
  }
}

async function cleanupItem(tableName: string, key: any) {
  const params = { TableName: tableName, Key: key };
  try {
    await docClient.send(new DeleteCommand(params));
    console.log(`[AuthDbChecks] Deleted item from ${tableName} with key: ${JSON.stringify(key)}`);
  } catch (error: any) {
    // It's okay if the item doesn't exist during cleanup
    if (!(error instanceof Error && error.name === 'ResourceNotFoundException')) {
        console.warn(`[AuthDbChecks] Error deleting item from ${tableName} (key: ${JSON.stringify(key)}), may not affect test outcome:`, error);
    }
  }
}

describe('JWT Authorizer DynamoDB Checks Integration Test', () => {
  let idToken: string;
  // These will be derived from the dynamically created user's attributes
  let parsedFamilyId: string; 
  let parsedProfileId: string;
  let parsedUserRegion: string;

  // Logical IDs for the dynamic user and their associated DB entries
  const suiteLogicalFamilyId = `authDbTestFam-${uuidv4().substring(0,8)}`;
  const suiteLogicalProfileId = `authDbTestProf-${uuidv4().substring(0,8)}`;
  const suiteUserRegion = AWS_REGION; // Region for the user and their data

  // Actual DynamoDB key values (including regional prefix)
  const actualFamilyIdForDb = `FAMILY#${suiteUserRegion}#${suiteLogicalFamilyId}`;
  const actualProfileIdForDb = `PROFILE#${suiteUserRegion}#${suiteLogicalProfileId}`;
  
  beforeAll(async () => {
    try {
      if (!API_ENDPOINT || !COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID || !DYNAMODB_TABLE_FAMILIES || !DYNAMODB_TABLE_PROFILES) {
        throw new Error ('[AuthDbChecks] Missing required environment variables (Cognito IDs, API endpoint, table names, region).');
      }
      
      dynamicTestUsername = `testuser.authdb.${uuidv4()}@kinable.test`;
      dynamicTestPasswordGenerated = `TestPass${uuidv4().substring(0,8)}!Ab0`;

      console.log(`[AuthDbChecks] Creating dynamic user: ${dynamicTestUsername}`);
      await createDynamicallyGeneratedTestUser(
        dynamicTestUsername,
        dynamicTestPasswordGenerated,
        actualFamilyIdForDb, // Attribute value for custom:familyId
        actualProfileIdForDb, // Attribute value for custom:profileId
        suiteUserRegion    // Attribute value for custom:region
      );
      
      console.log(`[AuthDbChecks] Authenticating dynamic user: ${dynamicTestUsername}`);
      idToken = await getJwtToken(dynamicTestUsername, dynamicTestPasswordGenerated);
      console.log('[AuthDbChecks] Successfully obtained ID token for dynamic user.');
      
      const tokenParts = idToken.split('.');
      if (tokenParts.length !== 3) throw new Error('[AuthDbChecks] Invalid JWT token format from dynamic user');
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      
      parsedFamilyId = payload['custom:familyId'];
      parsedProfileId = payload['custom:profileId'];
      parsedUserRegion = payload['custom:region'];
      
      if (!parsedFamilyId || !parsedProfileId || !parsedUserRegion) {
        throw new Error('[AuthDbChecks] Token from dynamic user is missing required custom claims (familyId, profileId, region).');
      }
      console.log(`[AuthDbChecks] Using parsed claims: familyId=${parsedFamilyId}, profileId=${parsedProfileId}, region=${parsedUserRegion}`);
      
    } catch (error) {
      console.error('[AuthDbChecks] Critical failure in beforeAll setup:', error);
      throw error; // Fail fast if setup fails
    }
  }, 60000); // Increased timeout

  afterAll(async () => {
    await deleteDynamicallyGeneratedTestUser(dynamicTestUsername);
  }, 30000);
  
  // Test 1: Happy Path
  test('should allow access with valid token, non-paused profile/family and sufficient tokens', async () => {
    if (!idToken) { console.warn('[AuthDbChecks] Skipping test - no ID token due to setup failure.'); return; }
    
    const testFamilyData = {
      familyId: actualFamilyIdForDb, // Use the ID set on the user
      tokenBalance: 100,
      pauseStatusFamily: false,
      primaryRegion: parsedUserRegion // Match user's region attribute
    };
    const testProfileData = {
      profileId: actualProfileIdForDb, // Use the ID set on the user
      familyId: actualFamilyIdForDb,
      role: 'child',
      pauseStatusProfile: false,
      userRegion: parsedUserRegion // Match user's region attribute
    };
    
    try {
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData);
      const response = await callApiWithToken(idToken);
      expect(response.status).toBe(200);
    } finally {
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { familyId: actualFamilyIdForDb });
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { profileId: actualProfileIdForDb });
    }
  }, 15000);
  
  // Test 2: Check paused profile behavior
  test('should deny access when profile is paused', async () => {
    if (!idToken) { console.warn('[AuthDbChecks] Skipping test - no ID token.'); return; }
        
    const testFamilyData = { familyId: actualFamilyIdForDb, tokenBalance: 100, pauseStatusFamily: false, primaryRegion: parsedUserRegion };
    const testProfileData = { profileId: actualProfileIdForDb, familyId: actualFamilyIdForDb, role: 'child', pauseStatusProfile: true, userRegion: parsedUserRegion }; // Profile is paused
    
    try {
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData);
      const response = await callApiWithToken(idToken);
      expect(response.status).toBe(403);
      // Optionally, check response.body.message for specific error message if consistent
      // e.g. expect(response.body.message).toBe('User profile is paused.');
    } finally {
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { familyId: actualFamilyIdForDb });
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { profileId: actualProfileIdForDb });
    }
  }, 15000);

  // Test 3: Check paused family behavior (similar structure)
  test('should deny access when family is paused', async () => {
    if (!idToken) { console.warn('[AuthDbChecks] Skipping test - no ID token.'); return; }

    const testFamilyData = { familyId: actualFamilyIdForDb, tokenBalance: 100, pauseStatusFamily: true, primaryRegion: parsedUserRegion }; // Family is paused
    const testProfileData = { profileId: actualProfileIdForDb, familyId: actualFamilyIdForDb, role: 'child', pauseStatusProfile: false, userRegion: parsedUserRegion };

    try {
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData);
      const response = await callApiWithToken(idToken);
      expect(response.status).toBe(403);
    } finally {
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { familyId: actualFamilyIdForDb });
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { profileId: actualProfileIdForDb });
    }
  }, 15000);

  // Test 4: Insufficient token balance (similar structure)
  test('should deny access when token balance is zero', async () => {
    if (!idToken) { console.warn('[AuthDbChecks] Skipping test - no ID token.'); return; }

    const testFamilyData = { familyId: actualFamilyIdForDb, tokenBalance: 0, pauseStatusFamily: false, primaryRegion: parsedUserRegion }; // Zero tokens
    const testProfileData = { profileId: actualProfileIdForDb, familyId: actualFamilyIdForDb, role: 'child', pauseStatusProfile: false, userRegion: parsedUserRegion };

    try {
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData);
      const response = await callApiWithToken(idToken);
      expect(response.status).toBe(403);
    } finally {
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { familyId: actualFamilyIdForDb });
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { profileId: actualProfileIdForDb });
    }
  }, 15000);
  
  // Test 5: Family data missing (similar structure)
  test('should deny access if family data is missing', async () => {
    if (!idToken) { console.warn('[AuthDbChecks] Skipping test - no ID token.'); return; }

    // Note: parsedFamilyId already includes the FAMILY#region#logicalId format.
    // The authorizer will use this directly to look up.
    // Ensure profile data IS present, but family data is NOT.
    const testProfileData = { profileId: actualProfileIdForDb, familyId: actualFamilyIdForDb, role: 'child', pauseStatusProfile: false, userRegion: parsedUserRegion };

    try {
      await setupItem(DYNAMODB_TABLE_PROFILES, testProfileData); 
      // DO NOT setup family item: await cleanupItem(DYNAMODB_TABLE_FAMILIES, { familyId: actualFamilyIdForDb });
      
      const response = await callApiWithToken(idToken);
      expect(response.status).toBe(403); 
      // Check specific error message if known, e.g.,
      // expect(response.body.message).toContain(`Family data not found`);
    } finally {
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { profileId: actualProfileIdForDb });
      // Ensure family table is clean in case a previous test left data or this test created it unexpectedly
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { familyId: actualFamilyIdForDb }); 
    }
  }, 15000);

  // Test 6: Profile data missing (similar structure)
  test('should deny access if profile data is missing', async () => {
    if (!idToken) { console.warn('[AuthDbChecks] Skipping test - no ID token.'); return; }

    const testFamilyData = { familyId: actualFamilyIdForDb, tokenBalance: 100, pauseStatusFamily: false, primaryRegion: parsedUserRegion };

    try {
      await setupItem(DYNAMODB_TABLE_FAMILIES, testFamilyData);
      // DO NOT setup profile item: await cleanupItem(DYNAMODB_TABLE_PROFILES, { profileId: actualProfileIdForDb });
      
      const response = await callApiWithToken(idToken);
      expect(response.status).toBe(403);
      // Check specific error message if known, e.g.,
      // expect(response.body.message).toContain(`Profile data not found`);
    } finally {
      await cleanupItem(DYNAMODB_TABLE_FAMILIES, { familyId: actualFamilyIdForDb });
      await cleanupItem(DYNAMODB_TABLE_PROFILES, { profileId: actualProfileIdForDb });
    }
  }, 15000);

}); 