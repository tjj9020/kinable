# Integration Tests

This directory contains integration tests for the Kinable Chat API service. These tests verify the behavior of actual deployed AWS resources and ensure that the components work together correctly in a real environment.

## Prerequisites

Before running these tests, you need:

1. A deployed version of the Kinable Chat API with Cognito User Pool and DynamoDB tables
2. AWS credentials with access to these resources
3. A test user in Cognito with the required custom attributes

## Configuration

Create a `.env.dev.remote` file in the `apps/chat-api-service` directory with the following variables:

```
# Environment variables for integration tests
# Replace these values with actual values from your deployed environment

# Cognito Configuration
TEST_COGNITO_USER_POOL_ID=us-east-2_xxxxxxxx
TEST_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx

# Test User Credentials (a user that exists in your Cognito User Pool)
TEST_USER_USERNAME=test@example.com
TEST_USER_PASSWORD=YourSecurePassword123!

# API Endpoint
TEST_API_ENDPOINT=https://xxxxxxxxxx.execute-api.us-east-2.amazonaws.com/hello

# AWS Configuration
TEST_AWS_REGION=us-east-2
# AWS_PROFILE=kinable-dev

# DynamoDB Tables
TEST_DYNAMODB_TABLE_FAMILIES=KinableFamilies-dev
TEST_DYNAMODB_TABLE_PROFILES=KinableProfiles-dev
```

## Test User Requirements

The test user in Cognito must have the following custom attributes set:

- `custom:familyId`: A valid family ID
- `custom:profileId`: A valid profile ID
- `custom:role`: 'guardian' or 'child'
- `custom:region`: The AWS region (e.g., 'us-east-2')

## Running the Tests

To run all integration tests:

```bash
cd apps/chat-api-service
pnpm test -- auth-db-checks.integration.test.ts
```

To run a specific test file:

```bash
pnpm test -- dynamodb-test.ts
```

## Test Files

- `auth-db-checks.integration.test.ts`: Tests the JWT Authorizer's DynamoDB checks
- `dynamodb-test.ts`: Basic connectivity tests for DynamoDB
- `api-test.ts`: Simple API endpoint tests

## Notes

- These tests interact with actual AWS resources and may incur costs
- They will create and delete test data in your DynamoDB tables
- Failed tests may leave orphaned test data that you'll need to clean up manually 