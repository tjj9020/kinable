// Simple script to test DynamoDB table access
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Load environment variables from .env.dev.remote
require('dotenv').config({ path: '.env.dev.remote' });

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
  const dynamoDbConfig = { 
    region: AWS_REGION
  };
  
  if (AWS_PROFILE) {
    console.log(`Using profile: ${AWS_PROFILE}`);
  }
  
  const dynamoDbClient = new DynamoDBClient(dynamoDbConfig);
  const docClient = DynamoDBDocumentClient.from(dynamoDbClient);

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
    if (familiesResult.Items?.length > 0) {
      console.log('First item:', JSON.stringify(familiesResult.Items[0], null, 2));
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
    if (profilesResult.Items?.length > 0) {
      console.log('First item:', JSON.stringify(profilesResult.Items[0], null, 2));
    }
  } catch (error) {
    console.error(`Error accessing Profiles table:`, error);
  }
}

checkTables().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
}); 