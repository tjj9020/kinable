export interface IUserIdentity {
    userId: string;
    familyId: string | null;
    profileId: string | null;
    role: string;
    isAuthenticated: boolean;
    displayName?: string;
    email?: string;
}
export interface IApiError {
    code: string;
    details?: unknown;
}
export interface IApiResponse<T = void> {
    success: boolean;
    statusCode: number;
    message?: string;
    data?: T;
    error?: IApiError;
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
