import { DynamoDBProvider } from './DynamoDBProvider';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

// Mock the AWS SDK commands
const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  // Create mock class implementations for each command
  class MockGetCommand {
    constructor(public input: any) {}
  }
  
  class MockPutCommand {
    constructor(public input: any) {}
  }
  
  class MockUpdateCommand {
    constructor(public input: any) {}
  }
  
  class MockDeleteCommand {
    constructor(public input: any) {}
  }
  
  class MockQueryCommand {
    constructor(public input: any) {}
  }

  return {
    DynamoDBDocumentClient: {
      from: jest.fn(() => ({
        send: mockSend,
      })),
    },
    GetCommand: MockGetCommand,
    PutCommand: MockPutCommand,
    UpdateCommand: MockUpdateCommand,
    DeleteCommand: MockDeleteCommand,
    QueryCommand: MockQueryCommand,
  };
});

// Mock the DynamoDBClient
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

describe('DynamoDBProvider', () => {
  let provider: DynamoDBProvider;
  const tableName = 'TestTable';

  beforeEach(() => {
    // Reset mocks before each test
    mockSend.mockReset();
    (DynamoDBDocumentClient.from as jest.Mock).mockClear();
    provider = new DynamoDBProvider('us-east-1'); // Region doesn't matter much for mock
  });

  describe('getItem', () => {
    it('should retrieve an item successfully', async () => {
      const mockItem = { id: '123', data: 'testData' };
      mockSend.mockResolvedValueOnce({ Item: mockItem });

      const result = await provider.getItem(tableName, { id: '123' });

      expect(result).toEqual(mockItem);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
      const getCommandInstance = mockSend.mock.calls[0][0];
      expect(getCommandInstance.input).toEqual({ TableName: tableName, Key: { id: '123' } });
    });

    it('should return null if item is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const result = await provider.getItem(tableName, { id: '404' });
      expect(result).toBeNull();
    });

    it('should return null and log error on SDK failure', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSend.mockRejectedValueOnce(new Error('SDK Error'));
      const result = await provider.getItem(tableName, { id: 'error' });
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('putItem', () => {
    it('should put an item successfully and return the item', async () => {
      const itemToPut = { id: 'new', data: 'newData' };
      // PutCommand in SDK v3 doesn't return the item in the response by default
      // The mockResolvedValueOnce here simulates a successful send operation
      mockSend.mockResolvedValueOnce({}); 

      const result = await provider.putItem(tableName, itemToPut);

      expect(result).toEqual(itemToPut);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
      const putCommandInstance = mockSend.mock.calls[0][0];
      expect(putCommandInstance.input).toEqual({ TableName: tableName, Item: itemToPut });
    });

    it('should return null and log error on SDK failure during put', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const itemToPut = { id: 'fail', data: 'failData' };
      mockSend.mockRejectedValueOnce(new Error('SDK Put Error'));
      
      const result = await provider.putItem(tableName, itemToPut);
      
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('updateItem', () => {
    it('should update an item successfully and return updated attributes', async () => {
      const key = { id: 'updateMe' };
      const updates = { data: 'updatedData', status: 'active' };
      const mockUpdatedAttributes = { ...updates }; // Assuming these are the returned new attributes
      mockSend.mockResolvedValueOnce({ Attributes: mockUpdatedAttributes });

      const result = await provider.updateItem(tableName, key, updates);

      expect(result).toEqual(mockUpdatedAttributes);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
      const updateCommandInstance = mockSend.mock.calls[0][0];
      expect(updateCommandInstance.input.Key).toEqual(key);
      expect(updateCommandInstance.input.TableName).toEqual(tableName);
      expect(updateCommandInstance.input.ReturnValues).toEqual('UPDATED_NEW');
      // More detailed checks for UpdateExpression, ExpressionAttributeValues, ExpressionAttributeNames can be added here
    });

    it('should return null and log error on SDK failure during update', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const key = { id: 'updateFail' };
      const updates = { data: 'nochange' };
      mockSend.mockRejectedValueOnce(new Error('SDK Update Error'));

      const result = await provider.updateItem(tableName, key, updates);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should return empty object if no updates are provided', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const key = { id: 'noUpdate' };
      const updates = {};
      const result = await provider.updateItem(tableName, key, updates);
      expect(result).toEqual({});
      expect(mockSend).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith('No updates provided for updateItem.');
      consoleWarnSpy.mockRestore();
    });
  });

  describe('deleteItem', () => {
    it('should delete an item successfully and return true', async () => {
      mockSend.mockResolvedValueOnce({}); // Successful delete doesn't return specific data
      const key = { id: 'deleteMe' };
      const result = await provider.deleteItem(tableName, key);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
      const deleteCommandInstance = mockSend.mock.calls[0][0];
      expect(deleteCommandInstance.input).toEqual({ TableName: tableName, Key: key });
    });

    it('should return false and log error on SDK failure during delete', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const key = { id: 'deleteFail' };
      mockSend.mockRejectedValueOnce(new Error('SDK Delete Error'));
      const result = await provider.deleteItem(tableName, key);

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('query', () => {
    it('should query items successfully and return them', async () => {
      const mockItems = [{ id: 'q1' }, { id: 'q2' }];
      mockSend.mockResolvedValueOnce({ Items: mockItems });
      const queryParams = { KeyConditionExpression: '#pk = :pkval', ExpressionAttributeNames: {'#pk': 'id'}, ExpressionAttributeValues: {':pkval': 'someId'}};
      const result = await provider.query(tableName, queryParams);

      expect(result).toEqual(mockItems);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
      const queryCommandInstance = mockSend.mock.calls[0][0];
      expect(queryCommandInstance.input.TableName).toEqual(tableName);
      expect(queryCommandInstance.input.KeyConditionExpression).toEqual(queryParams.KeyConditionExpression);
    });

    it('should return empty array if query results in no items', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });
      const result = await provider.query(tableName, {});
      expect(result).toEqual([]);
    });

    it('should return null and log error on SDK failure during query', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSend.mockRejectedValueOnce(new Error('SDK Query Error'));
      const result = await provider.query(tableName, {});

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
}); 