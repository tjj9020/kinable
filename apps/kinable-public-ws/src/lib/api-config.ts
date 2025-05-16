/**
 * API Configuration for the Kinable chat application
 * 
 * This file provides API endpoint configurations for different environments.
 * In production, the endpoints are loaded from environment variables.
 * In development, it uses default API endpoints from the deployed service.
 */

// Base API URL by environment
export const getApiBaseUrl = (): string => {
  // For static export builds, we need to use environment variables
  // that are embedded at build time
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  
  if (apiBaseUrl) {
    return apiBaseUrl;
  }
  
  // Fallback to the deployed API Gateway URL
  // This is the URL for the kinable-dev deployment in us-east-2
  return 'https://g9lu74fu91.execute-api.us-east-2.amazonaws.com';
};

// API Endpoints
export const API_ENDPOINTS = {
  // Authentication
  LOGIN: `${getApiBaseUrl()}/auth/login`,
  LOGOUT: `${getApiBaseUrl()}/auth/logout`,
  REFRESH_TOKEN: `${getApiBaseUrl()}/auth/refresh`,
  
  // Chat
  CHAT: `${getApiBaseUrl()}/v1/chat`,
  CHAT_HISTORY: `${getApiBaseUrl()}/v1/chat/history`,
  
  // User Management
  USER_PROFILE: `${getApiBaseUrl()}/dashboard/profile`,
  FAMILY_PROFILES: `${getApiBaseUrl()}/dashboard/profiles`,
  
  // Token Management
  TOKEN_BALANCE: `${getApiBaseUrl()}/v1/billing/balance`,
};

// Cognito Configuration
export const COGNITO_CONFIG = {
  REGION: process.env.NEXT_PUBLIC_COGNITO_REGION || 'us-east-2',
  USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || 'us-east-2_Ye7oEsYr2',
  CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '1oro03jg3a44hkqsfteg6400ot',
}; 