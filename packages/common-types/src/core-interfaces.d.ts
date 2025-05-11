export interface IUserIdentity {
    userId: string;
    familyId: string | null;
    profileId: string | null;
    role: string;
    isAuthenticated: boolean;
    displayName?: string;
    email?: string;
}
export interface IApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    statusCode: number;
    error?: {
        code?: string;
        details?: any;
    };
}
export interface IAuthProvider {
    /**
     * Verifies an authentication token and returns the user's identity.
     * @param token The token string (e.g., JWT).
     * @returns A Promise resolving to an IUserIdentity object if the token is valid,
     *          or null (or throws an error) if validation fails.
     */
    verifyToken(token: string): Promise<IUserIdentity | null>;
}
