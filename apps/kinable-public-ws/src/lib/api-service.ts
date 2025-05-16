import { API_ENDPOINTS } from './api-config';
import { getToken } from './auth-service';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
  requiresAuth?: boolean;
}

// Common API fetch function with auth support
export async function apiFetch<T>(
  endpoint: string, 
  options: ApiOptions = {}
): Promise<T> {
  const {
    method = 'GET',
    body,
    headers = {},
    requiresAuth = true
  } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers
  };

  // Add auth token if required
  if (requiresAuth) {
    const token = await getToken();
    if (!token) {
      throw new Error('Authentication required but no token available');
    }
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  const requestOptions: RequestInit = {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined
  };

  try {
    const response = await fetch(endpoint, requestOptions);
    
    // Handle non-200 responses
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      // throw new Error(errorData.message || `API error: ${response.status}`);
      // Preserve more error details from IApiResponse if possible
      throw { 
        name: 'ApiError',
        status: response.status, 
        message: errorData.message || `API error: ${response.status}`,
        code: errorData.error?.code,
        details: errorData.error?.details
      };
    }
    
    // Parse JSON response
    const responseData = await response.json(); // This will be IApiResponse<T>

    if (responseData.success && responseData.data) {
      return responseData.data as T;
    } else if (!responseData.success && responseData.error) {
      // This case should ideally be caught by !response.ok, but as a fallback:
      throw { 
        name: 'ApiError',
        status: responseData.statusCode, 
        message: responseData.message || 'API returned success:false',
        code: responseData.error.code,
        details: responseData.error.details
      };
    }
    // Fallback if the response structure is not the expected IApiResponse
    throw new Error('Invalid API response structure');

  } catch (error: any) {
    // Re-throw if it's already our structured ApiError
    if (error.name === 'ApiError') {
      throw error;
    }
    // Log and throw a generic error for other fetch-related issues (network, etc.)
    console.error('API request failed (generic catch): ', error);
    throw new Error('API request failed: ' + error.message);
  }
}

// Chat API functions
export interface ChatRequest {
  prompt: string;
  conversationId?: string;
  preferredModel?: string;
}

export interface ChatResponse {
  text: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  meta: {
    provider: string;
    model: string;
    features: string[];
    region: string;
    latency: number;
    timestamp: number;
    conversationId?: string;
  };
}

// Send a chat message and get a response
export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  try {
    console.log(`Sending chat request to: ${API_ENDPOINTS.CHAT}`, request);
    return await apiFetch<ChatResponse>(API_ENDPOINTS.CHAT, {
      method: 'POST',
      body: request,
    });
  } catch (error: any) {
    console.warn('Chat API error in sendChatMessage:', error);
    
    let errorMessage = 'The AI service is temporarily unavailable. Please try again later.';
    
    // Use the message from the structured ApiError if available
    if (error.name === 'ApiError' && error.message) {
        errorMessage = error.message;
        // You could also use error.code or error.details for more specific messages
        if (error.code === 'NO_MODEL_AVAILABLE') {
             errorMessage = 'No AI model is currently available for your request.';
        }
    } else if (error.message && error.message.includes('no_model_available')) { // Fallback for older error structures
      errorMessage = 'No AI model is currently available. The system administrator may need to check the OpenAI API configuration.';
    } else if (error.message && error.message.includes('API error: 503')) {
      errorMessage = 'The AI service is temporarily unavailable (Service Unavailable). Please try again later.';
    }
    
    // Return a mock response for development with error information
    return {
      text: errorMessage,
      tokens: {
        prompt: 5,
        completion: 15,
        total: 20
      },
      meta: {
        provider: 'error-handler',
        model: 'fallback-response',
        features: ['text'],
        region: 'us-east-2',
        latency: 0,
        timestamp: Date.now(),
        conversationId: request.conversationId || 'error-conversation'
      }
    };
  }
}

// Get chat history for a conversation
export async function getChatHistory(conversationId: string): Promise<any> {
  try {
    // Try to get actual chat history from API
    return await apiFetch<any>(`${API_ENDPOINTS.CHAT_HISTORY}?conversationId=${conversationId}`);
  } catch (error) {
    console.warn('Chat history endpoint not available, using mock data:', error);
    // Return mock history for development
    return {
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Hello!',
          timestamp: new Date(Date.now() - 60000).toISOString()
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Hi there! How can I help you today?',
          timestamp: new Date(Date.now() - 55000).toISOString()
        }
      ]
    };
  }
}

// Get token balance - with mock for development
export async function getTokenBalance(): Promise<{ balance: number }> {
  try {
    // Try to get actual balance from API
    return await apiFetch<{ balance: number }>(API_ENDPOINTS.TOKEN_BALANCE);
  } catch (error) {
    console.warn('Token balance endpoint not available, using default value:', error);
    // Return a default value as fallback
    return { balance: 1000 };
  }
}

// Get family profiles
export async function getFamilyProfiles(): Promise<any[]> {
  try {
    // Try to get actual profiles from API
    return await apiFetch<any[]>(API_ENDPOINTS.FAMILY_PROFILES);
  } catch (error) {
    console.warn('Family profiles endpoint not available, using mock data:', error);
    // Return mock profiles for development
    return [
      { id: '1', name: 'Parent Account', role: 'guardian' },
      { id: '2', name: 'Child Account', role: 'child' }
    ];
  }
}

// Get user profile
export async function getUserProfile(): Promise<any> {
  try {
    // Try to get actual profile from API
    return await apiFetch<any>(API_ENDPOINTS.USER_PROFILE);
  } catch (error) {
    console.warn('User profile endpoint not available, using mock data:', error);
    // Return a mock profile for development
    return {
      id: 'user-123',
      name: 'Test User',
      email: 'test@example.com',
      role: 'guardian'
    };
  }
} 