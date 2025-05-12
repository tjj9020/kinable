// Simple script to test DynamoDB table access
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import * as dotenv from 'dotenv';

// Load environment variables from .env.dev.remote
dotenv.config({ path: '.env.dev.remote' });

// Define types for our data
interface FamilyData {
  familyId: string;
  tokenBalance: number;
  primaryRegion: string;
  pauseStatusFamily: boolean;
}

interface ProfileData {
  profileId: string;
  familyId: string;
  role: string;
  userRegion: string;
  pauseStatusProfile: boolean;
}

async function checkTables() {
  // Configuration from environment variables
  const AWS_REGION = process.env.TEST_AWS_REGION || 'us-east-2';
  const AWS_PROFILE = process.env.AWS_PROFILE;
  const DYNAMODB_TABLE_FAMILIES = process.env.TEST_DYNAMODB_TABLE_FAMILIES;
  const DYNAMODB_TABLE_PROFILES = process.env.TEST_DYNAMODB_TABLE_PROFILES;

  console.log('Region:', AWS_REGION);
  console.log('Profile:', AWS_PROFILE);
  console.log('Families Table:', DYNAMODB_TABLE_FAMILIES);
  console.log('Profiles Table:', DYNAMODB_TABLE_PROFILES);

  // Create DynamoDB client
  const dynamoDbConfig: any = { 
    region: AWS_REGION
  };
  
  if (AWS_PROFILE) {
    console.log(`Using profile: ${AWS_PROFILE}`);
  }
  
  const dynamoDbClient = new DynamoDBClient(dynamoDbConfig);
  const docClient = DynamoDBDocumentClient.from(dynamoDbClient);

  // Test data
  const testFamilyId = 'FAMILY#us-east-2#testFamily123';
  const testProfileId = 'PROFILE#us-east-2#testProfile456';
  
  const familyData: FamilyData = {
    familyId: testFamilyId,
    tokenBalance: 1000,
    primaryRegion: 'us-east-2',
    pauseStatusFamily: false
  };
  
  const profileData: ProfileData = {
    profileId: testProfileId,
    familyId: testFamilyId,
    role: 'child',
    userRegion: 'us-east-2',
    pauseStatusProfile: false
  };

  try {
    // Try to write to the Families table
    console.log(`\nTrying to write to ${DYNAMODB_TABLE_FAMILIES}...`);
    await docClient.send(
      new PutCommand({
        TableName: DYNAMODB_TABLE_FAMILIES,
        Item: familyData
      })
    );
    console.log('Success! Wrote test family data to table.');
  } catch (error) {
    console.error(`Error writing to Families table:`, error);
  }
  
  try {
    // Try to write to the Profiles table
    console.log(`\nTrying to write to ${DYNAMODB_TABLE_PROFILES}...`);
    await docClient.send(
      new PutCommand({
        TableName: DYNAMODB_TABLE_PROFILES,
        Item: profileData
      })
    );
    console.log('Success! Wrote test profile data to table.');
  } catch (error) {
    console.error(`Error writing to Profiles table:`, error);
  }

  try {
    // Try to scan the Families table (limit 10 items)
    console.log(`\nTrying to scan ${DYNAMODB_TABLE_FAMILIES}...`);
    const familiesResult = await docClient.send(
      new ScanCommand({
        TableName: DYNAMODB_TABLE_FAMILIES,
        Limit: 10
      })
    );
    console.log(`Success! Found ${familiesResult.Items?.length || 0} items in Families table.`);
    if (familiesResult.Items && familiesResult.Items.length > 0) {
      console.log('First few items:', JSON.stringify(familiesResult.Items.slice(0, 3), null, 2));
    }
  } catch (error) {
    console.error(`Error accessing Families table:`, error);
  }

  try {
    // Try to scan the Profiles table (limit 10 items)
    console.log(`\nTrying to scan ${DYNAMODB_TABLE_PROFILES}...`);
    const profilesResult = await docClient.send(
      new ScanCommand({
        TableName: DYNAMODB_TABLE_PROFILES,
        Limit: 10
      })
    );
    console.log(`Success! Found ${profilesResult.Items?.length || 0} items in Profiles table.`);
    if (profilesResult.Items && profilesResult.Items.length > 0) {
      console.log('First few items:', JSON.stringify(profilesResult.Items.slice(0, 3), null, 2));
    }
  } catch (error) {
    console.error(`Error accessing Profiles table:`, error);
  }
  
  // Cleanup
  try {
    console.log(`\nCleaning up test data...`);
    await docClient.send(
      new DeleteCommand({
        TableName: DYNAMODB_TABLE_FAMILIES,
        Key: { familyId: testFamilyId }
      })
    );
    
    await docClient.send(
      new DeleteCommand({
        TableName: DYNAMODB_TABLE_PROFILES,
        Key: { profileId: testProfileId }
      })
    );
    
    console.log('Cleanup successful!');
  } catch (error) {
    console.error(`Error cleaning up test data:`, error);
  }
}

checkTables().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
}); 