// Mock the AWS SDK modules first
jest.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: jest.fn(() => ({
      config: { region: jest.fn().mockResolvedValue('mock-region') }
    }))
  };
});

jest.mock('@aws-sdk/lib-dynamodb', () => {
  class MockGetCommand { constructor(public input: any) {} }
  class MockPutCommand { constructor(public input: any) {} }
  class MockUpdateCommand { constructor(public input: any) {} }
  class MockDeleteCommand { constructor(public input: any) {} }
  class MockQueryCommand { constructor(public input: any) {} }
  
  const mockSendFn = jest.fn();
  return {
    DynamoDBDocumentClient: {
      from: jest.fn(() => ({ send: mockSendFn })),
    },
    GetCommand: MockGetCommand,
    PutCommand: MockPutCommand,
    UpdateCommand: MockUpdateCommand,
    DeleteCommand: MockDeleteCommand,
    QueryCommand: MockQueryCommand,
  };
});

import { DynamoDBProvider } from './DynamoDBProvider';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Get references to the mocked functions
const mockDynamoDBClientConstructorFn = DynamoDBClient as jest.Mock;
const mockSend = jest.fn();

// Override the send function reference
(DynamoDBDocumentClient.from as jest.Mock).mockImplementation(() => ({ send: mockSend }));

describe('DynamoDBProvider', () => {
  let provider: DynamoDBProvider;
  const testClientRegion = 'us-east-test';
  
  const familiesTableName = 'KinableFamilies-dev';
  const profilesTableName = 'KinableProfiles-dev';
  const familyKeyAttr = 'familyId';
  const profileKeyAttr = 'profileId';
  const logicalFamilyId = 'fam123';
  const logicalProfileId = 'prof456';
  const userRegion = 'us-dev-1'; 

  const expectedFamilyKeyVal = `FAMILY#${userRegion}#${logicalFamilyId}`;
  const expectedProfileKeyVal = `PROFILE#${userRegion}#${logicalProfileId}`;

  beforeEach(() => {
    mockSend.mockReset();
    mockDynamoDBClientConstructorFn.mockClear();
    (DynamoDBDocumentClient.from as jest.Mock).mockClear();
    provider = new DynamoDBProvider(testClientRegion);
  });

  describe('constructor', () => {
    it('should initialize DynamoDBClient with the correct region', () => {
      expect(mockDynamoDBClientConstructorFn).toHaveBeenCalledWith({ region: testClientRegion });
    });

    it('should fallback to process.env.AWS_REGION if no region is provided', () => {
      const originalEnv = process.env.AWS_REGION;
      process.env.AWS_REGION = 'env-region';
      new DynamoDBProvider(undefined as any); 
      expect(mockDynamoDBClientConstructorFn).toHaveBeenCalledWith({ region: 'env-region' });
      process.env.AWS_REGION = originalEnv;
    });

    it('should fallback to us-east-1 if no region and no env var', () => {
      const originalEnv = process.env.AWS_REGION;
      delete process.env.AWS_REGION;
      new DynamoDBProvider(undefined as any);
      expect(mockDynamoDBClientConstructorFn).toHaveBeenCalledWith({ region: 'us-east-1' });
      process.env.AWS_REGION = originalEnv;
    });
  });

  describe('getItem', () => {
    it('should retrieve a family item successfully with regionalized key', async () => {
      const mockItem = { [familyKeyAttr]: expectedFamilyKeyVal, data: 'testData' };
      mockSend.mockResolvedValueOnce({ Item: mockItem });

      const result = await provider.getItem(familiesTableName, familyKeyAttr, logicalFamilyId, userRegion);

      expect(result).toEqual(mockItem);
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetCommand));
      const commandInstance = mockSend.mock.calls[0][0];
      expect(commandInstance.input).toEqual({ TableName: familiesTableName, Key: { [familyKeyAttr]: expectedFamilyKeyVal }, ConsistentRead: true });
    });

    it('should retrieve a profile item successfully with regionalized key', async () => {
      const mockItem = { [profileKeyAttr]: expectedProfileKeyVal, data: 'testData' };
      mockSend.mockResolvedValueOnce({ Item: mockItem });
  
      const result = await provider.getItem(profilesTableName, profileKeyAttr, logicalProfileId, userRegion);
  
      expect(result).toEqual(mockItem);
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetCommand));
      const commandInstance = mockSend.mock.calls[0][0];
      expect(commandInstance.input).toEqual({ TableName: profilesTableName, Key: { [profileKeyAttr]: expectedProfileKeyVal }, ConsistentRead: true });
    });

    it('should return null if item is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const result = await provider.getItem(familiesTableName, familyKeyAttr, 'notfound', userRegion);
      expect(result).toBeNull();
    });

    it('should return null and log error on SDK failure', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSend.mockRejectedValueOnce(new Error('SDK Error'));
      const result = await provider.getItem(familiesTableName, familyKeyAttr, 'errorId', userRegion);
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error getting item with key ${JSON.stringify({[familyKeyAttr]: `FAMILY#${userRegion}#errorId`})} from ${familiesTableName} in region ${testClientRegion}:`, 
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('putItem', () => {
    it('should put a family item successfully with regionalized key and return the transformed item', async () => {
      const itemToPut = { [familyKeyAttr]: logicalFamilyId, data: 'newData' };
      const expectedStoredItem = { [familyKeyAttr]: expectedFamilyKeyVal, data: 'newData' };
      mockSend.mockResolvedValueOnce({}); 

      const result = await provider.putItem(familiesTableName, itemToPut, familyKeyAttr, userRegion);

      expect(result).toEqual(expectedStoredItem);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutCommand));
      const commandInstance = mockSend.mock.calls[0][0];
      expect(commandInstance.input).toEqual({ TableName: familiesTableName, Item: expectedStoredItem });
    });

    it('should return null if logicalId is missing in item', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const itemToPut = { data: 'no id' }; // Missing familyKeyAttr
        const result = await provider.putItem(familiesTableName, itemToPut, familyKeyAttr, userRegion);
        expect(result).toBeNull();
        expect(consoleErrorSpy).toHaveBeenCalledWith(`Logical ID not found or invalid in item for keyAttributeName: ${familyKeyAttr}`);
        consoleErrorSpy.mockRestore();
    });

    it('should return null and log error on SDK failure', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const itemToPut = { [familyKeyAttr]: logicalFamilyId, data: 'failData' };
      mockSend.mockRejectedValueOnce(new Error('SDK Put Error'));
      
      const result = await provider.putItem(familiesTableName, itemToPut, familyKeyAttr, userRegion);
      
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error putting item into ${familiesTableName} in region ${testClientRegion}:`, 
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('updateItem', () => {
    it('should update an item successfully and return updated attributes', async () => {
      const updates = { data: 'updatedData', status: 'active' };
      const mockUpdatedAttributes = { ...updates }; 
      mockSend.mockResolvedValueOnce({ Attributes: mockUpdatedAttributes });

      const result = await provider.updateItem(familiesTableName, familyKeyAttr, logicalFamilyId, updates, userRegion);

      expect(result).toEqual(mockUpdatedAttributes);
      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
      const commandInstance = mockSend.mock.calls[0][0];
      expect(commandInstance.input.Key).toEqual({ [familyKeyAttr]: expectedFamilyKeyVal });
      expect(commandInstance.input.TableName).toEqual(familiesTableName);
      expect(commandInstance.input.ReturnValues).toEqual('UPDATED_NEW');
    });

    it('should skip updating primary key attribute', async () => {
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const updates = { [familyKeyAttr]: 'newLogicalId', data: 'updatedData' };
        // Mock getItem called when only PK is updated
        mockSend.mockResolvedValueOnce({ Item: { [familyKeyAttr]: expectedFamilyKeyVal, data: 'oldData' } }); 
        // Second mock for the update call which should not happen if only PK update is attempted after filtering
        mockSend.mockResolvedValueOnce({ Attributes: {data: 'updatedData'} }); 
  
        await provider.updateItem(familiesTableName, familyKeyAttr, logicalFamilyId, updates, userRegion);
        expect(consoleWarnSpy).toHaveBeenCalledWith(`Attempted to update primary key attribute '${familyKeyAttr}' in updateItem. Skipping.`);
        // Check that the actual update call (if it proceeded) would only have non-PK fields
        const updateCall = mockSend.mock.calls.find(call => call[0] instanceof UpdateCommand);
        if (updateCall) { // if the update went through after filtering PK
            expect(updateCall[0].input.ExpressionAttributeNames).not.toHaveProperty(`#${familyKeyAttr}`);
            expect(updateCall[0].input.ExpressionAttributeValues).not.toHaveProperty(`:${familyKeyAttr}`);
        }
        consoleWarnSpy.mockRestore();
      });

    it('should handle no valid updates provided by calling getItem and returning original updates', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const updates = { [familyKeyAttr]: 'attemptedPKUpdate' }; // only PK update, will be filtered out
      const existingItem = { [familyKeyAttr]: expectedFamilyKeyVal, data: 'existing' }; // This will be returned by getItem
      
      // First call is to getItem because no valid updates are left
      mockSend.mockResolvedValueOnce({ Item: existingItem }); 

      const result = await provider.updateItem(familiesTableName, familyKeyAttr, logicalFamilyId, updates, userRegion);
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(`Attempted to update primary key attribute '${familyKeyAttr}' in updateItem. Skipping.`);
      // The next warning is after the PK attribute is skipped.
      expect(consoleWarnSpy).toHaveBeenCalledWith('No valid updates provided for updateItem.');
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetCommand)); // Verifies getItem was called
      expect(result).toEqual(updates); // Returns original updates as per current logic when item exists
      consoleWarnSpy.mockRestore();
    });

    it('should return null if no valid updates and getItem returns null', async () => {
        mockSend.mockResolvedValueOnce({ Item: null }); // getItem returns null
        const updates = { [familyKeyAttr]: 'attemptedPKUpdate' };
        const result = await provider.updateItem(familiesTableName, familyKeyAttr, logicalFamilyId, updates, userRegion);
        expect(result).toBeNull();
    });
  });

  describe('deleteItem', () => {
    it('should delete an item successfully and return true', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await provider.deleteItem(familiesTableName, familyKeyAttr, logicalFamilyId, userRegion);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteCommand));
      const commandInstance = mockSend.mock.calls[0][0];
      expect(commandInstance.input).toEqual({ TableName: familiesTableName, Key: { [familyKeyAttr]: expectedFamilyKeyVal } });
    });
  });

  describe('query', () => {
    it('should query items successfully and return them', async () => {
      const mockItems = [{ id: 'q1' }, { id: 'q2' }];
      mockSend.mockResolvedValueOnce({ Items: mockItems });
      const queryParams = { KeyConditionExpression: '#pk = :pkval', ExpressionAttributeNames: {'#pk': 'id'}, ExpressionAttributeValues: {':pkval': 'someId'}};
      const result = await provider.query(familiesTableName, queryParams);

      expect(result).toEqual(mockItems);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
      const queryCommandInstance = mockSend.mock.calls[0][0];
      expect(queryCommandInstance.input.TableName).toEqual(familiesTableName);
      expect(queryCommandInstance.input.KeyConditionExpression).toEqual(queryParams.KeyConditionExpression);
    });

    it('should return empty array if query results in no items', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });
      const result = await provider.query(familiesTableName, {});
      expect(result).toEqual([]);
    });

    it('should return null and log error on SDK failure during query', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSend.mockRejectedValueOnce(new Error('SDK Query Error'));
      const result = await provider.query(familiesTableName, {});

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
}); 