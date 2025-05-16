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
      throw new Error(errorData.message || `API error: ${response.status}`);
    }
    
    // Parse JSON response
    const data = await response.json();
    return data as T;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
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
    // Try to get actual message from API
    return await apiFetch<ChatResponse>(API_ENDPOINTS.CHAT, {
      method: 'POST',
      body: request,
    });
  } catch (error) {
    console.warn('Chat API not available, using mock response:', error);
    // Return a mock response for development
    return {
      text: `This is a mock response to "${request.prompt}". The actual API endpoint is not available yet.`,
      tokens: {
        prompt: 10,
        completion: 20,
        total: 30
      },
      meta: {
        provider: 'mock',
        model: 'mock-model',
        features: ['text'],
        region: 'us-east-1',
        latency: 500,
        timestamp: Date.now(),
        conversationId: request.conversationId || 'mock-conversation-123'
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