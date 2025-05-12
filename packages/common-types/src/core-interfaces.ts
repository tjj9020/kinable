export interface IUserIdentity {
  userId: string;
  familyId: string | null;
  profileId: string | null;
  role: string; // e.g., 'guardian', 'child', 'admin', 'system'
  isAuthenticated: boolean;
  // Add other relevant claims that might come from the JWT or session
  displayName?: string;
  email?: string;
  region?: string | null; // User's primary region
}

/**
 * Context information for all request handling with tracing
 */
export interface RequestContext {
  requestId: string;        // API Gateway or Lambda request ID
  jwtSub?: string;          // Subject from the JWT
  familyId?: string;        // Family ID from authenticated user
  profileId?: string;       // Profile ID from authenticated user
  region: string;           // Region handling the request
  traceId: string;          // For distributed tracing
}

export interface IApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  statusCode: number;
  error?: {
    code?: string; // e.g., 'VALIDATION_ERROR', 'UNAUTHORIZED'
    details?: unknown;
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
   * Retrieves an item from the specified table by its constructed regional key.
   * @param tableName The name of the table.
   * @param keyAttributeName The name of the primary key attribute (e.g., 'familyId', 'profileId').
   * @param logicalId The logical ID of the item (e.g., the raw familyId or profileId value).
   * @param userRegion The user's home region, used to construct the full regionalized key value.
   * @returns A Promise resolving to the item object if found, or null.
   */
  getItem<T extends object>(
    tableName: string,
    keyAttributeName: string,
    logicalId: string,
    userRegion: string // Made mandatory for clarity for user-specific tables
  ): Promise<T | null>;

  /**
   * Puts (creates or overwrites) an item in the specified table.
   * The primary key value in the 'item' object will be transformed to its regionalized version.
   * @param tableName The name of the table.
   * @param item The item object to put. It should contain the logical ID for the keyAttributeName.
   * @param keyAttributeName The name of the primary key attribute in the item (e.g., 'familyId', 'profileId').
   * @param userRegion The user's home region, used to construct the full regionalized key value.
   * @returns A Promise resolving to the put item (with regionalized key), or null if the operation failed.
   */
  putItem<T extends object>(
    tableName: string,
    item: T, // Item contains logicalId, e.g., item['familyId'] = 'actualFamilyId'
    keyAttributeName: string,
    userRegion: string // Made mandatory
  ): Promise<T | null>;

  /**
   * Updates an existing item in the specified table by its constructed regional key.
   * @param tableName The name of the table.
   * @param keyAttributeName The name of the primary key attribute.
   * @param logicalId The logical ID of the item.
   * @param updates An object containing the attributes to update.
   * @param userRegion The user's home region for key construction.
   * @returns A Promise resolving to the updated item attributes, or null if the operation failed.
   */
  updateItem<T extends object>(
    tableName: string,
    keyAttributeName: string,
    logicalId: string,
    updates: Partial<T>,
    userRegion: string // Made mandatory
  ): Promise<Partial<T> | null>;

  /**
   * Deletes an item from the specified table by its constructed regional key.
   * @param tableName The name of the table.
   * @param keyAttributeName The name of the primary key attribute.
   * @param logicalId The logical ID of the item.
   * @param userRegion The user's home region for key construction.
   * @returns A Promise resolving to true if deletion was successful, false otherwise.
   */
  deleteItem(
    tableName: string,
    keyAttributeName: string,
    logicalId: string,
    userRegion: string // Made mandatory
  ): Promise<boolean>;

  /**
   * Queries a table or an index.
   * Note: Key construction for queries, especially on GSIs, might need specific handling
   * within queryParams or by the provider if regionalized keys are involved in the query conditions.
   * @param tableName The name of the table or index.
   * @param queryParams Parameters for the query.
   * @returns A Promise resolving to an array of items.
   */
  query<T extends object>(
    tableName: string,
    queryParams: unknown // Changed any to unknown - requires type assertion by caller
  ): Promise<T[] | null>;
}

export interface ApiError {
  code: string;
  details?: unknown;
}

export class ApiResponse<T = void> implements IApiResponse<T> {
  success: boolean;
  statusCode: number;
  message?: string;
  data?: T;
  error?: ApiError;

  constructor(success: boolean, statusCode: number, data?: T, message?: string, error?: ApiError) {
    this.success = success;
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
    this.error = error;
  }
}

export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  log(message: string, ...args: unknown[]): void;
}

export type Constructor<T = object> = new (...args: unknown[]) => T; 