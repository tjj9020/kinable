'use client'

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { COGNITO_CONFIG } from './api-config';

// Check if we have valid Cognito configuration
const isCognitoConfigured = (): boolean => {
  const isConfigured = !!(COGNITO_CONFIG.USER_POOL_ID && COGNITO_CONFIG.CLIENT_ID);
  console.log("Cognito configured:", isConfigured, {
    region: COGNITO_CONFIG.REGION,
    userPoolId: COGNITO_CONFIG.USER_POOL_ID,
    clientId: COGNITO_CONFIG.CLIENT_ID
  });
  return isConfigured;
};

// Initialize the Cognito User Pool
const getUserPool = (): CognitoUserPool | null => {
  if (!isCognitoConfigured()) {
    console.error('Cognito is not configured properly');
    return null;
  }

  return new CognitoUserPool({
    UserPoolId: COGNITO_CONFIG.USER_POOL_ID,
    ClientId: COGNITO_CONFIG.CLIENT_ID,
  });
};

// Get the current user if logged in
export const getCurrentUser = (): CognitoUser | null => {
  try {
    console.log("Getting current user...");
    const userPool = getUserPool();
    if (!userPool) {
      console.error("Cannot get current user: User pool is null");
      return null;
    }
    
    const cognitoUser = userPool.getCurrentUser();
    console.log("Current user:", cognitoUser ? "Found" : "Not found");
    return cognitoUser;
  } catch (err) {
    console.error("Error getting current user:", err);
    return null;
  }
};

// Sign in with username and password
export const signIn = (username: string, password: string): Promise<CognitoUserSession> => {
  console.log(`Signing in user: ${username}`);
  return new Promise((resolve, reject) => {
    const userPool = getUserPool();
    if (!userPool) {
      console.error('Cognito not configured');
      reject(new Error('Cognito not configured'));
      return;
    }

    const authenticationDetails = new AuthenticationDetails({
      Username: username,
      Password: password,
    });

    const cognitoUser = new CognitoUser({
      Username: username,
      Pool: userPool,
    });

    console.log("Authenticating user...");
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (session) => {
        console.log("Authentication successful");
        // Store the username in localStorage for debugging
        try {
          localStorage.setItem('lastAuthUser', username);
        } catch (e) {
          console.error("Could not save to localStorage:", e);
        }
        resolve(session);
      },
      onFailure: (err) => {
        console.error("Authentication failed:", err);
        reject(err);
      },
      newPasswordRequired: (userAttributes, requiredAttributes) => {
        console.log("New password required");
        // Handle new password required scenario
        reject(new Error('New password required'));
      },
    });
  });
};

// Sign out the current user
export const signOut = (): void => {
  try {
    console.log("Signing out user");
    const cognitoUser = getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
      console.log("User signed out successfully");
      // Clear any localStorage items
      try {
        localStorage.removeItem('lastAuthUser');
      } catch (e) {
        console.error("Could not clear localStorage:", e);
      }
    } else {
      console.log("No user to sign out");
    }
  } catch (err) {
    console.error("Error signing out:", err);
  }
};

// Get the current session - includes tokens
export const getCurrentSession = (): Promise<CognitoUserSession> => {
  console.log("Getting current session...");
  return new Promise((resolve, reject) => {
    const cognitoUser = getCurrentUser();
    
    if (!cognitoUser) {
      console.error("No current user");
      reject(new Error('No current user'));
      return;
    }

    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err) {
        console.error("Error getting session:", err);
        reject(err);
        return;
      }
      if (!session) {
        console.error("No valid session");
        reject(new Error('No valid session'));
        return;
      }
      console.log("Session retrieved successfully, valid until:", new Date(session.getIdToken().getExpiration() * 1000).toLocaleString());
      resolve(session);
    });
  });
};

// Get JWT token for API calls
export const getToken = async (): Promise<string | null> => {
  try {
    console.log("Getting token...");
    const session = await getCurrentSession();
    const token = session.getIdToken().getJwtToken();
    console.log("Token retrieved successfully");
    return token;
  } catch (error) {
    console.error('Error getting token:', error);
    return null;
  }
}; 