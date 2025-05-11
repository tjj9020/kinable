import { IDatabaseProvider, DatabaseKey, FamilyData, ProfileData } from '@kinable/common-types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

// Define entity prefixes for key construction, aligning with TECH_ROADMAP.md PK structures
const ENTITY_PREFIX = {
  FAMILY: 'FAMILY',
  PROFILE: 'PROFILE',
  // Add other entity prefixes as needed
};

export class DynamoDBProvider implements IDatabaseProvider {
  private docClient: DynamoDBDocumentClient;
  private awsClientRegion: string;

  /**
   * Constructs a DynamoDBProvider.
   * @param awsClientRegion The AWS region this provider instance will primarily interact with (e.g., user's primary write region).
   */
  constructor(awsClientRegion: string) {
    this.awsClientRegion = awsClientRegion || process.env.AWS_REGION || 'us-east-1'; // Fallback if not provided
    const client = new DynamoDBClient({ region: this.awsClientRegion });
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  /**
   * Helper to construct the partition key value for Global Tables.
   * Example: FAMILY#us-east-2#someFamilyId
   */
  private _constructGlobalTableKeyValue(entityPrefix: string, itemRegion: string, logicalId: string): string {
    if (!itemRegion) {
      // This should ideally not happen if userRegion is made mandatory for relevant operations
      console.warn(`itemRegion is missing for ${entityPrefix}#${logicalId}. Falling back to client region: ${this.awsClientRegion}`);
      return `${entityPrefix}#${this.awsClientRegion}#${logicalId}`;
    }
    return `${entityPrefix}#${itemRegion}#${logicalId}`;
  }

  async getItem<T extends object>(
    tableName: string,
    keyAttributeName: string, // e.g., 'familyId' or 'profileId'
    logicalId: string,
    userRegion: string        // User's home region for the item (e.g., 'us-east-2')
  ): Promise<T | null> {
    const entityPrefix = tableName.toLowerCase().includes('families') ? ENTITY_PREFIX.FAMILY : ENTITY_PREFIX.PROFILE;
    const regionalKeyValue = this._constructGlobalTableKeyValue(entityPrefix, userRegion, logicalId);
    const key: DatabaseKey = { [keyAttributeName]: regionalKeyValue };

    const params = {
      TableName: tableName,
      Key: key,
    };
    try {
      const { Item } = await this.docClient.send(new GetCommand(params));
      return Item ? Item as T : null;
    } catch (error) {
      console.error(`Error getting item with key ${JSON.stringify(key)} from ${tableName} in region ${this.awsClientRegion}:`, error);
      return null;
    }
  }

  async putItem<T extends object>(
    tableName: string,
    item: T,
    keyAttributeName: string, // e.g., 'familyId' or 'profileId'
    userRegion: string        // User's home region for the item
  ): Promise<T | null> {
    const logicalId = (item as any)[keyAttributeName];
    if (!logicalId || typeof logicalId !== 'string') {
      console.error(`Logical ID not found or invalid in item for keyAttributeName: ${keyAttributeName}`);
      return null;
    }

    const entityPrefix = tableName.toLowerCase().includes('families') ? ENTITY_PREFIX.FAMILY : ENTITY_PREFIX.PROFILE;
    const regionalKeyValue = this._constructGlobalTableKeyValue(entityPrefix, userRegion, logicalId);

    // Create a new object for storage to avoid mutating the input 'item' directly if it's undesirable.
    // And ensure the key attribute has the regionalized value.
    const itemToStore = {
      ...item,
      [keyAttributeName]: regionalKeyValue,
    } as T; // Cast needed as we are modifying the key structure

    const params = {
      TableName: tableName,
      Item: itemToStore,
    };

    try {
      await this.docClient.send(new PutCommand(params));
      return itemToStore; // Return the item as it was stored (with regionalized key)
    } catch (error) {
      console.error(`Error putting item into ${tableName} in region ${this.awsClientRegion}:`, error);
      return null;
    }
  }

  async updateItem<T extends object>(
    tableName: string,
    keyAttributeName: string,
    logicalId: string,
    updates: Partial<T>,
    userRegion: string
  ): Promise<Partial<T> | null> {
    const entityPrefix = tableName.toLowerCase().includes('families') ? ENTITY_PREFIX.FAMILY : ENTITY_PREFIX.PROFILE;
    const regionalKeyValue = this._constructGlobalTableKeyValue(entityPrefix, userRegion, logicalId);
    const key: DatabaseKey = { [keyAttributeName]: regionalKeyValue };

    // Build UpdateExpression, ExpressionAttributeValues, ExpressionAttributeNames
    let updateExpression = 'set';
    const expressionAttributeValues: Record<string, any> = {};
    const expressionAttributeNames: Record<string, string> = {};
    let first = true;

    for (const property in updates) {
      if (Object.prototype.hasOwnProperty.call(updates, property)) {
        if (property === keyAttributeName) {
          // Prevent updating the primary key attribute itself via this method
          console.warn(`Attempted to update primary key attribute '${property}' in updateItem. Skipping.`);
          continue;
        }
        if (!first) {
          updateExpression += ',';
        }
        const attributeNamePlaceholder = `#${property}`;
        const attributeValuePlaceholder = `:${property}`;
        updateExpression += ` ${attributeNamePlaceholder} = ${attributeValuePlaceholder}`;
        expressionAttributeNames[attributeNamePlaceholder] = property;
        expressionAttributeValues[attributeValuePlaceholder] = (updates as any)[property];
        first = false;
      }
    }

    if (Object.keys(expressionAttributeValues).length === 0) {
      console.warn('No valid updates provided for updateItem.');
      // Return current item or empty object based on desired behavior for no-op updates
      // For simplicity, returning null or an empty object if no actual update happens.
      const currentItem = await this.getItem<T>(tableName, keyAttributeName, logicalId, userRegion);
      return currentItem ? (updates as Partial<T>) : null; // Return original updates if item exists, else null
    }

    const params = {
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ReturnValues: 'UPDATED_NEW' as const,
    };

    try {
      const { Attributes } = await this.docClient.send(new UpdateCommand(params));
      return Attributes ? Attributes as Partial<T> : null;
    } catch (error) {
      console.error(`Error updating item with key ${JSON.stringify(key)} in ${tableName} in region ${this.awsClientRegion}:`, error);
      return null;
    }
  }

  async deleteItem(
    tableName: string,
    keyAttributeName: string,
    logicalId: string,
    userRegion: string
  ): Promise<boolean> {
    const entityPrefix = tableName.toLowerCase().includes('families') ? ENTITY_PREFIX.FAMILY : ENTITY_PREFIX.PROFILE;
    const regionalKeyValue = this._constructGlobalTableKeyValue(entityPrefix, userRegion, logicalId);
    const key: DatabaseKey = { [keyAttributeName]: regionalKeyValue };

    const params = {
      TableName: tableName,
      Key: key,
    };
    try {
      await this.docClient.send(new DeleteCommand(params));
      return true;
    } catch (error) {
      console.error(`Error deleting item with key ${JSON.stringify(key)} from ${tableName} in region ${this.awsClientRegion}:`, error);
      return false;
    }
  }

  async query<T extends object>(tableName: string, queryParams: any): Promise<T[] | null> {
    // Querying Global Tables can be complex if needing to target a specific region's data
    // or dealing with GSIs whose keys might not be regionalized in the same 'ENTITY#region#id' format.
    // This implementation remains basic. For Global Tables, queries often target the local regional
    // replica, and consistency settings become important.
    // If queryParams need to construct regionalized keys for KeyConditionExpressions, that logic
    // would need to be added here or handled by the caller structuring queryParams appropriately.

    const params = {
      TableName: tableName,
      ...queryParams,
    };
    try {
      const { Items } = await this.docClient.send(new QueryCommand(params));
      return Items ? Items as T[] : [];
    } catch (error) {
      console.error(`Error querying ${tableName} in region ${this.awsClientRegion}:`, error);
      return null;
    }
  }
} 