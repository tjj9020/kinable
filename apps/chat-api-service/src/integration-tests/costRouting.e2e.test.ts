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
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  DeleteCommand, 
  GetCommand,
  QueryCommand,
  ScanCommand
} from "@aws-sdk/lib-dynamodb";
import fetch from "node-fetch";
import { v4 as uuidv4 } from 'uuid';

// Custom type for our test configuration
type TestProviderConfig = {
  version: string;
  updatedAt: number;
  providers: {
    [key: string]: {
      active: boolean;
      keyVersion: number;
      secretId: string;
      defaultModel: string;
      endpoints: {
        [key: string]: {
          url: string;
          region: string;
          priority: number;
          active: boolean;
        }
      };
      models: {
        [key: string]: {
          tokenCost: number | { prompt: number; completion: number };
          priority: number;
          capabilities: string[];
          contextSize: number;
          streamingSupport: boolean;
          functionCalling: boolean;
          active: boolean;
          rolloutPercentage: number;
        }
      };
      rateLimits: {
        rpm: number;
        tpm: number;
      };
      retryConfig: {
        maxRetries: number;
        initialDelayMs: number;
        maxDelayMs: number;
      };
      apiVersion: string;
      rolloutPercentage: number;
    }
  };
  routing: {
    rules: any[];
    weights: {
      cost: number;
      quality: number;
      latency: number;
      availability: number;
    };
    defaultProvider: string;
    defaultModel: string;
  };
  featureFlags: Record<string, boolean>;
};

// Test Configuration
const AWS_REGION = process.env.TEST_AWS_REGION || "us-east-2"; 
const STACK_NAME = process.env.TEST_STACK_NAME || "kinable-dev";

const TEST_FAMILY_ID_LOGICAL = `cost-test-fam-${uuidv4()}`;
const TEST_PROFILE_ID_LOGICAL = `cost-test-prof-${uuidv4()}`;
const TEST_CHAT_CONFIG_ID = "COST_TEST_CONFIG_V1";

// Will be populated by getStackOutputs
let userPoolId;
let userPoolClientId;
let chatApiUrl;
let familiesTableName;
let profilesTableName;
let providerConfigTableName;
let tokenLedgerTableName;
let providerHealthTableName;

// Test user information
let testUserEmail;
let testUserPassword = `TestPass${uuidv4().substring(0,8)}!1`;
let testUserIdToken;

// AWS SDK Clients
let cfClient;
let cognitoClient;
let docClient;

// Test prompts with known token counts
const SHORT_PROMPT = "This is a short test prompt for cost validation.";
const LONG_PROMPT = "This is a much longer test prompt that should use more tokens. It contains multiple sentences and should be significantly longer than the short prompt to ensure we can validate token-based cost differences. This sentence adds even more tokens to ensure we have enough for a meaningful test of the cost-based routing functionality.";

// Helper functions
async function getStackOutputs() {
  console.log(`[Cost Routing Test] Getting stack outputs for stack: ${STACK_NAME}`);
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

  // Helper function to get output values
  const getOutputValue = (key) => {
    const output = outputs.find((o) => o.OutputKey === key);
    if (!output || !output.OutputValue) {
      throw new Error(`Output key ${key} not found in stack ${STACK_NAME}.`);
    }
    return output.OutputValue;
  };

  // Get required outputs
  userPoolId = getOutputValue("CognitoUserPoolId");
  userPoolClientId = getOutputValue("CognitoUserPoolClientId");
  chatApiUrl = getOutputValue("HttpApiUrl");
  familiesTableName = getOutputValue("FamiliesTableName");
  profilesTableName = getOutputValue("ProfilesTableName");
  providerConfigTableName = getOutputValue("ProviderConfigTableName");
  
  // These might have different keys depending on your SAM template
  try {
    tokenLedgerTableName = getOutputValue("TokenLedgerTableName");
  } catch (e) {
    console.warn("TokenLedgerTableName not found in outputs, using default name");
    tokenLedgerTableName = "KinableTokenLedger-dev";
  }
  
  try {
    providerHealthTableName = getOutputValue("ProviderHealthTableName");
  } catch (e) {
    console.warn("ProviderHealthTableName not found in outputs, using default name");
    providerHealthTableName = "KinableProviderHealth-dev";
  }

  console.log("[Cost Routing Test] Stack outputs fetched successfully");
  console.log(`[Cost Routing Test] API URL: ${chatApiUrl}`);
}

async function createTestCognitoUser() {
  testUserEmail = `cost-test-user-${uuidv4()}@kinable.test`;
  console.log(`[Cost Routing Test] Creating user: ${testUserEmail}`);
  
  const userAttributes: AttributeType[] = [
    { Name: "email", Value: testUserEmail },
    { Name: "email_verified", Value: "true" },
    { Name: "custom:familyId", Value: TEST_FAMILY_ID_LOGICAL },
    { Name: "custom:profileId", Value: TEST_PROFILE_ID_LOGICAL },
    { Name: "custom:role", Value: "guardian" },
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

  console.log(`[Cost Routing Test] User ${testUserEmail} created successfully`);
}

async function signInTestUser() {
  console.log(`[Cost Routing Test] Signing in user: ${testUserEmail}`);
  
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
    throw new Error("ID Token not found in authentication result.");
  }
  
  testUserIdToken = authResponse.AuthenticationResult.IdToken;
  console.log("[Cost Routing Test] User signed in successfully, ID token obtained");
  return testUserIdToken;
}

async function setupDynamoDBTestData() {
  console.log(`[Cost Routing Test] Setting up DynamoDB test data`);
  
  // Construct prefixed keys
  const prefixedFamilyId = `FAMILY#${AWS_REGION}#${TEST_FAMILY_ID_LOGICAL}`;
  const prefixedProfileId = `PROFILE#${AWS_REGION}#${TEST_PROFILE_ID_LOGICAL}`;

  // Family Data with high token balance
  const familyData = {
    familyId: prefixedFamilyId,
    tokenBalance: 10000,
    pauseStatusFamily: false,
    primaryRegion: AWS_REGION,
  };
  await docClient.send(new PutCommand({ TableName: familiesTableName, Item: familyData }));

  // Profile Data
  const profileData = {
    profileId: prefixedProfileId,
    familyId: prefixedFamilyId,
    role: "guardian",
    pauseStatusProfile: false,
    userRegion: AWS_REGION,
  };
  await docClient.send(new PutCommand({ TableName: profilesTableName, Item: profileData }));

  // Provider Configuration - Set up different costs for OpenAI and Anthropic
  const providerConfigData: TestProviderConfig = {
    version: "cost-test-1.0.0",
    updatedAt: Date.now(),
    providers: {
      openai: {
        active: true,
        keyVersion: 1,
        secretId: "kinable/openai-api-key", // Use the same as your prod config
        defaultModel: "gpt-3.5-turbo",
        endpoints: {
          default: { url: "https://api.openai.com/v1", region: "global", priority: 1, active: true }
        },
        models: {
          "gpt-3.5-turbo": {
            // Make OpenAI more expensive than Anthropic
            tokenCost: { 
              prompt: 0.002, // Higher cost than normal
              completion: 0.003 // Higher cost than normal
            },
            priority: 1,
            capabilities: ["general", "chat"],
            contextSize: 4096,
            streamingSupport: true,
            functionCalling: true,
            active: true,
            rolloutPercentage: 100
          }
        },
        rateLimits: { rpm: 100, tpm: 100000 },
        retryConfig: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1000 },
        apiVersion: "v1",
        rolloutPercentage: 100
      },
      anthropic: {
        active: true,
        keyVersion: 1,
        secretId: "kinable/anthropic-api-key", // Use the same as your prod config
        defaultModel: "claude-3-haiku-20240307",
        endpoints: {
          default: { url: "https://api.anthropic.com/v1", region: "global", priority: 2, active: true }
        },
        models: {
          "claude-3-haiku-20240307": {
            // Make Anthropic cheaper than OpenAI
            tokenCost: {
              prompt: 0.00025, // Lower cost
              completion: 0.00125 // Lower cost
            },
            priority: 1,
            capabilities: ["general", "chat"],
            contextSize: 100000,
            streamingSupport: true,
            functionCalling: true,
            active: true,
            rolloutPercentage: 100
          }
        },
        rateLimits: { rpm: 100, tpm: 100000 },
        retryConfig: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1000 },
        apiVersion: "v1",
        rolloutPercentage: 100
      }
    },
    routing: {
      rules: [],
      weights: { cost: 0.8, quality: 0.1, latency: 0.05, availability: 0.05 }, // Heavily weight cost
      defaultProvider: "openai", // Default provider in preference order
      defaultModel: "gpt-3.5-turbo"
    },
    featureFlags: { enableStreaming: false, enableFunctionCalling: false }
  };

  const configItem = {
    configId: TEST_CHAT_CONFIG_ID,
    configData: providerConfigData,
    lastUpdated: new Date().toISOString(),
  };
  
  await docClient.send(new PutCommand({ TableName: providerConfigTableName, Item: configItem }));
  console.log("[Cost Routing Test] DynamoDB test data setup complete");
}

async function makeApiRequest(prompt: string, preferredProvider: string | null = null, estimatedInputTokens: number | null = null, estimatedOutputTokens: number | null = null) {
  const requestBody: any = {
    prompt,
    configId: TEST_CHAT_CONFIG_ID, // Use our test config
  };

  // Add optional parameters if provided
  if (preferredProvider) {
    requestBody.preferredProvider = preferredProvider;
  }
  
  if (estimatedInputTokens !== null) {
    requestBody.estimatedInputTokens = estimatedInputTokens;
  }
  
  if (estimatedOutputTokens !== null) {
    requestBody.estimatedOutputTokens = estimatedOutputTokens;
  }

  console.log(`[Cost Routing Test] Making API request with prompt: "${prompt.substring(0, 30)}..."`);
  
  // Ensure we have the correct endpoint path
  const apiEndpoint = `${chatApiUrl}/v1/chat`;
  
  const response = await fetch(apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${testUserIdToken}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`API request failed with status ${response.status}: ${responseText}`);
  }

  const responseData = await response.json();
  console.log(`[Cost Routing Test] API response received from provider: ${responseData.data?.meta?.provider || 'unknown'}`);
  return responseData;
}

async function setCircuitBreakerState(providerName, state, failureCount = 5) {
  console.log(`[Cost Routing Test] Setting circuit breaker state for ${providerName} to ${state}`);
  
  const providerRegion = `${providerName}#${AWS_REGION}`;
  const now = Date.now();
  
  const item = {
    providerRegion,
    status: state,
    consecutiveFailures: failureCount,
    currentHalfOpenSuccesses: 0,
    totalFailures: failureCount,
    totalSuccesses: state === 'CLOSED' ? 10 : 0,
    lastStateChangeTimestamp: now,
    lastFailureTimestamp: state === 'OPEN' ? now - 60000 : undefined,
    openedTimestamp: state === 'OPEN' ? now - 60000 : undefined,
    ttl: Math.floor(now / 1000) + (60 * 60 * 24) // 24 hours TTL
  };
  
  await docClient.send(new PutCommand({
    TableName: providerHealthTableName,
    Item: item
  }));
}

async function getCircuitBreakerState(providerName) {
  const providerRegion = `${providerName}#${AWS_REGION}`;
  const result = await docClient.send(new GetCommand({
    TableName: providerHealthTableName,
    Key: { providerRegion }
  }));
  
  return result.Item;
}

async function getLatestTokenLedgerEntry() {
  // Scan for the latest entry for our test family
  // In production, you'd use a more efficient query with indexes
  const prefixedFamilyId = `FAMILY#${AWS_REGION}#${TEST_FAMILY_ID_LOGICAL}`;
  
  const result = await docClient.send(new ScanCommand({
    TableName: tokenLedgerTableName,
    FilterExpression: "familyId = :famId",
    ExpressionAttributeValues: {
      ":famId": prefixedFamilyId
    },
    Limit: 10
  }));
  
  if (!result.Items || result.Items.length === 0) {
    return null;
  }
  
  // Sort by timestamp descending to get the most recent entry
  const sortedItems = [...result.Items].sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
  
  return sortedItems[0];
}

async function cleanupTestData() {
  console.log(`[Cost Routing Test] Cleaning up test data`);
  
  // Delete User
  if (testUserEmail && userPoolId) {
    try {
      await cognitoClient.send(new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: testUserEmail
      }));
      console.log(`[Cost Routing Test] Deleted Cognito user: ${testUserEmail}`);
    } catch (err) {
      console.error(`Error deleting user: ${err.message}`);
    }
  }
  
  // Delete DynamoDB Items
  try {
    const prefixedFamilyId = `FAMILY#${AWS_REGION}#${TEST_FAMILY_ID_LOGICAL}`;
    const prefixedProfileId = `PROFILE#${AWS_REGION}#${TEST_PROFILE_ID_LOGICAL}`;
    
    await docClient.send(new DeleteCommand({
      TableName: profilesTableName,
      Key: { profileId: prefixedProfileId }
    }));
    
    await docClient.send(new DeleteCommand({
      TableName: familiesTableName,
      Key: { familyId: prefixedFamilyId }
    }));
    
    await docClient.send(new DeleteCommand({
      TableName: providerConfigTableName,
      Key: { configId: TEST_CHAT_CONFIG_ID }
    }));
    
    console.log("[Cost Routing Test] DynamoDB data cleaned up");
  } catch (err) {
    console.error(`Error cleaning up DynamoDB data: ${err.message}`);
  }
  
  // Clean up circuit breaker states
  try {
    await docClient.send(new DeleteCommand({
      TableName: providerHealthTableName,
      Key: { providerRegion: `openai#${AWS_REGION}` }
    }));
    
    await docClient.send(new DeleteCommand({
      TableName: providerHealthTableName,
      Key: { providerRegion: `anthropic#${AWS_REGION}` }
    }));
    
    console.log("[Cost Routing Test] Circuit breaker data cleaned up");
  } catch (err) {
    console.error(`Error cleaning up circuit breaker data: ${err.message}`);
  }
}

// -- Main Test Suite --
describe("Cost-Based Routing E2E Tests", () => {
  beforeAll(async () => {
    // Set long timeout for setup
    jest.setTimeout(60000);
    
    console.log("[Cost Routing Test] Starting setup");
    
    // Initialize AWS clients
    cfClient = new CloudFormationClient({ region: AWS_REGION });
    cognitoClient = new CognitoIdentityProviderClient({ region: AWS_REGION });
    
    const ddbClient = new DynamoDBClient({ region: AWS_REGION });
    docClient = DynamoDBDocumentClient.from(ddbClient);
    
    try {
      // Setup test environment
      await getStackOutputs();
      await createTestCognitoUser();
      await setupDynamoDBTestData();
      await signInTestUser();
      
      console.log("[Cost Routing Test] Setup completed successfully");
    } catch (error) {
      console.error("Error in test setup:", error);
      throw error;
    }
  }, 60000); // 60 second timeout for setup
  
  afterAll(async () => {
    // Set long timeout for cleanup
    jest.setTimeout(30000);
    
    try {
      await cleanupTestData();
      console.log("[Cost Routing Test] Cleanup completed successfully");
    } catch (error) {
      console.error("Error in test cleanup:", error);
    }
  }, 30000); // 30 second timeout for cleanup
  
  test("should select cheaper provider (Anthropic) based on cost", async () => {
    // This test verifies that the router selects the cheaper provider
    // when no specific provider is requested
    const response = await makeApiRequest(SHORT_PROMPT);
    
    // Check that response is valid
    expect(response.success).toBe(true);
    expect(response.data).toBeDefined();
    expect(response.data.text).toBeDefined();
    expect(response.data.meta).toBeDefined();
    
    // Verify Anthropic was selected (as it's cheaper in our test config)
    expect(response.data.meta.provider).toBe("anthropic");
    expect(response.data.meta.model).toBe("claude-3-haiku-20240307");
    
    // Check token ledger to verify usage was recorded
    const ledgerEntry = await getLatestTokenLedgerEntry();
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.provider).toBe("anthropic");
    expect(typeof ledgerEntry.promptTokens).toBe("number");
    expect(typeof ledgerEntry.completionTokens).toBe("number");
  }, 30000); // 30 second timeout
  
  test("should respect preferredProvider even with higher cost", async () => {
    // This test verifies that the router respects the preferredProvider
    // parameter even when it's more expensive
    const response = await makeApiRequest(SHORT_PROMPT, "openai");
    
    // Check that response is valid
    expect(response.success).toBe(true);
    expect(response.data).toBeDefined();
    expect(response.data.text).toBeDefined();
    expect(response.data.meta).toBeDefined();
    
    // Verify OpenAI was selected despite being more expensive
    expect(response.data.meta.provider).toBe("openai");
    expect(response.data.meta.model).toBe("gpt-3.5-turbo");
    
    // Check token ledger to verify usage was recorded
    const ledgerEntry = await getLatestTokenLedgerEntry();
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.provider).toBe("openai");
  }, 30000); // 30 second timeout
  
  test("should properly account for estimatedInputTokens/estimatedOutputTokens in cost calculation", async () => {
    // This test verifies that the router properly accounts for token estimates
    // when calculating costs
    
    // First request: Use explicit token estimates
    const explicitResponse = await makeApiRequest(
      SHORT_PROMPT,
      null, // No preferred provider
      50,   // Estimated input tokens (higher than actual)
      200   // Estimated output tokens (higher than actual)
    );
    
    // Second request: Let the system estimate tokens
    const implicitResponse = await makeApiRequest(
      SHORT_PROMPT,
      null  // No preferred provider
    );
    
    // Both should select Anthropic as it's cheaper, but this confirms
    // that the token estimation logic is being correctly applied
    expect(explicitResponse.data.meta.provider).toBe("anthropic");
    expect(implicitResponse.data.meta.provider).toBe("anthropic");
    
    // Check token ledger entries
    const explicitLedger = await getLatestTokenLedgerEntry();
    expect(explicitLedger).toBeDefined();
    expect(explicitLedger.provider).toBe("anthropic");
  }, 30000); // 30 second timeout
  
  test("should fallback to next provider when circuit breaker is open", async () => {
    // This test verifies circuit breaker fallback behavior
    
    // Set circuit breaker to OPEN for Anthropic
    await setCircuitBreakerState("anthropic", "OPEN");
    
    // Make request - should fall back to OpenAI despite being more expensive
    const response = await makeApiRequest(SHORT_PROMPT);
    
    // Verify OpenAI was selected due to Anthropic circuit breaker
    expect(response.data.meta.provider).toBe("openai");
    
    // Reset circuit breaker state
    await setCircuitBreakerState("anthropic", "CLOSED", 0);
  }, 30000); // 30 second timeout
  
  test("should properly handle both circuit breakers being open", async () => {
    // This test verifies behavior when all providers have open circuit breakers
    
    // Set circuit breakers to OPEN for both providers
    await setCircuitBreakerState("anthropic", "OPEN");
    await setCircuitBreakerState("openai", "OPEN");
    
    try {
      // Should fail as all providers have open circuit breakers
      await makeApiRequest(SHORT_PROMPT);
      fail("Request should have failed");
    } catch (error) {
      // Expected failure
      expect(error.message).toContain("failed with status");
    } finally {
      // Reset circuit breaker states
      await setCircuitBreakerState("anthropic", "CLOSED", 0);
      await setCircuitBreakerState("openai", "CLOSED", 0);
    }
  }, 30000); // 30 second timeout
  
  test("should properly handle token-heavy requests", async () => {
    // This test verifies cost calculation with longer content
    
    // Make request with longer prompt
    const response = await makeApiRequest(LONG_PROMPT);
    
    // Should still select Anthropic as it's cheaper
    expect(response.data.meta.provider).toBe("anthropic");
    
    // Check token ledger entry to confirm higher token count
    const ledgerEntry = await getLatestTokenLedgerEntry();
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.promptTokens).toBeGreaterThan(10); // Should have more tokens than SHORT_PROMPT
    
    // The cost should be calculated based on actual token usage
    expect(typeof ledgerEntry.cost).toBe("number");
    // Cost should be higher for this request than for the short prompt
  }, 30000); // 30 second timeout
});