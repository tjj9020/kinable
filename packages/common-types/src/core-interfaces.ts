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

export interface IAuthProvider {
  /**
   * Verifies an authentication token and returns the user's identity.
   * @param token The token string (e.g., JWT).
   * @returns A Promise resolving to an IUserIdentity object if the token is valid,
   *          or null (or throws an error) if validation fails.
   */
  verifyToken(token: string): Promise<IUserIdentity | null>;
}

export interface FamilyData {
  familyId: string;         // Partition Key
  tokenBalance: number;
  pauseStatusFamily: boolean;
  // other family-wide settings can be added here
  createdAt?: string;
  updatedAt?: string;
}

export interface ProfileData {
  profileId: string;        // Partition Key
  familyId: string;         // Will be used for a GSI to list profiles per family
  role: 'guardian' | 'child'; // Role within the family
  pauseStatusProfile: boolean;
  displayName?: string;
  // other profile-specific settings
  createdAt?: string;
  updatedAt?: string;
}

// A generic type for key objects, typically used for DynamoDB operations
export type DatabaseKey = Record<string, string | number | boolean>;

export interface IDatabaseProvider {
  /**
   * Retrieves an item from the specified table by its key.
   * @param tableName The name of the table.
   * @param key The key of the item to retrieve.
   * @returns A Promise resolving to the item object if found, or null.
   */
  getItem<T extends object>(tableName: string, key: DatabaseKey): Promise<T | null>;

  /**
   * Puts (creates or overwrites) an item in the specified table.
   * @param tableName The name of the table.
   * @param item The item object to put.
   * @returns A Promise resolving to the put item, or null if the operation failed.
   */
  putItem<T extends object>(tableName: string, item: T): Promise<T | null>;

  /**
   * Updates an existing item in the specified table.
   * This is a simplified version; a more robust one would handle specific update expressions.
   * @param tableName The name of the table.
   *   @param key The key of the item to update.
   * @param updates An object containing the attributes to update.
   * @returns A Promise resolving to the updated item attributes, or null if the operation failed.
   */
  updateItem<T extends object>(
    tableName: string,
    key: DatabaseKey,
    updates: Partial<T> // For now, let's keep it simple with partial updates
                         // More complex scenarios would need UpdateExpression, ConditionExpression, etc.
  ): Promise<Partial<T> | null>; // Returns the updated attributes as confirmed by DB

  /**
   * Deletes an item from the specified table by its key.
   * @param tableName The name of the table.
   * @param key The key of the item to delete.
   * @returns A Promise resolving to true if deletion was successful, false otherwise.
   */
  deleteItem(tableName: string, key: DatabaseKey): Promise<boolean>;

  /**
   * Queries a table or an index.
   * This is a simplified query interface. Real-world scenarios might need more params
   * for sort keys, filters, consistent reads, etc.
   * @param tableName The name of the table or index.
   * @param queryParams Parameters for the query (e.g., key condition expressions, filter expressions).
   *                    For now, this is a placeholder for a more structured query input.
   * @returns A Promise resolving to an array of items.
   */
  query<T extends object>(
    tableName: string,
    queryParams: any // Placeholder for actual query parameters structure
  ): Promise<T[] | null>;
} 