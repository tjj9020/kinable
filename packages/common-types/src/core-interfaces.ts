export interface IUserIdentity {
  userId: string;
  familyId: string | null;
  profileId: string | null;
  role: string; // e.g., 'guardian', 'child', 'admin', 'system'
  isAuthenticated: boolean;
  // Add other relevant claims that might come from the JWT or session
  displayName?: string;
  email?: string;
}

export interface IApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  statusCode: number;
  error?: {
    code?: string; // e.g., 'VALIDATION_ERROR', 'UNAUTHORIZED'
    details?: any;
  };
} 