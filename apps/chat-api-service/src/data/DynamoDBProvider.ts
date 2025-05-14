import { IDatabaseProvider, DatabaseKey } from '@kinable/common-types';
// Note: FamilyData and ProfileData types from common-types would be used with the generic T parameter
// when calling these methods, but aren't directly referenced in the implementation.
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
      console.warn(`itemRegion is missing for ${entityPrefix}#${logicalId}. Falling back to client region: ${this.awsClientRegion}`);
      return `${entityPrefix}#${this.awsClientRegion}#${logicalId}`;
    }
    return `${entityPrefix}#${itemRegion}#${logicalId}`;
  }

  // Helper to determine if regional key prefixing should apply
  private _shouldApplyRegionalPrefix(tableName: string): boolean {
    const lowerTableName = tableName.toLowerCase();
    return lowerTableName.includes('families') || lowerTableName.includes('profiles');
  }

  async getItem<T extends object>(
    tableName: string,
    keyAttributeName: string,
    logicalId: string,
    userRegion: string 
  ): Promise<T | null> {
    let keyValue = logicalId;
    if (this._shouldApplyRegionalPrefix(tableName)) {
      const entityPrefix = tableName.toLowerCase().includes('families') ? ENTITY_PREFIX.FAMILY : ENTITY_PREFIX.PROFILE;
      keyValue = this._constructGlobalTableKeyValue(entityPrefix, userRegion, logicalId);
    }
    const key: DatabaseKey = { [keyAttributeName]: keyValue };

    const params = {
      TableName: tableName,
      Key: key,
      ConsistentRead: true, // Ensure strongly consistent reads
    };
    try {
      const { Item } = await this.docClient.send(new GetCommand(params));
      return Item ? Item as T : null;
    } catch (error) {
      console.error(`Error getting item with key ${JSON.stringify(params.Key)} from ${tableName} in region ${this.awsClientRegion}:`, error);
      return null;
    }
  }

  async putItem<T extends object>(
    tableName: string,
    item: T,
    keyAttributeName: string,
    userRegion: string
  ): Promise<T | null> {
    const logicalIdFromItem = (item as any)[keyAttributeName];
    if (!logicalIdFromItem || typeof logicalIdFromItem !== 'string') {
      console.error(`Logical ID not found or invalid in item for keyAttributeName: ${keyAttributeName}`);
      return null;
    }

    let finalKeyValue = logicalIdFromItem;
    // If regional prefixing applies, the logicalIdFromItem is the base ID.
    // The actual key stored (finalKeyValue) will be the prefixed version.
    // The item itself will have its keyAttributeName updated to this finalKeyValue.
    if (this._shouldApplyRegionalPrefix(tableName)) {
      const entityPrefix = tableName.toLowerCase().includes('families') ? ENTITY_PREFIX.FAMILY : ENTITY_PREFIX.PROFILE;
      finalKeyValue = this._constructGlobalTableKeyValue(entityPrefix, userRegion, logicalIdFromItem);
    }

    const itemToStore = {
      ...item,
      [keyAttributeName]: finalKeyValue, // Ensure the item's key field has the final (possibly prefixed) value
    } as T;

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
    let keyValue = logicalId;
    if (this._shouldApplyRegionalPrefix(tableName)) {
      const entityPrefix = tableName.toLowerCase().includes('families') ? ENTITY_PREFIX.FAMILY : ENTITY_PREFIX.PROFILE;
      keyValue = this._constructGlobalTableKeyValue(entityPrefix, userRegion, logicalId);
    }
    const key: DatabaseKey = { [keyAttributeName]: keyValue };

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
    let keyValue = logicalId;
    if (this._shouldApplyRegionalPrefix(tableName)) {
      const entityPrefix = tableName.toLowerCase().includes('families') ? ENTITY_PREFIX.FAMILY : ENTITY_PREFIX.PROFILE;
      keyValue = this._constructGlobalTableKeyValue(entityPrefix, userRegion, logicalId);
    }
    const key: DatabaseKey = { [keyAttributeName]: keyValue };

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