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
} from "@aws-sdk/client-cognito-identity-provider";
import fetch from "node-fetch"; // Ensure you have node-fetch or use native fetch in Node 18+

// Configuration
const AWS_REGION = "us-east-2";
const AWS_PROFILE = "kinable-dev"; // Ensure this profile is configured in your AWS CLI
const STACK_NAME = "kinable-dev";
const TEST_PROMPT = "Tell me a fun fact about space.";

// Generate a unique username for each test run
const testUserEmail = `testuser-${Date.now()}@kinable.test`;
const testUserPassword = `TestPass${Date.now()}!Ab`;

const cfClient = new CloudFormationClient({ region: AWS_REGION, profile: AWS_PROFILE });
const cognitoClient = new CognitoIdentityProviderClient({
  region: AWS_REGION,
  profile: AWS_PROFILE,
});

let userPoolId;
let userPoolClientId;
let chatApiUrl;

async function getStackOutputs() {
  console.log(`Fetching outputs for stack: ${STACK_NAME}...`);
  try {
    const command = new DescribeStacksCommand({ StackName: STACK_NAME });
    const response = await cfClient.send(command);
    if (!response.Stacks || response.Stacks.length === 0) {
      throw new Error(`Stack ${STACK_NAME} not found.`);
    }
    const outputs = response.Stacks[0].Outputs;
    if (!outputs) {
      throw new Error(`No outputs found for stack ${STACK_NAME}.`);
    }

    userPoolId = outputs.find((o) => o.OutputKey === "CognitoUserPoolId")?.OutputValue;
    userPoolClientId = outputs.find(
      (o) => o.OutputKey === "CognitoUserPoolClientId"
    )?.OutputValue;
    chatApiUrl = outputs.find((o) => o.OutputKey === "ChatRouterApi")?.OutputValue;

    if (!userPoolId || !userPoolClientId || !chatApiUrl) {
      console.error("Missing critical outputs:", { userPoolId, userPoolClientId, chatApiUrl });
      throw new Error(
        "Could not find all required outputs (CognitoUserPoolId, CognitoUserPoolClientId, ChatRouterApi)."
      );
    }
    console.log("Stack outputs retrieved successfully.");
    console.log("  User Pool ID:", userPoolId);
    console.log("  User Pool Client ID:", userPoolClientId);
    console.log("  Chat API URL:", chatApiUrl);
  } catch (error) {
    console.error("Error fetching stack outputs:", error);
    throw error;
  }
}

async function createAndConfirmUser() {
  console.log(`Creating user: ${testUserEmail}...`);
  try {
    const createUserCommand = new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: testUserEmail,
      TemporaryPassword: testUserPassword, // Will be set to permanent next
      UserAttributes: [
        { Name: "email", Value: testUserEmail },
        { Name: "email_verified", Value: "true" }, // Auto-verify for testing ease
        { Name: "custom:familyId", Value: "fam-integ-test" },
        { Name: "custom:profileId", Value: "prof-integ-test" },
        { Name: "custom:role", Value: "guardian" },
        { Name: "custom:region", Value: AWS_REGION },
      ],
      MessageAction: "SUPPRESS", // Don't send welcome email for tests
    });
    await cognitoClient.send(createUserCommand);
    console.log(`User ${testUserEmail} created with temporary password.`);

    const setUserPasswordCommand = new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: testUserEmail,
      Password: testUserPassword,
      Permanent: true,
    });
    await cognitoClient.send(setUserPasswordCommand);
    console.log(`Password for ${testUserEmail} set permanently. User is confirmed.`);
  } catch (error) {
    console.error("Error creating or confirming user:", error);
    throw error;
  }
}

async function signInUser() {
  console.log(`Signing in user: ${testUserEmail}...`);
  try {
    const initiateAuthCommand = new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: userPoolClientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: testUserEmail,
        PASSWORD: testUserPassword,
      },
    });
    const authResponse = await cognitoClient.send(initiateAuthCommand);
    console.log("User signed in successfully.");
    if (!authResponse.AuthenticationResult?.IdToken) {
        throw new Error("ID Token not found in authentication result.");
    }
    return authResponse.AuthenticationResult.IdToken;
  } catch (error) {
    console.error("Error signing in user:", error);
    throw error;
  }
}

async function callChatApi(idToken) {
  console.log(`Calling Chat API: ${chatApiUrl} with prompt: '${TEST_PROMPT}'...`);
  try {
    const response = await fetch(chatApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ prompt: TEST_PROMPT }),
    });

    console.log(`Chat API Status: ${response.status}`);
    const responseBody = await response.json();
    console.log("Chat API Response Body:", JSON.stringify(responseBody, null, 2));

    if (response.status !== 200) {
      throw new Error(`Chat API call failed with status ${response.status}`);
    }
    // Add more assertions here based on expected response structure
    if (!responseBody.text) {
        throw new Error("Chat API response did not contain a .text field");
    }
    console.log("Chat API call successful and response format looks good!");

  } catch (error) {
    console.error("Error calling Chat API:", error);
    throw error;
  }
}

async function cleanupUser() {
    console.log(`Cleaning up user: ${testUserEmail}...`);
    try {
        const deleteUserCommand = new AdminDeleteUserCommand({
            UserPoolId: userPoolId,
            Username: testUserEmail,
        });
        await cognitoClient.send(deleteUserCommand);
        console.log(`User ${testUserEmail} deleted successfully.`);
    } catch (error) {
        console.warn(`Warning: Failed to delete user ${testUserEmail}. Manual cleanup may be required.`, error);
    }
}

async function runIntegrationTest() {
  try {
    await getStackOutputs();
    await createAndConfirmUser();
    const idToken = await signInUser();
    await callChatApi(idToken);
    console.log("\n✅ Integration test completed successfully! ✅");
  } catch (error) {
    console.error("\n❌ Integration test failed: ❌", error.message);
    // No return here, allow finally to run
  } finally {
    if (userPoolId && testUserEmail) { // Ensure these are defined before attempting cleanup
        await cleanupUser();
    } else {
        console.log("Skipping cleanup as user creation might have failed early.");
    }
  }
}

runIntegrationTest(); 