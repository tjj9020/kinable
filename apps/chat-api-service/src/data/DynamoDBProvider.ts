import { IDatabaseProvider, DatabaseKey } from '@kinable/common-types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export class DynamoDBProvider implements IDatabaseProvider {
  private docClient: DynamoDBDocumentClient;

  constructor(region?: string) {
    const client = new DynamoDBClient({ region: region || process.env.AWS_REGION });
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  async getItem<T extends object>(tableName: string, key: DatabaseKey): Promise<T | null> {
    const params = {
      TableName: tableName,
      Key: key,
    };
    try {
      const { Item } = await this.docClient.send(new GetCommand(params));
      return Item ? Item as T : null;
    } catch (error) {
      console.error(`Error getting item with key ${JSON.stringify(key)} from ${tableName}:`, error);
      // TODO: Implement more sophisticated error handling/logging
      return null;
    }
  }

  async putItem<T extends object>(tableName: string, item: T): Promise<T | null> {
    const params = {
      TableName: tableName,
      Item: item,
    };
    try {
      await this.docClient.send(new PutCommand(params));
      return item; // DynamoDB PutCommand does not return the item by default in v3, so we return the input item
    } catch (error) {
      console.error(`Error putting item into ${tableName}:`, error);
      // TODO: Implement more sophisticated error handling/logging
      return null;
    }
  }

  async updateItem<T extends object>(
    tableName: string,
    key: DatabaseKey,
    updates: Partial<T>
  ): Promise<Partial<T> | null> {
    // This is a simplified update. For production, you'd build UpdateExpression, 
    // ExpressionAttributeNames, and ExpressionAttributeValues carefully.
    let updateExpression = 'set';
    const expressionAttributeValues: Record<string, any> = {};
    const expressionAttributeNames: Record<string, string> = {};
    let first = true;

    for (const property in updates) {
      if (Object.prototype.hasOwnProperty.call(updates, property)) {
        if (!first) {
          updateExpression += ',';
        }
        const attributeKey = `#${property}`;
        const attributeValueKey = `:${property}`;
        updateExpression += ` ${attributeKey} = ${attributeValueKey}`;
        expressionAttributeNames[attributeKey] = property;
        expressionAttributeValues[attributeValueKey] = (updates as any)[property];
        first = false;
      }
    }

    if (Object.keys(expressionAttributeValues).length === 0) {
      console.warn('No updates provided for updateItem.');
      return {}; // Or null, depending on desired behavior for no-op updates
    }

    const params = {
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ReturnValues: 'UPDATED_NEW', // Returns all of the attributes of the item as they appear after the UpdateItem operation
    };

    try {
      const { Attributes } = await this.docClient.send(new UpdateCommand(params));
      return Attributes ? Attributes as Partial<T> : null;
    } catch (error) {
      console.error(`Error updating item with key ${JSON.stringify(key)} in ${tableName}:`, error);
      // TODO: Implement more sophisticated error handling/logging
      return null;
    }
  }

  async deleteItem(tableName: string, key: DatabaseKey): Promise<boolean> {
    const params = {
      TableName: tableName,
      Key: key,
    };
    try {
      await this.docClient.send(new DeleteCommand(params));
      return true;
    } catch (error) {
      console.error(`Error deleting item with key ${JSON.stringify(key)} from ${tableName}:`, error);
      // TODO: Implement more sophisticated error handling/logging
      return false;
    }
  }

  async query<T extends object>(tableName: string, queryParams: any): Promise<T[] | null> {
    // This is a placeholder for a more robust query implementation.
    // Real-world usage would involve constructing KeyConditionExpression, FilterExpression, etc.
    // based on queryParams.
    const params = {
      TableName: tableName,
      ...queryParams, // Directly spreading queryParams is illustrative and might need refinement
    };
    try {
      const { Items } = await this.docClient.send(new QueryCommand(params));
      return Items ? Items as T[] : []; // Return empty array if Items is undefined
    } catch (error) {
      console.error(`Error querying ${tableName}:`, error);
      // TODO: Implement more sophisticated error handling/logging
      return null;
    }
  }
} 