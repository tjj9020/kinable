# Kinable AI Chat Application: Project Implementation Plan

## Core Working Agreements & Principles

1.  **Interface-Driven Development**:
    *   We do not depend directly on third-party services or SDKs within our core business logic.
    *   We define interfaces within our application (e.g., `IDatabaseProvider`, `IAuthProvider`, `IAIModelProvider`, `IModerationProvider`, `IBillingProvider`).
    *   Concrete implementations of these interfaces (e.g., `DynamoDBProvider`, `CognitoAuthProvider`, `OpenAIProvider`) will adapt the third-party services.
    *   This allows for easier testing (using mocks/stubs for interfaces) and flexibility in swapping out underlying services. Business logic will only interact with these defined interfaces.
    *   Testing approach: When testing components that use these interfaces, we inject mock implementations that return predictable responses, allowing us to test business logic in isolation without dependencies on external services.

2.  **SOLID Design Principles**:
    *   We adhere strictly to SOLID principles (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion) in all code design and implementation.
    *   Single Responsibility: Each class or module has only one reason to change (e.g., `CognitoAuthProvider` only handles Cognito-specific authentication logic).
    *   Open/Closed: Code should be open for extension but closed for modification (we extend through new interface implementations rather than modifying existing ones).
    *   Liskov Substitution: Objects should be replaceable with instances of their subtypes without altering program correctness (all implementations of interfaces must satisfy the interface contract).
    *   Interface Segregation: No client should be forced to depend on methods it does not use (interfaces are focused and specific to their purpose).
    *   Dependency Inversion: High-level modules depend on abstractions, not implementations (business logic depends on interface contracts, not specific implementations).

2.a **Follow the typescript style guide**:
    * You adhere to the typescript style guide for code organization, naming conventions, etc.
    
3.  **Incremental Changes & Frequent Validation**:
    *   We make small, incremental code changes.
    *   After each logical micro-step, we ensure the code compiles and all relevant unit tests pass. This happens multiple times within each "Step" outlined below.

4.  **Scoped Changes & Discussion**:
    *   We avoid large, repository-wide sweeping changes without prior discussion and agreement. Changes are typically scoped to the current component or service being developed.

5.  **Frequent Commits**:
    *   We commit our code frequently. A commit is made when:
        *   The code compiles successfully.
        *   All relevant unit tests pass.
        *   A defined sub-task within a "Step" of a "Phase" is functionally complete and tested.
    *   Commit messages should be clear and reference the specific Phase and Step (e.g., "Feat(Phase1.2): Implement JWT parsing in Lambda Authorizer").

6.  **Multi-Region Readiness**:
    *   While initially deploying to a single region, we design all resources to be multi-region ready from the start.
    *   We follow region-aware naming conventions: `<env>-<region>-<service>-<purpose>`.
    *   We parameterize all region-specific resource identifiers (no hardcoding).
    *   **DynamoDB Design**:
        *   Partition key *values* will be constructed to incorporate region information (e.g., `FAMILY#<user_region>#<familyId_value>`, `PROFILE#<user_region>#<profileId_value>`). The actual table attribute names for keys remain simple (e.g., `familyId`).
        *   All data operations (reads and especially writes) adhere to **write-locality**: operations for a given user/family occur in their designated "home region" (derived from `custom:region` JWT claim). This prevents cross-region write conflicts and simplifies data consistency.
        *   Our Infrastructure as Code (IaC) approach using SAM for table definitions ensures consistent schemas and keys across regions. This facilitates new region deployments and is a prerequisite for potential future use of DynamoDB Global Tables.
        *   If considering DynamoDB Global Tables in the future, data types will be assessed for replication safety (e.g., eventually consistent chat logs vs. strongly consistent counters which require careful design for active-active replication).
    *   All authorization and data operations remain region-local by default.
    *   Interfaces should be designed to accommodate region-specific implementations or configurations.

## Mock vs. Production Implementation Requirements

To ensure we maintain a clear distinction between mock implementations used for initial development and the production-ready implementations required for completion, we establish the following guidelines:

1. **Implementation Stages**:
   * **Initial Development**: Interface implementations may use mocks or stubs for rapid development and testing.
   * **Completion Requirements**: Before any step is considered complete, all mock implementations must be replaced with real service integrations.

2. **Mock Implementation Guidelines**:
   * All mock implementations must be clearly marked with comments (e.g., `// MOCK: This is a temporary mock implementation`).
   * Mock implementations should closely simulate the behavior of real services, including error conditions.
   * Mock implementations may be used for initial development, unit testing, and interface validation.

3. **Production Implementation Requirements**:
   * **API Providers**: Must use actual SDKs and APIs, not simulated responses:
     * OpenAI provider must use the OpenAI SDK and real API keys from Secrets Manager
     * Anthropic provider must use the Anthropic SDK with actual API authentication
   * **Configuration**: Must use actual AWS services, not in-memory defaults:
     * Configuration must be fetched from and stored in DynamoDB
     * Secrets must be retrieved from AWS Secrets Manager
   * **Database Operations**: Must execute against actual databases:
     * DynamoDB provider must use the AWS SDK to perform real operations
     * Key construction and GSI queries must work with actual tables
   * **Circuit Breakers**: Must persist state in actual data stores:
     * Circuit breaker state must be stored in DynamoDB, not in-memory
     * Health checks must use CloudWatch metrics from real service calls

4. **Testing Requirements**:
   * **Unit Tests**: Focus on isolated logic. Should use mocks/stubs for external dependencies (e.g., AWS SDK, third-party APIs, other internal services not under test) to ensure speed and reliability. Unit tests DO NOT interact with real infrastructure.
   * **Integration Tests**: Verify interactions between components and with real external services or infrastructure (e.g., `DynamoDBProvider` communicating with an actual DynamoDB table, `OpenAIModelProvider` calling the real OpenAI API). These tests will run against test-specific instances or sandboxed environments.
   * **End-to-End (E2E) Tests**: Validate the entire application flow from the user's perspective, using all real services and infrastructure in a deployed environment.
   * **Deployment Verification**: Must include scripts or manual checks to verify real service integrations post-deployment.

5. **Definition of Done Clarification**:
   * No step is considered "COMPLETED" unless all mock implementations have been replaced with production-ready code.
   * Integration tests must validate actual service interactions, not just functional requirements.
   * Documentation must clearly describe connections to real services, not just interface contracts.

This section clarifies that the goal is not just functional implementations with mocks, but fully integrated, production-ready components that work with actual AWS services and third-party APIs.

---

## Phased Implementation Plan

### **Phase 0: Project Setup & AWS Foundation [COMPLETED]**

*   **Step 0.1: Verify Monorepo and Tooling Setup [COMPLETED]**
    *   **Goal**: Ensure the `kinable` monorepo is correctly configured with PNPM workspaces and Turborepo.
    *   **Tasks**:
        *   Review `README.md` for existing setup.
        *   Confirm `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint` commands are working.
        *   Create a new application package directory under `apps/` for our main API (e.g., `apps/chat-api-service`).
        *   Create a new shared package under `packages/` for common types (e.g., `packages/kinable-types`) if not already present. Define initial shared interfaces here (e.g., `IUserIdentity`, `IApiResponse`).
    *   **Definition of Done**: Core build/lint/test commands execute successfully. New service/package directories are created. Initial shared types/interfaces defined.
    *   **Commit Point**: After setup and initial package creation.

*   **Step 0.2: AWS `kinable-dev` Profile & "Hello World" SAM Deployment [COMPLETED]**
    *   **Goal**: Confirm AWS CLI access with the `kinable-dev` profile and successfully deploy a basic "Hello World" Lambda using AWS SAM.
    *   **Tasks**:
        *   Follow `NEW_PROJECT_GUIDE.md` to ensure `kinable-dev` AWS CLI profile is configured and working (`aws sts get-caller-identity --profile kinable-dev`).
        *   Inside `apps/chat-api-service/`, create a minimal SAM application:
            *   `sam.yaml` defining a single Lambda function (e.g., `HelloWorldFunction`) and an API Gateway HTTP API endpoint.
            *   A simple handler (e.g., `src/handlers/hello.ts`) that returns a "Hello World" JSON response.
        *   Implement basic unit tests for the handler.
        *   Deploy using `sam build --profile kinable-dev` and `sam deploy --guided --profile kinable-dev`.
        *   Test the deployed API endpoint.
    *   **Multi-Region Consideration**: 
        *   Ensure resource naming follows region-aware convention (e.g., `KinableHttpApi-${AWS::Region}`).
        *   Parameterize any region-specific configurations.
    *   **Definition of Done**: The "Hello World" Lambda is deployed, unit tests pass, and its API Gateway endpoint returns a successful response.
    *   **Commit Point**: After successful deployment and testing.

---

### **Phase 1: Authentication & Authorization Core**

*   **Step 1.1: Setup Amazon Cognito User Pool (via IaC) [COMPLETED]**
    *   **Goal**: Create a Cognito User Pool to manage family users (guardians and children) using SAM.
    *   **Tasks**:
        *   Define a Cognito User Pool via SAM template (`sam.yaml` in `apps/chat-api-service/`).
            *   Configure standard attributes (email).
            *   Define custom attributes: `familyId` (string), `profileId` (string), `role` (string, e.g., "guardian", "child").
            *   Set up an App Client.
        *   Deploy the changes: `sam deploy --profile kinable-dev`.
        *   Manually create a test guardian user and a test child user in the Cognito console, populating the custom attributes for initial testing.
    *   **Multi-Region Consideration**:
        *   Follow region-aware naming for Cognito resources.
        *   Export Cognito Pool ID and App Client ID as CloudFormation outputs for easy reference.
        *   Add a `region` field to user attributes for future multi-region support.
    *   **Definition of Done**: Cognito User Pool and App Client are created via SAM. Test users exist.
    *   **Commit Point**: After Cognito resources are deployed and test users created.

*   **Step 1.2: Develop Basic Lambda Authorizer with Interfaces [COMPLETED]**
    *   **Goal**: Create a Lambda Authorizer that validates Cognito JWTs and extracts custom claims, using an `IAuthProvider` interface.
    *   **Tasks**:
        *   In `packages/common-types/`, define `IAuthProvider` interface (e.g., `verifyToken(token: string): Promise<IUserIdentity | null>`) and `IUserIdentity` (containing `userId`, `familyId`, `profileId`, `role`, `isAuthenticated`).
        *   Create a `CognitoAuthProvider` implementation of `IAuthProvider` in `apps/chat-api-service/src/auth/`. This class will handle JWT validation against Cognito. Unit test this class with mock JWTs.
        *   Create a new Lambda function (`LambdaAuthorizerFunction`) in `sam.yaml`.
        *   Write the authorizer handler (`src/authorizers/jwtAuthorizer.ts`):
            *   Instantiate `CognitoAuthProvider`.
            *   Use it to verify the token and extract claims.
            *   Return an IAM policy. For now, if `IUserIdentity.isAuthenticated` is true, allow.
        *   Unit test the authorizer handler, mocking `IAuthProvider`.
        *   Update the "Hello World" API Gateway endpoint (from Step 0.2) to use this Lambda Authorizer.
        *   Grant the authorizer Lambda appropriate permissions if it needs to fetch JWKS URI dynamically (prefer passing User Pool ID/Region as env vars).
    *   **Multi-Region Consideration**:
        *   The `LambdaAuthorizerFunction` and its `CognitoAuthProvider` instance are inherently regional, operating against the Cognito User Pool deployed in the same region. Configuration (User Pool ID, Client ID) must be supplied via environment variables derived from regional stack outputs (CloudFormation `!Ref` or `!GetAtt`).
    *   **Definition of Done**: API Gateway endpoint is protected. Valid JWTs grant access; invalid/missing JWTs are denied. `IAuthProvider` and its implementation are unit tested. Authorizer handler is unit tested.
    *   **Commit Point**: After authorizer implementation, testing, and integration with API Gateway.

*   **Step 1.3: Initial DynamoDB Tables & Data Access Interfaces [PARTIALLY COMPLETED - Needs Real Provider Implementation & Integration Testing]**
    *   **Goal**: Create DynamoDB tables for `Families` and `Profiles` via SAM, define data access interfaces, and ensure tables are configured to support DynamoDB Global Table replication. **Update**: Ensure `DynamoDBProvider` uses the real AWS SDK and is integration tested.
    *   **Tasks**:
        *   In `packages/kinable-types/`, define:
            *   `IDatabaseProvider` interface (as updated to accept `keyAttributeName`, `logicalId`, `userRegion`).
            *   Interfaces for `FamilyData` (`familyId`, `tokenBalance`, `pauseStatusFamily`) and `ProfileData` (`profileId`, `familyId`, `role`, `pauseStatusProfile`).
        *   Define two DynamoDB tables in `sam.yaml`: `FamiliesTable`, `ProfilesTable` with initial attributes.
            *   Enable DynamoDB Streams for both tables (`StreamSpecification` with `StreamViewType: NEW_AND_OLD_IMAGES`) as a prerequisite for Global Table configuration.
            *   The primary region for initial deployment and writes will be `us-east-2`.
        *   Deploy SAM changes (for the `us-east-2` region initially).
        *   Create `DynamoDBProvider` implementation of `IDatabaseProvider` in `apps/chat-api-service/src/data/`. **Note**: Initial version might have been unit tested with SDK mocks.
        *   **Pending Task**: Update `DynamoDBProvider` to use the actual AWS SDK for all database operations.
        *   **Pending Task**: Implement and run integration tests for `DynamoDBProvider` against actual DynamoDB tables (in a test environment).
        *   Grant the Lambda Authorizer read access to these tables (GetItem) using their regional ARNs.
        *   Manually populate with dummy data in `us-east-2`, ensuring primary key values use the new region-stamped format (e.g., `FAMILY#us-east-2#someId`).
        *   Note: The actual linking of regional tables into a Global Table (e.g., `us-east-2` with `us-west-2`) may be a post-deployment configuration or a future IaC enhancement. This step focuses on ensuring the *table structure and access patterns* in `us-east-2` support global readiness.
    *   **Multi-Region Consideration**:
        *   This step implements the foundational design for DynamoDB Global Tables. `FamiliesTable` and `ProfilesTable` are configured with streams and region-stamped partition keys (`ENTITY#<user_region>#<id_value>`) to support replication and unique identification across regions. The `DynamoDBProvider` ensures writes are directed to the user's primary regional endpoint (initially `us-east-2`) and data is stamped with its originating region.
    *   **Learnings**:
        *   When mocking AWS SDK v3 in Jest tests, using class-based mocks for command constructors (e.g., `GetCommand`, `PutCommand`) provides more reliable test behavior than trying to re-export from the original module.
        *   Setting test expectations with `expect.any(Object)` instead of specific command types provides more flexible test assertions.
    *   **Definition of Done**: 
        * Tables are created via SAM. 
        * `IDatabaseProvider` and its `DynamoDBProvider` implementation exist. 
        * `DynamoDBProvider` unit tests (using SDK mocks) pass.
        * **Pending**: `DynamoDBProvider` is fully implemented using the real AWS SDK.
        * **Pending**: Integration tests confirm `DynamoDBProvider` correctly interacts with actual DynamoDB tables.
        * Authorizer has IAM permissions.
    *   **Commit Point**: After table creation, interface/implementation development, and testing.

*   **Step 1.4: Enhance Lambda Authorizer with DB Checks via Interfaces [NEEDS REVALIDATION with Real DB Provider]**
    *   **Goal**: Update Lambda Authorizer to use `IDatabaseProvider` to fetch and use `pause_status` and `tokenBalance`. **Update**: Revalidate with a production-ready `DynamoDBProvider`.
    *   **Tasks**:
        *   Modify `jwtAuthorizer.ts`:
            *   Inject/instantiate `DynamoDBProvider` (as `IDatabaseProvider`).
            *   After validating JWT and extracting `profileId` and `familyId` via `IAuthProvider`:
                *   Use `IDatabaseProvider` to fetch profile from `ProfilesTable`.
                *   Use `IDatabaseProvider` to fetch family data from `FamiliesTable`.
                *   Deny access if `pauseStatusProfile` or `pauseStatusFamily` is true.
                *   Deny access if `tokenBalance` is <= 0.
        *   Update unit tests for the authorizer handler, mocking `IAuthProvider` and `IDatabaseProvider`.
        *   Test by setting pause statuses/token balances in DynamoDB and verifying access control via API calls.
        *   **Pending Task**: Re-run integration tests (API calls) after Step 1.3 `DynamoDBProvider` uses the real AWS SDK against actual DynamoDB tables.
    *   **Multi-Region Consideration**:
        *   The `DynamoDBProvider` instance used within the authorizer must be configured for the Lambda's current operational region (e.g., via `process.env.AWS_REGION`).
        *   When fetching data from `FamiliesTable` and `ProfilesTable`, keys must be constructed to include the region identifier if the partition key design incorporates it (e.g., `FAMILY#<region>#<familyId>`). The region for the key should be derived from the user's `custom:region` JWT claim. If the claim is unavailable, the authorizer may need to deny access or default to its own operational region based on clearly defined rules.
        *   Ensure IAM permissions for the authorizer to DynamoDB tables correctly reference the regionally named tables (e.g., using `!Sub` with `${AWS::Region}` in ARNs).
    *   **Definition of Done**: 
        * Authorizer correctly denies access based on data fetched via `IDatabaseProvider` (unit tested with mock provider).
        * **Pending**: Integration tests (API calls) verify proper authorization against actual DynamoDB tables, using the production-ready `DynamoDBProvider` from Step 1.3.
        * All mock implementations for database interaction have been replaced with production-ready code.
    *   **Commit Point**: After authorizer implementation, testing, and integration with API Gateway.

---

### **Phase 2: Core Chat Functionality**

*   **Step 2.1: Develop Chat Router Lambda (Single Model) with Interfaces [PARTIALLY COMPLETED - Critical Mocks in Use for AI Provider & Config]**
    *   **Goal**: Create a Lambda that uses a flexible `IAIModelProvider` interface architecture to send prompts to AI models and return responses. **Update**: Replace mocked AI calls and configuration with real implementations.
    *   **Tasks**:
        *   In `packages/common-types/`, define comprehensive interfaces:
            *   `IAIModelProvider` interface with core methods:
                * `generateResponse(request: AIModelRequest): Promise<AIModelResponse>`
                * `canFulfill(request: AIModelRequest): boolean` for feature detection
                * `getModelCapabilities(modelName: string): ModelCapabilities`
                * `getProviderHealth(): ProviderHealthStatus` for availability monitoring
            *   `AIModelRequest` type with standardized fields:
                * Core: `prompt`, `preferredProvider`, `preferredModel`, `maxTokens`, `temperature`
                * Extensible: `options` dictionary for provider-specific parameters
                * Context: `conversationId`, `profileId`, `familyId`, `userRegion`
                * Routing: `requiredCapabilities`, `maxCostPerToken`, `priority`
            *   `AIModelResponse` type with:
                * Standard: `text`, `tokens.prompt`, `tokens.completion`, `tokens.total`
                * Provider metadata: `provider.name`, `provider.model`, `provider.features`
                * Performance: `latency`, `timestamp`, `region`
        *   Create a robust provider architecture in `apps/chat-api-service/src/ai/`:
            *   `BaseAIModelProvider` abstract class with shared functionality
            *   `OpenAIModelProvider` concrete implementation (initial provider). **Note**: Current implementation uses mocked API calls.
            *   `ConfigurationService` for managing provider configurations. **Note**: Current implementation uses in-memory default config.
            *   **Pending Task**: Update `OpenAIModelProvider` to use the actual OpenAI SDK, making real API calls.
            *   **Pending Task**: Update `ConfigurationService` to fetch configuration from the actual `ProviderConfiguration` DynamoDB table and cache it.
            *   **Pending Task**: Ensure API keys for OpenAI are securely retrieved from AWS Secrets Manager by the `OpenAIModelProvider`.
            *   **Pending Task**: Implement and run integration tests for `OpenAIModelProvider` (real API calls) and `ConfigurationService` (real DynamoDB interaction).
            *   `AIModelRouter` for future provider selection with:
                * Simple initial implementation focused on a single provider
                * Design for future capabilities including failover, cost optimization, feature matching
        *   **Configuration Management System**:
            *   Create a `ProviderConfiguration` DynamoDB table (global table ready)
            *   Schema with version, timestamp, and configuration JSON
            *   Configuration format supporting:
                * Provider availability by region
                * Model capabilities and costs
                * Routing rules and preferences
            *   API for configuration updates with validation
        *   Store provider API keys in AWS Secrets Manager:
            *   Region-specific secret names (e.g., `${AWS::StackName}-${AWS::Region}-openai-api-key`)
            *   Support for key versioning with "current" and "previous" keys
            *   Add IAM permissions with least privilege access
        *   Write handler code (`src/handlers/chatRouter.ts`):
            *   Extract user context from authorizer
            *   Parameter validation and sanitization 
            *   Initially use only one provider but route through the abstraction layer
            *   Detailed error logging with provider-specific information
            *   Region-aware request handling
        *   Unit test the components:
            *   Create mock providers for testing
            *   Test configuration loading and validation
            *   Test provider selection logic
        *   Create a new `/v1/chat` POST endpoint in API Gateway:
            *   Protected by `LambdaAuthorizerFunction`
            *   Configured with appropriate timeouts (30s)
            *   Add CORS headers for web client access
    *   **Multi-Region Considerations**:
        *   Design `IAIModelProvider` to support region-specific model routing
        *   Ensure Secrets Manager keys use region-aware naming pattern
        *   Store provider endpoint latency and availability metrics by region
        *   Design configuration schema to support region-specific settings
    *   **Definition of Done (Initial)**: 
        *   Abstraction layer for multiple providers is in place.
        *   Unit tests (using mocks for OpenAI SDK and DynamoDB) for `OpenAIModelProvider` and `ConfigurationService` pass.
        *   **Pending**: `/v1/chat` endpoint successfully returns AI responses using the real OpenAI API via the updated `OpenAIModelProvider`.
        *   **Pending**: Configuration management system uses the actual `ProviderConfiguration` DynamoDB table, not mock data, via the updated `ConfigurationService`.
        *   **Pending**: API keys are retrieved from AWS Secrets Manager by the `OpenAIModelProvider`.
        *   **Pending**: Integration tests confirm real API communication with OpenAI and real DynamoDB interaction for configuration.
    *   **Commit Point**: After chat router implementation, interface/provider development, and testing.
    *   **Lessons Learned**:
        *   When deploying serverless applications with monorepo workspace dependencies, special care is needed to properly bundle dependencies instead of relying on symlinks which don't work in AWS Lambda.
        *   Custom build scripts can help ensure proper packaging of dependencies.

*   **Step 2.1.1: Initial End-to-End Validation of Chat Router [NEEDS RE-VALIDATION after Step 2.1 is fully implemented]**
    *   **Goal**: Confirm that the deployed `/v1/chat` endpoint is fully functional with real backend services. **Update**: Re-run E2E tests after Step 2.1 uses real AI provider and config service.
    *   **Tasks**:
        *   **Pending Task**: Re-execute E2E tests once `OpenAIModelProvider` uses the real OpenAI API & API key from Secrets Manager, and `ConfigurationService` uses real DynamoDB.
        *   Verify a successful (e.g., HTTP 200) response containing an actual AI-generated text from OpenAI.
    *   **Definition of Done**: A documented successful end-to-end test run, with the `/v1/chat` endpoint returning a valid AI response from the real OpenAI API to an authenticated request, using configuration from the real DynamoDB table. Any issues encountered during the re-test are diagnosed and resolved.

*   **Step 2.2: Add Second AI Provider with Failover Capabilities [IN PROGRESS]**
    *   **Goal**: Extend the AI provider architecture to support a second provider (e.g., Anthropic Claude) with intelligent routing and failover capabilities.
    *   **Tasks**:
        *   Create a second provider implementation:
            *   `AnthropicModelProvider` implementing `IAIModelProvider`
            *   Adapt Anthropic's API to match our standardized interface
            *   Add appropriate error handling and retry logic
        *   Enhance the `AIModelRouter` with:
            *   **Circuit Breaker Pattern**:
                * Track error rates and latency per provider
                * Temporarily disable providers exceeding error thresholds
                * Implement exponential backoff for recovery
                * Store circuit state in DynamoDB for persistence across invocations
            *   **Smart Routing System**:
                * Cost-based routing using request complexity estimation
                * Capability-based provider selection
                * Regional availability and performance-based routing
                * Fallback chains with configurable priorities
        *   Update the configuration schema to support:
            *   Provider prioritization rules
            *   Capability mapping for models
            *   Cost thresholds for routing decisions
            *   Health check parameters
        *   Implement automated health checks:
            *   CloudWatch scheduled Lambda to ping each provider
            *   Status updates to DynamoDB configuration
            *   Alerting via SNS for persistent provider issues
        *   Add monitoring and logging enhancements:
            *   Detailed metrics for each provider (success rate, latency, token usage)
            *   Log provider selection decisions for auditing
            *   Track cost efficiency of routing decisions
        *   Update unit and integration tests:
            *   Test failover scenarios
            *   Validate correct provider selection based on capabilities
            *   Ensure consistent behavior during provider outages
    *   **Multi-Region Considerations**:
        *   Ensure provider health status is tracked per region
        *   Implement region-specific fallback strategies
        *   Test cross-region failover scenarios
    *   **Definition of Done**: 
        *   System successfully routes requests between two real providers (OpenAI and Anthropic, once Anthropic is implemented).
        *   Automatic failover when primary provider is unavailable (tested against real provider health checks).
        *   Circuit breaker state persisted in real DynamoDB, not in-memory.
        *   Cost-based routing working correctly with real-time token costs (from real config).
        *   Health checks using actual provider API calls.
        *   All unit tests (with mocks) and integration/E2E tests (with real services) pass, including simulated outage scenarios.
        *   All mock implementations replaced with production-ready code.
    *   **Commit Point**: After second provider implementation, enhanced routing, and failover testing.
    *   **Partially Completed**:
        *   Basic error handling and retry logic
        *   Multi-region table configuration
        *   Error standardization with proper types

*   **Step 2.3: Basic Moderation Engine Lambda (Pre-Prompt) with Interfaces**
    *   **Goal**: Create a comprehensive content moderation system using an `IModerationProvider` interface to check prompts for inappropriate content before sending to AI models.
    *   **Tasks**:
        *   In `packages/common-types/`, define moderation interfaces:
            *   `IModerationProvider` with methods:
                * `checkText(text: string, options: ModerationOptions): Promise<ModerationResult>`
                * Optional specialized methods: `checkProfanity()`, `checkHarmfulContent()`, `checkPII()`
            *   `ModerationOptions` with:
                * User context: `userId`, `profileId`, `familyId`, `userRegion`
                * Age-appropriate settings: `profileAge`, `strictnessLevel`
                * Custom rules: `customRules[]` for family-specific filtering
            *   `ModerationResult` with:
                * Core: `isFlagged`, `categories: {category: boolean}`, `action: 'allow' | 'filter' | 'block'`
                * Details: `categoryScores`, `filteredText`, `filterReason`
            *   Constants for standard moderation categories (profanity, sexual content, etc.)
        *   Create moderation providers in `apps/chat-api-service/src/moderation/`:
            *   `BaseModerationProvider` abstract class with common functionality
            *   `OpenAIModerationProvider` implementation using OpenAI's moderation API
            *   `CustomRulesModerationProvider` for family-specific rules
            *   `CompositeModerationProvider` to combine multiple providers
        *   Define `ModerationLogTable` in DynamoDB (global table ready):
            *   Schema with `recordId`, `familyId`, `profileId`, `timestamp`, `type`, `region`
            *   GSI on `familyId` and `timestamp` for efficient queries
            *   TTL field for automatic data expiration
        *   Write moderation handler code (`src/handlers/moderationEngine.ts`):
            *   Initialize appropriate moderation providers
            *   Apply age-appropriate filtering rules based on profile age
            *   Log moderation events to DynamoDB
            *   Return both verdict and filtered version when possible
        *   Unit test moderation components:
            *   Test with known problematic content
            *   Test age-appropriate filtering levels
            *   Test filter generation capabilities
        *   Integrate with `ChatRouterFunction`:
            *   Call moderation before sending to AI provider
            *   Handle moderation responses (block, filter, or allow)
            *   Log moderation events
        *   Update `ChatRouterFunction` unit tests
    *   **Multi-Region Considerations**:
        *   Moderation logs include region information
        *   Support region-specific moderation rules
        *   Design for low-latency moderation in each region
    *   **Definition of Done**: 
        *   Prompts are moderated via interfaces before reaching AI models using real moderation APIs
        *   Content is filtered or blocked based on moderation results from actual services
        *   Family-specific and age-appropriate filtering works correctly
        *   Moderation events are logged to real DynamoDB tables with region information
        *   Tests validate moderation effectiveness across different content types
        *   No mock implementations remain in the production code
    *   **Commit Point**: After moderation implementation for prompts, testing.

*   **Step 2.4: Moderation Engine Lambda (Post-Response) via Interfaces**
    *   **Goal**: Extend the moderation system to check AI responses, ensuring all content delivered to users meets safety and appropriateness standards.
    *   **Tasks**:
        *   Enhance `ChatRouterFunction`:
            *   Implement two-phase moderation (pre-prompt and post-response)
            *   Add configuration for different moderation strategies per model
            *   Handle different response types (filter vs. block) for AI-generated content
        *   Improve moderation logging:
            *   Log both prompt and response moderation events
            *   Include relevant metadata (source model, category scores, etc.)
            *   Implement mechanism to report false positives
        *   Add response sanitization capabilities:
            *   Use LLM-based content rewriting for borderline cases
            *   Implement word/phrase replacement for simple cases
            *   Add warnings to filtered responses
        *   Enhance error handling for moderation failures:
            *   Implement fallback strategies when moderation service is unavailable
            *   Define risk-based policy for handling moderation timeouts
        *   Update tests:
            *   Test end-to-end flow with problematic prompts and responses
            *   Verify correct handling of edge cases
            *   Measure and optimize moderation latency
        *   Create monitoring dashboard:
            *   Track moderation events by category and region
            *   Monitor false positive rates
            *   Alert on unusual patterns
    *   **Multi-Region Considerations**:
        *   Ensure consistent moderation standards across regions
        *   Support region-specific logging and monitoring
        *   Optimize for minimal latency impact in each region
    *   **Definition of Done**: 
        *   AI responses are moderated using the same framework as prompts
        *   Flagged content is appropriately handled based on severity
        *   Both prompt and response moderation events are properly logged with region context
        *   Performance impact is minimized
        *   End-to-end tests validate the complete flow
    *   **Commit Point**: After moderation implementation for responses, testing.

*   **Step 2.5: Monitoring, Observability, and DevOps**
    *   **Goal**: Implement comprehensive monitoring, alerting, and operational tools for the chat functionality with multi-region support.
    *   **Tasks**:
        *   Set up structured logging:
            *   Configure JSON-formatted logs with consistent fields
            *   Include request IDs, user IDs, region information, and timing data
            *   Log appropriate request/response data (respecting privacy)
        *   Create CloudWatch dashboards:
            *   API latency by endpoint, provider, and region
            *   Error rates by type, provider, and region
            *   Token usage by family, profile, and region
            *   Moderation events by category and region
            *   Provider availability and performance metrics
        *   Implement alerting:
            *   Set up alarms for elevated error rates
            *   Create alerts for provider availability issues
            *   Monitor Lambda concurrency and throttling
            *   Detect regional performance degradation
        *   Performance metrics collection:
            *   Track providers' response times by region
            *   Measure token efficiency
            *   Monitor cold start frequencies
            *   Compare provider performance across regions
        *   Cost tracking:
            *   Tag all resources for detailed cost allocation
            *   Track per-provider API costs
            *   Implement cost anomaly detection
            *   Compare cost efficiency across providers
        *   Set up operational tools:
            *   Create scripts for provider health checks
            *   Implement automated testing of production endpoints
            *   Develop tools for managing provider API keys
            *   Build dashboards for monitoring multi-region performance
    *   **Multi-Region Considerations**:
        *   Create both region-specific and global dashboards
        *   Implement cross-region performance comparison
        *   Set up alerting for regional availability issues
        *   Develop tooling for managing configuration across regions
    *   **Definition of Done**: 
        *   Complete observability solution is in place for all regions
        *   Alerts trigger appropriately for region-specific and global error conditions
        *   Dashboards provide clear visibility into system health across regions
        *   Operational tools simplify multi-region maintenance tasks
    *   **Commit Point**: After monitoring and observability implementation.

## Phase 2 Implementation Decisions

The following decisions establish the technical architecture, design patterns, and acceptance criteria for the Phase 2 AI Provider system. These specifications serve as our engineering contract for implementation.

### 1. Interface Design & Error Handling

#### 1.1 Result & Error Types
```typescript
// Standard Success Response
export interface AIModelSuccess {
  ok: true
  text: string
  tokens: { prompt: number; completion: number; total: number }
  meta: ProviderMeta
  stream?: AsyncIterable<string>      // present if streaming enabled
  toolResult?: ToolResult            // present if function calling used
}

// Standard Error Response
export interface AIModelError {
  ok: false
  code: 'RATE_LIMIT' | 'AUTH' | 'CONTENT' | 'CAPABILITY' | 'TIMEOUT' | 'UNKNOWN'
  provider: string
  status?: number                    // HTTP / SDK status if available
  retryable: boolean
  detail?: string                    // provider-specific message
}
```

**Error Standardization Decisions:**
- All provider-specific errors must map to one of the five standard error codes
- Provider-specific details should be included in the `detail` field 
- New error types require a minor version bump (v1.1) and adapter updates
- Error responses include a `retryable` flag to signal whether retry is appropriate

#### 1.2 Streaming vs Non-Streaming Support
- All requests include a `streaming: boolean` flag
- Providers must implement both modes when possible
- If streaming isn't supported, return a `CAPABILITY` error and downgrade to non-streaming
- Router will log capability misses for future provider selection optimization

#### 1.3 Function-Calling / Tools Support
- Optional `tools?: ToolCall[]` in request
- Function-calling capable providers handle and return structured results
- Non-supporting providers return `CAPABILITY` error with fallback to text models if allowed

### 2. Provider Implementation Architecture

#### 2.1 Authentication & Secrets Management
- Store API keys in AWS Secrets Manager as JSON with both current and previous keys:
  ```
  ${stage}/${region}/${provider}/api-key
  {"current": "key1", "previous": "key0"}
  ```
- Automatic key rotation every 30 days:
  1. Move `current` to `previous`
  2. Generate new key and test 
  3. Update `current` when verified
- Providers use dual-key strategy, trying current key first, then previous on 401 errors

#### 2.2 Rate Limiting Strategy
- Each provider exposes standard `ProviderLimits { rpm: number; tpm: number }`
- Two-level token bucket implementation:
  1. In-memory bucket per Lambda instance to handle normal traffic
  2. DynamoDB rate counter with 1-second TTL to manage cross-instance bursts
- Retry with exponential backoff (250ms → 4s) for rate limit errors

#### 2.3 Provider Initialization
- Lazy-load provider SDKs on first invocation to minimize cold start impact
- Cache client in module scope for reuse across invocations
- Use provisioned concurrency for ChatRouter Lambda in production

### 3. Smart Routing System

#### 3.1 Routing Decision Algorithm
| Factor | Weight | Description |
|--------|--------|-------------|
| Cost | 0.4 | Real-time token cost from configuration |
| Quality | 0.3 | Capability rating (1-5 scale) for required capabilities |
| Latency | 0.2 | Exponentially weighted moving average of P95 latency |
| Availability | 0.1 | Health status from circuit breaker |

- Weighted scoring selects the best provider; if score < 0.6, fallback chain executes
- All routing decisions logged to Kinesis for analysis and optimization

#### 3.2 Circuit Breaker Implementation
- State stored in DynamoDB `ProviderHealth` table (partition key: `provider#region`)
- Circuit opens after 5 consecutive retryable errors
- Cool-down period: 2 minutes × 2^n (n = number of open events), max 30 minutes
- Cached state in memory with DynamoDB polling on each invocation

### 4. Configuration Management

#### 4.1 Configuration Structure
- JSON schema with version tracking
- Stored in DynamoDB global table for cross-region consistency
- Includes provider definitions, model capabilities, routing rules, weights
- Features controlled via feature flags for gradual rollout

#### 4.2 Configuration Deployment
- Version incremented with each change
- Lambda caches configuration for 60 seconds to reduce read load
- Schema validation before deployment
- Staged rollout using percentage-based routing (based on family ID hash)
- Deployment pipeline: PR → unit tests → config-staging → canary tests → production

### 5. Multi-Region Implementation

#### 5.1 Region Selection
- User's region determined by `custom:region` claim in JWT token
- If region mismatch (JWT region ≠ Lambda region), handle locally but track metric
- Configuration synchronized across regions via DynamoDB global tables
- Circuit breaker state also uses global tables for consistency

#### 5.2 Regional Consistency
- All provider configurations include region-specific endpoints
- Availability tracked per region and provider
- Client requests route to user's home region by default
- Fallback to other regions only during major outages

### 6. Testing & Monitoring Strategy

#### 6.1 Testing Approach
- Mocked AI providers for unit testing
- Comprehensive tests for error handling, retries, circuit breakers
- Synthetic tests with real provider connection (using minimal tokens)
- Load testing with mixed prompt types for performance benchmarking

#### 6.2 Monitoring Thresholds
| Metric | Threshold | Alert |
|--------|-----------|-------|
| Provider Error Rate | > 2% (5-min avg) | PagerDuty - severity 2 |
| Router Fallbacks | > 50 in 10 min | Slack warning |
| Circuit Breaker Open | > 5 minutes | PagerDuty - severity 2 |
| Chat Latency P95 | > 2 seconds | Slack warning |
| Config Version Drift | > 1 between regions | PagerDuty - severity 1 |

### 7. Security & Compliance

#### 7.1 PII Handling
- Strip email addresses and identifiable IDs from prompts
- Replace with opaque hashes: `u:${hash}` for user references
- Log {provider, model, userHash, tokens, timestamp} for audit trail

#### 7.2 Key Security
- Alert if key rotation fails or keys not changed in 35+ days
- Log all key access attempts
- Strict IAM permissions on Secrets Manager

### 8. API Versioning Strategy
- External API endpoints stay stable at `/v1/chat`
- Breaking changes require a new version (`/v2/chat`) with 90+ days of dual support
- Internal interfaces use semantic versioning with strict compatibility rules

---

### **Phase 3: Token Tracking & Basic Billing Logic with Interfaces**

*   **Step 3.1: Basic Billing + Ledger Lambda with Interfaces**
    *   **Goal**: Create `BillingLedgerFunction` using `IDatabaseProvider` and a potential `IBillingLogicProvider` for token deduction and logging.
    *   **Tasks**:
        *   (Optional) Define `IBillingLogicProvider` if logic becomes complex (e.g., `calculateCost(promptTokens, completionTokens, model): number`). For now, direct logic is fine.
        *   Create `BillingLedgerFunction` Lambda in `sam.yaml`.
        *   Grant it read/write access to `FamiliesTable` (via `IDatabaseProvider`) and write access to `TokenLedgerTable` (defined in `sam.yaml`, schema per `TECH_ROADMAP.md`).
        *   Write handler code (`src/handlers/billingLedger.ts`):
            *   Accepts `familyId`, `profileId`, `promptTokens`, `completionTokens`.
            *   `tokensToDeduct = promptTokens + completionTokens`.
            *   Use `IDatabaseProvider` to atomically update `tokenBalance` in `FamiliesTable` (conditional update).
            *   If update succeeds, use `IDatabaseProvider` to log to `TokenLedgerTable`.
            *   Return success/error.
        *   Unit test the handler, mocking `IDatabaseProvider`.
        *   Modify `ChatRouterFunction`:
            *   After successful AI response, invoke `BillingLedgerFunction` (or use its logic directly via providers).
            *   Handle insufficient token errors.
        *   Update `ChatRouterFunction` unit tests.
    *   **Multi-Region Consideration**:
        *   Token ledger entries must include region information (e.g., as a separate attribute in the `TokenLedgerTable`).
        *   Billing operations (token deduction on `FamiliesTable` and logging to `TokenLedgerTable`) must be strictly isolated to the user's designated home region to maintain data integrity, adhering to the multi-region DynamoDB principles in Core Principle #6 (regionalized key values, write-locality).
        *   `TokenLedgerTable` should follow region-aware naming and its partition key strategy must align with Core Principle #6.
    *   **Definition of Done**: 
        * Tokens deducted and logged via interfaces using real DynamoDB tables.
        * Atomic updates work correctly with real transaction operations.
        * Insufficient token scenarios handled correctly.
        * All tests pass including integration tests with actual DynamoDB.
        * No mock implementations remain in the production code.
    *   **Commit Point**: After billing/ledger implementation and testing.

---

### **Phase 4: Parent Dashboard & Initial Child Interface**

*   **Goal**: Provide a web interface for parents to manage their family account and for children to interact with the AI.

*   **Step 4.1: Setup React App for Parent Dashboard**
    *   **Goal**: Initialize a basic React application for the parent-facing dashboard.
    *   **Tasks**:
        *   Create `apps/parent-dashboard/`. Scaffold React project (Vite/CRA with TypeScript).
        *   Setup basic routing. Configure build/lint/test scripts.
    *   **Multi-Region Consideration**: Client-side configuration for API endpoints (if not using a global router) should be region-aware. Cognito integration must support regional user pools.
    *   **Definition of Done**: 
        * Basic React app runs locally, with build/test setup.
        * Region-aware configuration architecture implemented.
    *   **Commit Point**: After initial React app setup.

*   **Step 4.2: API Endpoints for Dashboard (User/Profile Listing) via Interfaces**
    *   **Goal**: Create API for dashboard to list family profiles, using `IDatabaseProvider`.
    *   **Tasks**:
        *   In `apps/chat-api-service/sam.yaml`:
            *   Create `GetFamilyProfilesFunction` Lambda.
            *   Create `/dashboard/profiles` GET endpoint, protected by `LambdaAuthorizerFunction`.
        *   `GetFamilyProfilesFunction` handler (`src/handlers/dashboard/getProfiles.ts`):
            *   Extract `familyId`, `role` from authorizer context.
            *   If `role` not `guardian`, return 403.
            *   Use `IDatabaseProvider` to query `ProfilesTable` by `familyId` (using region-aware key if implemented).
            *   Return profiles.
        *   Unit test handler, mocking `IDatabaseProvider`.
        *   Grant `GetFamilyProfilesFunction` read access to `ProfilesTable`.
    *   **Multi-Region Consideration**: API endpoints are inherently regional. Ensure any direct interaction with `IDatabaseProvider` respects regional data isolation.
    *   **Definition of Done**: 
        * Guardian can get profiles via API with real DynamoDB queries. 
        * Child gets 403. 
        * Integration tests verify real database queries work correctly.
        * Unit tests pass.
    *   **Commit Point**: After dashboard API endpoint implementation and testing.

*   **Step 4.3: Frontend Integration for Profile Listing**
    *   **Goal**: Dashboard React app fetches and displays profiles.
    *   **Tasks**:
        *   Implement Cognito login in React app (e.g., AWS Amplify UI or `amazon-cognito-identity-js`), ensuring it's configured for the regional Cognito User Pool.
        *   Create a service/hook in React to call `/dashboard/profiles` with JWT.
        *   Display profiles in a component.
        *   Basic unit/integration tests for the React components.
    *   **Definition of Done**: 
        * Logged-in guardian sees family profiles in the React app.
        * Real Cognito authentication working, not mocked.
        * Dashboard communicates with actual API endpoints.
    *   **Commit Point**: After frontend integration and display of profiles.

*   **Step 4.4: Basic Child Chat Interface (MVP)**
    *   **Goal**: Create a minimal, functional interface for a child to send prompts and receive AI responses, demonstrating the end-to-end chat flow.
    *   **Tasks**:
        *   Develop a simple client (e.g., a basic web component or a very streamlined Flutter view if resources allow) for child interaction.
        *   Integrate with the `/chat` endpoint.
        *   Display AI responses.
        *   Ensure it respects authentication and authorization from Phase 1.
    *   **Multi-Region Consideration**: Similar to Parent Dashboard: API endpoint configuration and Cognito integration should be region-aware.
    *   **Definition of Done**: 
        * A child user can log in (via real Cognito credentials), send a prompt, and receive an actual AI response. 
        * Token deduction is tracked in real DynamoDB tables.
        * No mock implementations in any part of the flow.
    *   **Commit Point**: After basic child interface is functional and tested.

---

### **Phase 5: Enhanced Moderation & Content Adaptation**

*   **Goal**: Make the moderation process more robust, configurable, and adaptable to different user needs.

*   **Step 5.1: Moderation Engine with Step Functions**
    *   **Goal**: Refactor the moderation logic to use AWS Step Functions for better workflow management, error handling, and observability.
    *   **Tasks**:
        *   Define a Step Function state machine that orchestrates pre-prompt checks, AI model call, and post-response checks.
        *   Integrate existing `IModerationProvider` implementations as tasks within the Step Function.
        *   Update `ChatRouterFunction` to invoke this Step Function workflow instead of direct Lambda calls for moderation.
    *   **Multi-Region Consideration**: Step Function definition should be deployable per region. Interactions with other regional services (Lambdas, `ModerationLogTable`) must be region-contained. Use region-aware naming for the Step Function.
    *   **Definition of Done**: 
        * Moderation flow is managed by real AWS Step Functions, not simulated workflows.
        * Existing moderation capabilities are preserved.
        * Unit tests and integration tests with actual Step Functions verify expected behavior.
    *   **Commit Point**: After Step Function based moderation engine is implemented and tested.

*   **Step 5.2: Readability Rewriter Service**
    *   **Goal**: Implement a service to adjust the complexity and style of AI responses to be more age-appropriate.
    *   **Tasks**:
        *   Define `IReadabilityProvider` interface and its implementation (e.g., using another LLM call to simplify text via `IAIModelProvider`).
        *   Integrate the `ReadabilityRewriterService` as an optional step in the Moderation Step Function.
        *   Add controls in the Parent Dashboard for guardians to enable/configure readability settings per profile.
    *   **Multi-Region Consideration**: `IAIModelProvider` used by the rewriter should be region-aware. Any data storage/logging specific to readability should be regional.
    *   **Definition of Done**: 
        * AI responses can be automatically simplified based on profile settings using a real AI provider.
        * Parent dashboard controls are functional and persist settings to actual database.
        * No mock implementations remain in production code.
    *   **Commit Point**: After Readability Rewriter is implemented and integrated.

*   **Step 5.3: Advanced Moderation Rules & Enhanced Logging**
    *   **Goal**: Implement the custom age-based rule engine and improve detail in moderation logging.
    *   **Tasks**:
        *   Develop the custom rule engine logic (as per `TECH_ROADMAP.md`).
        *   Integrate this engine into the `IModerationProvider` or directly into the Step Function workflow.
        *   Expand `ModerationLogTable` schema to include more detailed context about flagged content and applied rules (e.g., rule ID, matched content snippet).
    *   **Multi-Region Consideration**: `ModerationLogTable` is already noted to be region-aware. Custom rules, if stored (e.g., in DynamoDB or config files), should be manageable per region.
    *   **Definition of Done**: 
        * Custom moderation rules are active and integrated with real rule storage.
        * Logs provide comprehensive audit trails for moderation events in actual DynamoDB tables.
        * Integration tests validate rule evaluation with various content types.
    *   **Commit Point**: After advanced moderation rules and logging are implemented.

---

### **Phase 6: Advanced Permissions & User Notifications**

*   **Goal**: Implement fine-grained access control and proactive user notifications.

*   **Step 6.1: Cedar Verified Permissions (AVP) Integration**
    *   **Goal**: Introduce Amazon Verified Permissions for managing complex authorization policies.
    *   **Tasks**:
        *   Define Cedar policies for key actions (e.g., accessing chat, viewing transcripts, modifying settings, admin functions).
        *   Set up AVP Policy Store and link it to identity sources (Cognito).
        *   Modify `LambdaAuthorizerFunction` (or create a dedicated policy evaluation service/Lambda) to make authorization decisions based on AVP.
        *   (Future sub-task) Build UI components in Parent Dashboard for managing relevant policy aspects if applicable.
    *   **Multi-Region Consideration**: Each region must use its own AVP policy store. Define all Cedar policies as code and deploy them per region. Use region-aware naming for Policy Stores.
    *   **Definition of Done**: 
        * Access control for defined actions is governed by real Cedar policies in actual AVP policy stores.
        * Integration tests verify policy enforcement works correctly with various user scenarios.
        * No mock policy evaluation in production code.
    *   **Commit Point**: After AVP integration and initial policy setup.

*   **Step 6.2: Notification System (SNS/SES)**
    *   **Goal**: Implement a system for notifying users of important events.
    *   **Tasks**:
        *   Set up SNS topics for different event types (e.g., token quota warnings, content moderation flags, major account changes).
        *   Configure SES for sending email notifications, including verified sender identities and email templates.
        *   Integrate event publishing into relevant services (e.g., `BillingLedgerFunction` for token warnings, `ModerationEngine` Step Function for flags).
        *   Add notification preferences in the Parent Dashboard (e.g., opt-in/out for certain notification types).
    *   **Multi-Region Consideration**: SNS Topics and SES configurations are regional. Notifications should be triggered and sent from the user's primary region. Manage templates per region if they have regional content.
    *   **Definition of Done**: 
        * Users receive real notifications for configured events based on their preferences.
        * Integration tests verify correct delivery of notifications through actual SNS/SES.
        * Regional isolation is properly maintained.
    *   **Commit Point**: After notification system is implemented and tested.

---

### **Phase 7: Full Billing & Real-time Chat Experience**

*   **Goal**: Complete the Stripe billing integration and enhance the chat experience with real-time updates.

*   **Step 7.1: Stripe Webhook Integration & Subscription Management**
    *   **Goal**: Fully integrate Stripe for handling subscriptions, booster pack purchases, and billing events.
    *   **Tasks**:
        *   Implement Lambda handlers for critical Stripe webhooks (e.g., `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`).
        *   Secure webhook endpoints using Stripe signature verification.
        *   Update `FamiliesTable` (e.g., `tokenBalance`, `subscriptionStatus`) and potentially a new `BillingEventsTable` based on Stripe events.
        *   Develop UI in Parent Dashboard for managing subscriptions (view, upgrade, cancel), viewing billing history, and purchasing booster packs.
    *   **Multi-Region Consideration**: Stripe is global, but webhook Lambda handlers are regional. DB updates must target regional tables. `BillingEventsTable` (if created) needs region-aware naming and partitioning strategy. Ensure idempotency in webhook handlers.
    *   **Definition of Done**: 
        * End-to-end Stripe billing flow is operational for subscriptions and booster packs using real Stripe API.
        * Parent dashboard provides billing management with actual subscription data.
        * All transactions correctly update real DynamoDB tables.
    *   **Commit Point**: After full Stripe integration and dashboard UI.

*   **Step 7.2: WebSocket API for Real-time Chat**
    *   **Goal**: Implement WebSocket communication for a more interactive chat experience.
    *   **Tasks**:
        *   Define a WebSocket API in API Gateway.
        *   Implement Lambda handlers for WebSocket lifecycle events (`$connect`, `$disconnect`, `$default`).
        *   Implement logic for managing connections (e.g., store connection IDs in DynamoDB mapped to `profileId`).
        *   Modify the `ChatService` (or its Step Function workflow) to broadcast messages to connected clients of a given profile/family after AI response and moderation.
        *   Update client applications (Parent and Child) to establish WebSocket connections and send/receive chat messages via WebSockets.
    *   **Multi-Region Consideration**: API Gateway WebSocket APIs are regional. Connection management (e.g., connection ID table) must be regional. Message broadcasting should occur within the user's region.
    *   **Definition of Done**: 
        * Chat messages are delivered in real-time via actual WebSockets to appropriate clients.
        * Connection handling is robust with real connection tracking in DynamoDB.
        * Regional isolation is maintained with proper failover capability.
    *   **Commit Point**: After WebSocket API and client integration.

---

## Development Notes & Learnings (from Phase 0)

*   **AWS CLI Profile for SAM/CloudFormation:**
    *   The `kinable-dev` profile (initially based on `PowerUserAccess`) required elevation to `AdministratorAccess` (or needed more specific IAM permissions like `iam:TagRole`, `iam:UntagRole`, and robust `iam:CreateRole` capabilities) for successful SAM deployments. This was due to IAM role creation and tagging operations performed by CloudFormation.
    *   Ensure SSO tokens are active (`aws sso login --profile kinable-dev`) before deployment sessions, as they can expire.
*   **SAM CLI:**
    *   If your SAM template is not named `template.yaml` (e.g., `sam.yaml`), use the `-t` flag for build and deploy commands: `sam build -t sam.yaml`, `sam deploy -t sam.yaml ...`.
    *   `samconfig.toml` is automatically created by `sam deploy --guided` and is useful for storing deployment parameters for subsequent deploys.
*   **CloudFormation Stack Issues:**
    *   Stacks in `ROLLBACK_FAILED` or `DELETE_FAILED` states must be manually deleted from the AWS CloudFormation console before new deployments can succeed. This process might involve choosing to skip/retain problematic resources during the console deletion and then manually cleaning up any orphaned resources (e.g., IAM roles) from their respective service consoles (e.g., IAM).
*   **TypeScript & Build Process for Lambda:**
    *   Ensure the TypeScript configuration (`tsconfig.json`, `tsconfig.build.json`) correctly compiles *all* Lambda handler source files into the `outDir` (e.g., `dist/`) while maintaining the directory structure expected by the Lambda `Handler` path defined in `sam.yaml` (e.g., `dist/handlers/hello.handler` corresponding to `src/handlers/hello.ts`).
    *   It's good practice to run the local package build script (e.g., `pnpm build` within the service's directory) to verify the `dist` output structure before running `sam build`. This helped catch a TypeScript error (`noUnusedParameters`) that was preventing correct local compilation.
    *   Compiler errors like `noUnusedParameters` (TS6133) will fail the `tsc` build; address them by using the parameter or prefixing its name with an underscore (`_`).
*   **Jest Configuration for TypeScript:**
    *   New TypeScript packages that include Jest tests require a local `jest.config.js` file (e.g., in the service's root directory) configured with the `ts-jest` preset to correctly process TypeScript test files.
*   **Multi-Region Readiness:**
    *   **Resource Naming:** Follow the pattern `<env>-<region>-<service>-<purpose>` for all resources. 
    *   **DynamoDB Design:** Partition keys should incorporate region (e.g., `PK = FAMILY#<region>#<familyId>`).
    *   **Configuration:** Store region-specific configuration in environment variables or parameters, never hardcode.
    *   **API Gateway:** Use regional endpoints (not edge-optimized) to prepare for future multi-region routing.
    *   **CloudFormation Outputs:** Export all resource names/ARNs as outputs to simplify cross-referencing.
    *   **Observability Strategy:** Ensure logs, metrics, and CloudWatch dashboards are designed to be region-specific by default, with cross-region aggregation considered a later enhancement.

---

This project plan will be stored as `PROJECT_PLAN.md` in the root of the `kinable` repository.