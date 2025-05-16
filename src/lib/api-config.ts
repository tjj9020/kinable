/**
 * API Configuration for the Kinable chat application
 * 
 * This file provides API endpoint configurations for different environments.
 * In production, the endpoints are loaded from environment variables.
 * In development, it uses default local endpoints.
 */

// Base API URL by environment
export const getApiBaseUrl = (): string => {
  // For static export builds, we need to use environment variables
  // that are embedded at build time
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  
  if (apiBaseUrl) {
    return apiBaseUrl;
  }
  
  // Fallback for development
  return 'http://localhost:3000';
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
  USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || 'us-east-2_je1kSGqj1',
  CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '2k8qps7t8rjnccetonjhn1bdrd',
}; 