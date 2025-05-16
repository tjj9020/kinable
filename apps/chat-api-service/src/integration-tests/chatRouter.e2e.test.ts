import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AdminDeleteUserCommand,
  AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import fetch from "node-fetch"; // Or use native fetch in Node 18+
import { v4 as uuidv4 } from 'uuid';
import { ProviderConfiguration } from "@kinable/common-types"; // Adjust path as needed
import * as https from 'https'; // Added import
import { execSync } from 'child_process'; // Added for running the load script

// Load environment variables from .env.dev.remote, similar to other integration tests

// --- Test Configuration ---
const AWS_REGION = process.env.TEST_AWS_REGION || "us-east-2"; // Ensure this is consistent
const STACK_NAME = process.env.TEST_STACK_NAME || "kinable-dev"; // Ensure this is your stack name

const TEST_PROMPT = "Hello OpenAI, this is an E2E test. What is 1+1?";
const TEST_FAMILY_ID_LOGICAL = `e2e-fam-${uuidv4()}`;
const TEST_PROFILE_ID_LOGICAL = `e2e-prof-${uuidv4()}`;
// const TEST_CHAT_CONFIG_ID = "E2E_TEST_CHAT_CONFIG_V1"; // Config ID for this test - REMOVED

// Will be populated by getStackOutputs
let userPoolId: string;
let userPoolClientId: string;
let chatApiUrl: string;
let familiesTableName: string;
let profilesTableName: string;
let providerConfigTableName: string; // For ProviderConfiguration

let testUserEmail: string;
let testUserPassword = `TestPass${uuidv4().substring(0,10)}!1`;
let testUserIdToken: string;

// AWS SDK Clients - initialized in beforeAll
let cfClient: CloudFormationClient;
let cognitoClient: CognitoIdentityProviderClient;
let docClient: DynamoDBDocumentClient;

// --- Helper Functions (adapted from fullChatFlow.integration.test.mjs and others) ---

async function getStackOutputs() {
  console.log(`[E2E Test] Getting stack outputs for stack: ${STACK_NAME}`);
  const command = new DescribeStacksCommand({ StackName: STACK_NAME });
  const response = await cfClient.send(command);
  const stacks = response.Stacks;
  if (!stacks || stacks.length === 0) {
    throw new Error(`Stack with name ${STACK_NAME} not found.`);
  }
  const outputs = stacks[0].Outputs;
  if (!outputs) {
    throw new Error(`Stack ${STACK_NAME} has no outputs.`);
  }

  const getOutputValue = (key: string) => {
    const output = outputs.find((o) => o.OutputKey === key);
    if (!output || !output.OutputValue) {
      throw new Error(`Output key ${key} not found in stack ${STACK_NAME}. Ensure it's in your SAM template outputs.`);
    }
    return output.OutputValue;
  };

  // These OutputKeys must match exactly what's in your sam.yaml
  userPoolId = getOutputValue("CognitoUserPoolId");
  userPoolClientId = getOutputValue("CognitoUserPoolClientId");
  chatApiUrl = getOutputValue("HttpApiUrl"); // This is often the base URL
  familiesTableName = getOutputValue("FamiliesTableName");
  profilesTableName = getOutputValue("ProfilesTableName");
  providerConfigTableName = getOutputValue("ProviderConfigTableName");

  console.log("[E2E Test] Stack outputs fetched successfully.");
  console.log(`[E2E Test] API URL: ${chatApiUrl}`);
}

async function createTestCognitoUser() {
  testUserEmail = `e2e-user-${uuidv4()}@kinable.test`;
  console.log(`[E2E Test] Creating user: ${testUserEmail} with familyId: ${TEST_FAMILY_ID_LOGICAL}, profileId: ${TEST_PROFILE_ID_LOGICAL}`);
  
  const userAttributes: AttributeType[] = [
    { Name: "email", Value: testUserEmail },
    { Name: "email_verified", Value: "true" },
    { Name: "custom:familyId", Value: TEST_FAMILY_ID_LOGICAL },
    { Name: "custom:profileId", Value: TEST_PROFILE_ID_LOGICAL },
    { Name: "custom:role", Value: "guardian" }, // Or 'child' as needed
    { Name: "custom:region", Value: AWS_REGION },
  ];

  await cognitoClient.send(new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: testUserEmail,
    TemporaryPassword: testUserPassword,
    UserAttributes: userAttributes,
    MessageAction: "SUPPRESS",
  }));
  await cognitoClient.send(new AdminSetUserPasswordCommand({
    UserPoolId: userPoolId,
    Username: testUserEmail,
    Password: testUserPassword,
    Permanent: true,
  }));
  console.log(`[E2E Test] User ${testUserEmail} created and password set permanently.`);
}

async function signInTestUser(): Promise<string> {
  console.log(`[E2E Test] Signing in user: ${testUserEmail}`);
  const authResponse = await cognitoClient.send(new AdminInitiateAuthCommand({
    UserPoolId: userPoolId,
    ClientId: userPoolClientId,
    AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
    AuthParameters: {
      USERNAME: testUserEmail,
      PASSWORD: testUserPassword,
    },
  }));
  if (!authResponse.AuthenticationResult?.IdToken) {
    throw new Error("[E2E Test] ID Token not found in authentication result.");
  }
  console.log("[E2E Test] User signed in successfully, ID token obtained.");
  return authResponse.AuthenticationResult.IdToken;
}

async function setupDynamoDBTestData() {
  console.log(`[E2E Test] Setting up DynamoDB test data for family: ${TEST_FAMILY_ID_LOGICAL}`);
  
  // Construct prefixed keys for tables that require it by DynamoDBProvider
  const prefixedFamilyId = `FAMILY#${AWS_REGION}#${TEST_FAMILY_ID_LOGICAL}`;
  const prefixedProfileId = `PROFILE#${AWS_REGION}#${TEST_PROFILE_ID_LOGICAL}`;

  // Family Data
  const familyData = {
    familyId: prefixedFamilyId, // Use prefixed ID
    tokenBalance: 10000,
    pauseStatusFamily: false,
    primaryRegion: AWS_REGION,
  };
  await docClient.send(new PutCommand({ TableName: familiesTableName, Item: familyData }));

  // Profile Data
  const profileData = {
    profileId: prefixedProfileId, // Use prefixed ID
    familyId: prefixedFamilyId,   // Store the prefixed familyId for consistency if GSI expects it, or adjust GSI data prep if needed
    role: "guardian",
    pauseStatusProfile: false,
    userRegion: AWS_REGION, // This is the actual region of the user, used by authorizer for lookup logic
  };
  await docClient.send(new PutCommand({ TableName: profilesTableName, Item: profileData }));

  // Provider Configuration Data - REMOVED - This will now be handled by load-provider-config.ts script
  // const providerConfigData: ProviderConfiguration = {
  //   version: "e2e-1.0.0",
  //   updatedAt: Date.now(),
  //   providers: {
  //     openai: {
  //       active: true,
  //       keyVersion: 1,
  //       secretId: "kinable-dev-us-east-2-openai-api-key",
  //       endpoints: {
  //         [AWS_REGION]: { url: "https://api.openai.com/v1", region: AWS_REGION, priority: 1, active: true }
  //       },
  //       models: {
  //         "gpt-3.5-turbo": {
  //           inputCost: 0.001,
  //           outputCost: 0.002,
  //           priority: 1,
  //           capabilities: ["basic", "function_calling"],
  //           contextSize: 4096,
  //           streamingSupport: true,
  //           functionCalling: true,
  //           active: true,
  //           rolloutPercentage: 100
  //         }
  //       },
  //       rateLimits: { rpm: 100, tpm: 100000 },
  //       retryConfig: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1000 },
  //       apiVersion: "v1",
  //       rolloutPercentage: 100,
  //       defaultModel: "gpt-3.5-turbo" // Add defaultModel for the provider
  //     }
  //   },
  //   routing: {
  //     rules: [],
  //     weights: { cost: 1, quality: 0, latency: 0, availability: 0 },
  //     providerPreferenceOrder: ["openai"],
  //     defaultModel: "gpt-3.5-turbo",
  //   },
  //   featureFlags: { enableStreaming: false, enableFunctionCalling: false },
  // };
  
  // // Directly store the configData object, not nested inside another object
  // // AWS SDK DocumentClient will automatically convert JS objects to DynamoDB format
  // const configItem = {
  //   configId: TEST_CHAT_CONFIG_ID,
  //   configData: providerConfigData,
  //   lastUpdated: new Date().toISOString(),
  // };
  // await docClient.send(new PutCommand({ TableName: providerConfigTableName, Item: configItem }));
  console.log("[E2E Test] DynamoDB test data setup complete (excluding provider config, handled by script).");
}

async function cleanupTestData() {
  console.log(`[E2E Test] Cleaning up test data...`);
  
  const prefixedFamilyId = `FAMILY#${AWS_REGION}#${TEST_FAMILY_ID_LOGICAL}`;
  const prefixedProfileId = `PROFILE#${AWS_REGION}#${TEST_PROFILE_ID_LOGICAL}`;

  // Delete Cognito User
  if (testUserEmail && userPoolId) {
    try {
      await cognitoClient.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: testUserEmail }));
      console.log(`[E2E Test] Deleted Cognito user: ${testUserEmail}`);
    } catch (error: any) {
      if (error.name !== "UserNotFoundException") {
        console.error(`[E2E Test] Error deleting Cognito user ${testUserEmail}:`, error);
      }
    }
  }
  // Delete DynamoDB Items
  try {
    if (familiesTableName) await docClient.send(new DeleteCommand({ TableName: familiesTableName, Key: { familyId: prefixedFamilyId } }));
    if (profilesTableName) await docClient.send(new DeleteCommand({ TableName: profilesTableName, Key: { profileId: prefixedProfileId } }));
    // if (providerConfigTableName) await docClient.send(new DeleteCommand({ TableName: providerConfigTableName, Key: { configId: TEST_CHAT_CONFIG_ID } })); // REMOVED
    console.log("[E2E Test] DynamoDB test data cleaned up (provider config not deleted by this test).");
  } catch (error) {
    console.error("[E2E Test] Error cleaning up DynamoDB data:", error);
  }
}

// --- Jest Test Suite ---

describe("Chat Router E2E Test", () => {
  beforeAll(async () => {
    console.log("[E2E Test] Starting beforeAll setup...");

    // Log environment variables for diagnostics
    console.log(`[E2E Test ENV DEBUG] process.env.TEST_AWS_REGION: ${process.env.TEST_AWS_REGION}`);
    console.log(`[E2E Test ENV DEBUG] process.env.TEST_STACK_NAME: ${process.env.TEST_STACK_NAME}`);
    console.log(`[E2E Test ENV DEBUG] Resolved AWS_REGION: ${AWS_REGION}`);
    console.log(`[E2E Test ENV DEBUG] Resolved STACK_NAME: ${STACK_NAME}`);
    console.log(`[E2E Test ENV DEBUG] process.env.AWS_PROFILE (raw from env file): ${process.env.AWS_PROFILE}`);

    // Initialize AWS SDK clients
    const clientConfig: any = { region: AWS_REGION };
    // If AWS_PROFILE is set in .env.dev.remote or similar, you might need to configure credentials explicitly for SDK v3
    // e.g., using fromIni() from @aws-sdk/credential-providers
    // For now, assuming default credential chain or instance profile if run in AWS
    
    cfClient = new CloudFormationClient(clientConfig);
    cognitoClient = new CognitoIdentityProviderClient(clientConfig);
    const dynClient = new DynamoDBClient(clientConfig);
    docClient = DynamoDBDocumentClient.from(dynClient);

    await getStackOutputs(); // Fetch API URLs, table names etc.

    // Ensure GLOBAL_AISERVICE_CONFIG_V1 is loaded using the script
    console.log('[E2E Test] Ensuring GLOBAL_AISERVICE_CONFIG_V1 is loaded via script...');
    try {
      // Determine the base path for scripts and config from the current test file directory
      // __dirname is usually .../kinable/apps/chat-api-service/src/integration-tests
      const projectRoot = '../../../../..'; // Relative path from dist/src/integration-tests to project root
      const scriptPath = 'apps/chat-api-service/scripts/load-provider-config.ts';
      const yamlPath = 'apps/chat-api-service/src/config/provider_config.yaml';
      
      // Construct paths relative to where pnpm exec is likely run from (project root)
      const command = `pnpm exec ts-node ${scriptPath} --env=${STACK_NAME} --region=${AWS_REGION} --profile=${process.env.AWS_PROFILE || 'kinable-dev'} --yaml-file=${yamlPath}`;
      
      console.log(`[E2E Test] Executing command: ${command}`);
      execSync(command, { stdio: 'inherit', cwd: projectRoot }); // Run from project root
      console.log('[E2E Test] GLOBAL_AISERVICE_CONFIG_V1 load script executed successfully.');
    } catch (error) {
      console.error('[E2E Test] Failed to execute load-provider-config.ts script:', error);
      // It might be okay if it fails due to already existing item if the script isn't idempotent on conflicts,
      // but for a clean E2E setup, ensuring it can run is good.
      // Depending on script behavior, you might not want to throw here if "already exists" is not a true failure.
      // However, for robust E2E, ensuring the defined YAML is the one in DB is key.
      // The current script overwrites, so it should be fine.
      throw error; 
    }

    await cleanupTestData(); // Clean up any previous test data first (safer)
    await setupDynamoDBTestData(); // Setup user, family, profile data
    testUserIdToken = await signInTestUser();
    
    console.log("[E2E Test] beforeAll setup complete.");
  }, 60000); // Increased timeout for setup

  afterAll(async () => {
    console.log("[E2E Test] Starting afterAll cleanup...");
    await cleanupTestData();
    console.log("[E2E Test] afterAll cleanup complete.");
  }, 60000); // Increased timeout for cleanup

  it("should receive a successful response from the /v1/chat endpoint", async () => {
    if (!testUserIdToken) {
      throw new Error("[E2E Test] ID token not available for chat test.");
    }
    if (!chatApiUrl) {
      throw new Error("[E2E Test] Chat API URL not available for chat test.");
    }

    const fullChatEndpoint = new URL("/v1/chat", chatApiUrl.startsWith("http") ? chatApiUrl : `https://${chatApiUrl}`).href;
    // The ACTIVE_CONFIG_ID for the deployed lambda should be set to TEST_CHAT_CONFIG_ID for this test to work as intended.
    // This test assumes the lambda is configured to use TEST_CHAT_CONFIG_ID.
    // Alternatively, the test user's request could specify which config to use if the API supported it.
    
    // Create an agent to disable keepAlive for this fetch call
    const agent = new https.Agent({ keepAlive: false });

    console.log(`[E2E Test] Sending POST request to: ${fullChatEndpoint}`);
    const response = await fetch(fullChatEndpoint, {
      method: "POST",
      agent: agent, // Use the custom agent
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${testUserIdToken}`,
      },
      body: JSON.stringify({ 
        prompt: TEST_PROMPT,
        preferredModel: "gpt-3.5-turbo" // Explicitly specify the model name that we know exists
      }),
    });

    console.log(`[E2E Test] Response status: ${response.status}`);
    const responseBody = await response.json();
    console.log("[E2E Test] Response body:", JSON.stringify(responseBody, null, 2));

    expect(response.status).toBe(200);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toBeDefined();
    expect(responseBody.data.text).toBeDefined();
    expect(typeof responseBody.data.text).toBe("string");
    expect(responseBody.data.tokenUsage.total).toBeGreaterThan(0);

    // Additional check: Ensure the response text isn't just the default "Hello World" or an error message
    expect(responseBody.data.text.toLowerCase()).not.toContain("error");
    expect(responseBody.data.text.toLowerCase()).not.toContain("hello world"); // Placeholder for a more specific check if needed
  }, 15000); // INCREASED TIMEOUT TO 15 SECONDS

  // Add more tests here for other scenarios (e.g., different models, error cases, moderation)
}); 