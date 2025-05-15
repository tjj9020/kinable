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

// Load environment variables from .env.dev.remote, similar to other integration tests

// --- Test Configuration ---
const AWS_REGION = process.env.TEST_AWS_REGION || "us-east-2"; // Ensure this is consistent
const STACK_NAME = process.env.TEST_STACK_NAME || "kinable-dev"; // Ensure this is your stack name

const TEST_PROMPT = "Hello OpenAI, this is an E2E test. What is 1+1?";
const TEST_FAMILY_ID_LOGICAL = `e2e-fam-${uuidv4()}`;
const TEST_PROFILE_ID_LOGICAL = `e2e-prof-${uuidv4()}`;
const TEST_CHAT_CONFIG_ID = "E2E_TEST_CHAT_CONFIG_V1"; // Config ID for this test

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

  // Provider Configuration Data
  const providerConfigData: ProviderConfiguration = {
    version: "e2e-1.0.0",
    updatedAt: Date.now(),
    providers: {
      openai: {
        active: true,
        keyVersion: 1, // Assuming key version 1, secret should be set up
        endpoints: {
          [AWS_REGION]: { url: "https://api.openai.com/v1", region: AWS_REGION, priority: 1, active: true }
        },
        models: {
          "gpt-3.5-turbo": { // Using a cheaper model for E2E test
            tokenCost: 0.001,
            priority: 1,
            capabilities: ["basic", "function_calling"],
            contextSize: 4096,
            streamingSupport: true,
            functionCalling: true,
            active: true,
            rolloutPercentage: 100,
          }
        },
        rateLimits: { rpm: 100, tpm: 100000 }, // Generous for testing
        retryConfig: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1000 },
        apiVersion: "v1",
        rolloutPercentage: 100,
      }
    },
    routing: {
      rules: [],
      weights: { cost: 1, quality: 0, latency: 0, availability: 0 }, // Simple routing for test
      defaultProvider: "openai",
      defaultModel: "gpt-3.5-turbo",
    },
    featureFlags: { enableStreaming: false, enableFunctionCalling: false },
  };
  const configItem = {
    configId: TEST_CHAT_CONFIG_ID, // This is the key for ProviderConfigTable
    configData: providerConfigData,
    lastUpdated: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: providerConfigTableName, Item: configItem }));
  console.log("[E2E Test] DynamoDB test data setup complete.");
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
    if (providerConfigTableName) await docClient.send(new DeleteCommand({ TableName: providerConfigTableName, Key: { configId: TEST_CHAT_CONFIG_ID } })); // No prefix for this table's key
    console.log("[E2E Test] DynamoDB test data cleaned up.");
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
    if (process.env.AWS_PROFILE) {
      console.log(`[E2E Test ENV DEBUG] Using AWS_PROFILE: ${process.env.AWS_PROFILE} for SDK clients`);
      // The AWS SDK v3 should pick up AWS_PROFILE from the environment automatically.
      // Explicitly setting it via a credentials provider is more complex and usually not needed if the env var is set.
      // We are relying on dotenv to set process.env.AWS_PROFILE and the SDK to pick it up.
    }
    
    cfClient = new CloudFormationClient(clientConfig);
    cognitoClient = new CognitoIdentityProviderClient(clientConfig);
    const ddbClient = new DynamoDBClient(clientConfig);
    docClient = DynamoDBDocumentClient.from(ddbClient);

    await getStackOutputs();
    await createTestCognitoUser();
    testUserIdToken = await signInTestUser();
    await setupDynamoDBTestData();
    console.log("[E2E Test] beforeAll setup complete.");
  }, 120000); // Increased timeout for setup

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
      body: JSON.stringify({ prompt: TEST_PROMPT }),
    });

    console.log(`[E2E Test] Response status: ${response.status}`);
    const responseBody = await response.json();
    console.log("[E2E Test] Response body:", JSON.stringify(responseBody, null, 2));

    expect(response.status).toBe(200);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toBeDefined();
    expect(responseBody.data.text).toBeDefined();
    expect(responseBody.data.text.length).toBeGreaterThan(0);
    expect(responseBody.data.model).toContain("gpt-3.5-turbo"); // Allow for version suffixes
    expect(responseBody.data.provider).toEqual("openai");    // Matches defaultProvider in test config
    expect(responseBody.data.tokenUsage).toBeDefined();
    expect(responseBody.data.tokenUsage.prompt).toBeGreaterThan(0);
    expect(responseBody.data.tokenUsage.completion).toBeGreaterThan(0);
    expect(responseBody.data.tokenUsage.total).toBeGreaterThan(0);

    // Additional check: Ensure the response text isn't just the default "Hello World" or an error message
    expect(responseBody.data.text.toLowerCase()).not.toContain("error");
    expect(responseBody.data.text.toLowerCase()).not.toContain("hello world"); // Placeholder for a more specific check if needed
  });
}); 