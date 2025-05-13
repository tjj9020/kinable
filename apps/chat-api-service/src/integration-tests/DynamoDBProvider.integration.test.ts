import { DynamoDBProvider } from '../data/DynamoDBProvider';
import { FamilyData, ProfileData } from '@kinable/common-types';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables from .env.dev.remote or similar
// Ensure your .env file has TEST_AWS_REGION, TEST_DYNAMODB_TABLE_FAMILIES, TEST_DYNAMODB_TABLE_PROFILES
dotenv.config({ path: '.env.dev.remote' }); // Adjusted path assuming Jest runs from package root

const TEST_REGION = process.env.TEST_AWS_REGION || 'us-east-2';
const FAMILIES_TABLE_NAME = process.env.TEST_DYNAMODB_TABLE_FAMILIES;
const PROFILES_TABLE_NAME = process.env.TEST_DYNAMODB_TABLE_PROFILES;

describe('DynamoDBProvider Integration Tests', () => {
  let provider: DynamoDBProvider;
  let testFamilyLogicalId: string;
  let testProfileLogicalId: string;
  const userTestRegion = 'us-east-2'; // The region to stamp into the PK, usually user's home region

  beforeAll(() => {
    if (!FAMILIES_TABLE_NAME || !PROFILES_TABLE_NAME) {
      throw new Error(
        'TEST_DYNAMODB_TABLE_FAMILIES and TEST_DYNAMODB_TABLE_PROFILES env vars must be set.'
      );
    }
    // Provider is instantiated to operate against the TEST_REGION (where the stack is deployed)
    provider = new DynamoDBProvider(TEST_REGION); 
  });

  beforeEach(() => {
    // Generate unique IDs for each test run to avoid collisions
    testFamilyLogicalId = `test-fam-${uuidv4()}`;
    testProfileLogicalId = `test-prof-${uuidv4()}`;
  });

  afterEach(async () => {
    // Cleanup data created during tests
    // Use the provider to delete, ensuring regionalized keys are handled correctly
    // Families Table Cleanup
    if (FAMILIES_TABLE_NAME) {
      await provider.deleteItem(
        FAMILIES_TABLE_NAME,
        'familyId',
        testFamilyLogicalId,
        userTestRegion
      );
    }
    // Profiles Table Cleanup
    if (PROFILES_TABLE_NAME) {
      await provider.deleteItem(
        PROFILES_TABLE_NAME,
        'profileId',
        testProfileLogicalId,
        userTestRegion
      );
    }
  });

  describe('Families Table Operations', () => {
    it('should put and get a family item', async () => {
      const familyData: Partial<FamilyData> = {};
      familyData.tokenBalance = 100;
      familyData.pauseStatusFamily = false;
      familyData.primaryRegion = userTestRegion;

      // We pass the logicalId here, provider will add regional prefix
      const itemToPut: FamilyData = { familyId: testFamilyLogicalId, ...familyData } as FamilyData;

      const putResult = await provider.putItem<FamilyData>(
        FAMILIES_TABLE_NAME!,
        itemToPut,
        'familyId',
        userTestRegion
      );
      
      expect(putResult).toBeDefined();
      expect(putResult?.familyId).toBe(`FAMILY#${userTestRegion}#${testFamilyLogicalId}`); // Check regionalized key

      const getResult = await provider.getItem<FamilyData>(
        FAMILIES_TABLE_NAME!,
        'familyId',
        testFamilyLogicalId, // Use logical ID for retrieval
        userTestRegion
      );
      expect(getResult).toBeDefined();
      expect(getResult!.familyId).toBe(`FAMILY#${userTestRegion}#${testFamilyLogicalId}`);
      expect(getResult!.tokenBalance).toBe(100);
    });

    it('should update a family item', async () => {
      const initialFamilyData: FamilyData = { familyId: testFamilyLogicalId } as FamilyData;
      initialFamilyData.tokenBalance = 100;
      initialFamilyData.pauseStatusFamily = false;
      initialFamilyData.primaryRegion = userTestRegion;

      await provider.putItem<FamilyData>(FAMILIES_TABLE_NAME!, initialFamilyData, 'familyId', userTestRegion);

      const updates: Partial<FamilyData> = { tokenBalance: 150, pauseStatusFamily: true };
      const updateResult = await provider.updateItem<FamilyData>(
        FAMILIES_TABLE_NAME!,
        'familyId',
        testFamilyLogicalId,
        updates,
        userTestRegion
      );
      expect(updateResult).toEqual(updates);

      const getResult = await provider.getItem<FamilyData>(
        FAMILIES_TABLE_NAME!,
        'familyId',
        testFamilyLogicalId,
        userTestRegion
      );
      expect(getResult?.tokenBalance).toBe(150);
      expect(getResult?.pauseStatusFamily).toBe(true);
    });

    it('should delete a family item', async () => {
      const familyDataToDelete: FamilyData = { familyId: testFamilyLogicalId } as FamilyData;
      familyDataToDelete.tokenBalance = 50;
      familyDataToDelete.pauseStatusFamily = false;
      familyDataToDelete.primaryRegion = userTestRegion;

      await provider.putItem<FamilyData>(FAMILIES_TABLE_NAME!, familyDataToDelete, 'familyId', userTestRegion);

      const deleteResult = await provider.deleteItem(
        FAMILIES_TABLE_NAME!,
        'familyId',
        testFamilyLogicalId,
        userTestRegion
      );
      expect(deleteResult).toBe(true);

      const getResult = await provider.getItem<FamilyData>(
        FAMILIES_TABLE_NAME!,
        'familyId',
        testFamilyLogicalId,
        userTestRegion
      );
      expect(getResult).toBeNull();
    });

    it('getItem should return null for non-existent family item', async () => {
      const getResult = await provider.getItem<FamilyData>(
        FAMILIES_TABLE_NAME!,
        'familyId',
        'non-existent-logical-id',
        userTestRegion
      );
      expect(getResult).toBeNull();
    });
  });

  describe('Profiles Table Operations', () => {
    // Similar tests for ProfilesTable: putItem, getItem, updateItem, deleteItem
    // Ensure to use 'profileId' as keyAttributeName and 'PROFILE#' prefix logic if applicable
    
    it('should put and get a profile item', async () => {
      const profileData: Partial<ProfileData> = {};
      profileData.familyId = `FAMILY#${userTestRegion}#${testFamilyLogicalId}`;
      profileData.role = 'child';
      profileData.pauseStatusProfile = false;
      profileData.userRegion = userTestRegion;

      const itemToPut: ProfileData = { profileId: testProfileLogicalId, ...profileData } as ProfileData;

      const putResult = await provider.putItem<ProfileData>(
        PROFILES_TABLE_NAME!,
        itemToPut,
        'profileId',
        userTestRegion
      );
      expect(putResult).toBeDefined();
      expect(putResult?.profileId).toBe(`PROFILE#${userTestRegion}#${testProfileLogicalId}`);

      const getResult = await provider.getItem<ProfileData>(
        PROFILES_TABLE_NAME!,
        'profileId',
        testProfileLogicalId,
        userTestRegion
      );
      expect(getResult).toBeDefined();
      expect(getResult!.profileId).toBe(`PROFILE#${userTestRegion}#${testProfileLogicalId}`);
      expect(getResult!.role).toBe('child');
    });
  });

  // TODO: Add tests for provider.query if a simple use case can be set up for Families/Profiles.
  // Querying global tables with regionalized keys in GSIs can be complex to set up generically.
}); 