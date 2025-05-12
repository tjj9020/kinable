import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

// Load environment variables from .env.dev.remote
dotenv.config({ path: '.env.dev.remote' });

// Get configuration from environment variables
const COGNITO_USER_POOL_ID = process.env.TEST_COGNITO_USER_POOL_ID || '';
const COGNITO_CLIENT_ID = process.env.TEST_COGNITO_CLIENT_ID || '';
const API_ENDPOINT = process.env.TEST_API_ENDPOINT || '';
const TEST_USER_USERNAME = process.env.TEST_USER_USERNAME || '';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || '';

console.log('COGNITO_USER_POOL_ID:', COGNITO_USER_POOL_ID);
console.log('COGNITO_CLIENT_ID:', COGNITO_CLIENT_ID);
console.log('API_ENDPOINT:', API_ENDPOINT);
console.log('TEST_USER_USERNAME:', TEST_USER_USERNAME);
console.log('TEST_USER_PASSWORD:', TEST_USER_PASSWORD ? '********' : 'not set');

// Helper function to get JWT token from Cognito
async function getJwtToken(username: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
      return reject(new Error('Cognito User Pool ID or Client ID is not configured.'));
    }
    if (!username || !password) {
      return reject(new Error('Username or password is not provided.'));
    }

    const poolData = {
      UserPoolId: COGNITO_USER_POOL_ID,
      ClientId: COGNITO_CLIENT_ID,
    };
    const userPool = new CognitoUserPool(poolData);

    const userData = {
      Username: username,
      Pool: userPool,
    };
    const cognitoUser = new CognitoUser(userData);

    const authenticationData = {
      Username: username,
      Password: password,
    };
    const authDetails = new AuthenticationDetails(authenticationData);

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        const token = session.getIdToken().getJwtToken();
        resolve(token);
      },
      onFailure: (err) => {
        reject(new Error(`Authentication failed: ${err.message || JSON.stringify(err)}`));
      },
      newPasswordRequired: () => {
        reject(new Error('New password required. Please reset it in Cognito console.'));
      },
    });
  });
}

// Function to test API endpoint with token
async function testApiWithToken(token: string) {
  console.log('\nTesting API with token...');
  const endpoint = `${API_ENDPOINT}/hello`;
  
  console.log(`Calling endpoint: ${endpoint}`);
  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log(`Response status: ${response.status} ${response.statusText}`);
    
    const body = await response.text();
    try {
      // Try to parse as JSON if possible
      const jsonBody = JSON.parse(body);
      console.log('Response body (JSON):', JSON.stringify(jsonBody, null, 2));
    } catch (e) {
      // Otherwise show as text
      console.log('Response body (text):', body);
    }
    
    return response.status === 200;
  } catch (error) {
    console.error('Error calling API:', error);
    return false;
  }
}

// Main function to run the test
async function runTest() {
  try {
    console.log('Getting JWT token...');
    const token = await getJwtToken(TEST_USER_USERNAME, TEST_USER_PASSWORD);
    console.log('Successfully obtained token.');
    console.log('Token (first 20 chars):', token.substring(0, 20) + '...');
    
    const success = await testApiWithToken(token);
    console.log('\nAPI test result:', success ? 'SUCCESS' : 'FAILED');
    
    if (!success) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the test
runTest(); 