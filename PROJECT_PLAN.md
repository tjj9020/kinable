# Kinable AI Chat Application: Project Implementation Plan

## Core Working Agreements & Principles

1.  **Interface-Driven Development**:
    *   We do not depend directly on third-party services or SDKs within our core business logic.
    *   We define interfaces within our application (e.g., `IDatabaseProvider`, `IAuthProvider`, `IAIModelProvider`, `IModerationProvider`, `IBillingProvider`).
    *   Concrete implementations of these interfaces (e.g., `DynamoDBProvider`, `CognitoAuthProvider`, `OpenAIProvider`) will adapt the third-party services.
    *   This allows for easier testing (using mocks/stubs for interfaces) and flexibility in swapping out underlying services. Business logic will only interact with these defined interfaces.
    *   Testing approach: When testing components that use these interfaces, we inject mock implementations that return predictable responses, allowing us to test business logic in isolation without dependencies on external services.

2.  **SOLID Design Principles & Clean Architecture**:
    *   We adhere strictly to SOLID principles (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion) in all code design and implementation.
    *   **Clean/Hexagonal Architecture**: Each service should ideally be structured to separate domain logic from infrastructure concerns. This typically involves organizing code into layers such as `domain/`, `application/` (or `use-case/`), `adapters/` (for incoming ports like API handlers and outgoing ports like database clients), and `infrastructure/`. Handlers (e.g., Lambda handlers) should be kept thin, delegating business logic to application services/use cases. This enhances testability, maintainability, and the ability to swap dependencies.
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
    *   **Architecture Decision Records (ADRs)**: For significant architectural decisions (e.g., choosing a primary data store, selecting a messaging system, deciding on a specific AI provider integration strategy, structuring moderation flows, defining token accounting mechanisms), we will create Architecture Decision Records.
        *   *What*: A short document (typically markdown) capturing the context, decision, and consequences of an important architectural choice.
        *   *Why*: To capture the rationale behind decisions, reduce future debate, enable team alignment, onboard new members, and support compliance/audit trails.
        *   *How*: ADRs will be stored in a designated `/docs/adr/` folder using a simple template (e.g., `001-example-decision.md`).

5.  **Frequent Commits**:
    *   We commit our code frequently. A commit is made when:
        *   The code compiles successfully.
        *   All relevant unit tests pass.
        *   A defined sub-task within a "Step" of a "Phase" is functionally complete and tested.
    *   Commit messages should be clear and reference the specific Phase and Step (e.g., "Feat(Phase1.2): Implement JWT parsing in Lambda Authorizer").

6.  **Multi-Region Readiness & Data Management**:
    *   While initially deploying to a single region, we design all resources to be multi-region ready from the start.
    *   We follow region-aware naming conventions: `<env>-<region>-<service>-<purpose>`.
    *   We parameterize all region-specific resource identifiers (no hardcoding).
    *   **DynamoDB Design**:
        *   Partition key *values* will be constructed to incorporate region information (e.g., `FAMILY#<user_region>#<familyId_value>`, `PROFILE#<user_region>#<profileId_value>`). The actual table attribute names for keys remain simple (e.g., `familyId`).
        *   All data operations (reads and especially writes) adhere to **write-locality**: operations for a given user/family occur in their designated "home region" (derived from `custom:region` JWT claim). This prevents cross-region write conflicts and simplifies data consistency.
        *   Our Infrastructure as Code (IaC) approach using SAM for table definitions ensures consistent schemas and keys across regions. This facilitates new region deployments and is a prerequisite for potential future use of DynamoDB Global Tables.
        *   If considering DynamoDB Global Tables in the future, data types will be assessed for replication safety (e.g., eventually consistent chat logs vs. strongly consistent counters which require careful design for active-active replication).
        *   **Partition Key Checklist**: Before creating any new DynamoDB table, a review based on a standard checklist (e.g., documented in `/docs/ddb-key-review.md`) must be conducted. This checklist will validate key cardinality, read/write patterns, potential for hot keys, and suitability for expected query patterns.
        *   **Global Table Promotion Plan**: A documented plan outlining criteria and procedures for promoting regional DynamoDB tables to Global Tables will be maintained (e.g., in an ADR or infra README). This ensures a smooth transition if and when true global replication is required.
    *   All authorization and data operations remain region-local by default.
    *   Interfaces should be designed to accommodate region-specific implementations or configurations.

7.  **Modular Service Structure**:
    *   **Monorepo Organization**: The monorepo should be organized into modular service packages (e.g., under a `/services/` directory like `/services/chat`, `/services/moderation`, or within `apps/` if appropriate). Each service package should ideally have its own local build, test configuration, and clear dependency boundaries, managed via PNPM workspaces.
    *   *Why*: This improves build performance, isolates domain logic, reduces coupling, and clarifies ownership.

8.  **Testing Standards & Contract Enforcement**:
    *   **Unit Tests**: As currently defined.
    *   **Integration Tests**: As currently defined.
    *   **End-to-End (E2E) Tests**: As currently defined.
    *   **Contract Tests**: For shared APIs, interfaces, and Data Transfer Objects (DTOs) (especially those in `packages/common-types/`), contract tests should be implemented.
        *   *What*: Tests that verify the "contract" (e.g., method signatures, data structures, expected behavior) of a shared component from the perspective of its consumer.
        *   *Why*: To prevent silent breaking changes between services or between shared packages and their consumers, ensuring backward compatibility.
        *   *How*: Tools like `jest-extended` for validating object schemas, `ts-interface-checker`, or provider/consumer-driven contract testing frameworks (e.g., Pact) can be considered.

9.  **Infrastructure as Code (IaC) Strategy & Governance**:
    *   **Tooling**: We will primarily use AWS SAM for simpler Lambda-based services. For more complex infrastructure, workflows involving multiple AWS services (e.g., Step Functions, Global Tables configurations, complex networking), or where higher-level abstractions are beneficial, AWS CDK (Cloud Development Kit) will be used. This allows us to leverage SAM's speed for common Lambda patterns and CDK's type safety and composability for more intricate setups (e.g., an `infra/chat-cdk/` for a complex chat workflow or `infra/core-sam/` for basic API services).
    *   **IaC Governance**: To maintain security, best practices, and cost-effectiveness in our IaC:
        *   `cdk-nag`: For CDK-based infrastructure, `cdk-nag` (installed as a dev dependency in relevant CDK packages) will be used to check stacks against best practice rules (e.g., from AWS Solutions Architect Framework).
        *   `cfn-lint`: For SAM/CloudFormation templates, `cfn-lint` (expected to be available in the CI/CD environment) will be used to validate templates against policy-as-code rules and AWS best practices.
        *   *Why*: To prevent common misconfigurations (e.g., public S3 buckets, overly permissive IAM roles, missing encryption or logging).
        *   *How*: These tools will be integrated into CI/CD pipelines to fail builds on critical violations. `cdk-nag` checks can be run during `cdk synth`, and `cfn-lint` can be run against generated SAM/CloudFormation templates.

10. **Compliance and Privacy by Design**:
    *   **Compliance Backlog**: A compliance backlog will be maintained (e.g., in `PROJECT_PLAN.md` or a separate `COMPLIANCE.md` document) to track requirements related to regulations like COPPA, GDPR, and aspirations for SOC2. This includes defining data deletion flows, data retention policies, access logging, and mapping features to compliance controls. Phase targets will be assigned to these items.

## Mock vs. Production Implementation Requirements

To ensure we maintain a clear distinction between mock implementations used for initial development and the production-ready implementations required for completion, we establish the following guidelines:

1. **Implementation Stages**:
   * **Initial Development**: Interface implementations may use mocks or stubs for rapid development and testing.
   * **Completion Requirements**: Before any step is considered complete, all mock implementations must be replaced with real service integrations.

2. **Mock Implementation Guidelines**:
   * All mock implementations must be clearly marked with comments (e.g., `// MOCK: This is a temporary mock implementation for <Reason>. Ticket: <IssueID>`).
   * **Tracking Mocks**: In addition to comments, a corresponding GitHub issue (or similar tracking mechanism) should be created and tagged (e.g., `needs-prod-impl`, `tech-debt`) for each mock implementation. This ensures visibility and facilitates prioritization of replacing mocks. Automated linting or CI checks can be configured to warn about `// MOCK:` annotations without a linked issue.
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
        *   **CI/CD Foundation**: Establish standard CI/CD pipeline templates (e.g., using GitHub Actions). For each service, this template should include steps for: build, lint, unit tests, IaC validation (ensuring `cfn-lint` is run against SAM/CloudFormation templates and `cdk-nag` for CDK stacks), deployment to a test environment, and basic smoke tests. Example: `.github/workflows/deploy-chat-api-service.yml`.
    *   **Definition of Done**: Core build/lint/test commands execute successfully. New service/package directories are created. Initial shared types/interfaces defined. Basic CI template available, referencing IaC validation tools.
    *   **Commit Point**: After setup and initial package creation.

*   **Step 0.2: AWS `kinable-dev` Profile & "Hello World" SAM Deployment [COMPLETED]**
    *   **Goal**: Confirm AWS CLI access with the `kinable-dev` profile and successfully deploy a basic "Hello World" Lambda using AWS SAM, configured for Graviton2 (arm64) architecture.
    *   **Tasks**:
        *   Follow `NEW_PROJECT_GUIDE.md` to ensure `kinable-dev` AWS CLI profile is configured and working (`aws sts get-caller-identity --profile kinable-dev`).
        *   Inside `apps/chat-api-service/`, create a minimal SAM application:
            *   `sam.yaml` defining a single Lambda function (e.g., `HelloWorldFunction`) and an API Gateway HTTP API endpoint. Ensure global Lambda architecture is set to `arm64` or `HelloWorldFunction` specifically targets `arm64`. [COMPLETED - Global architecture set to arm64 and deployed]
            *   A simple handler (e.g., `src/handlers/hello.ts`) that returns a "Hello World" JSON response.
        *   Implement basic unit tests for the handler.
        *   Deploy using `sam build --profile kinable-dev` and `sam deploy --guided --profile kinable-dev`. [COMPLETED - Service redeployed successfully with arm64]
        *   Test the deployed API endpoint.
        *   **IaC Governance Check (Manual for Phase 0)**: Manually run `cfn-lint` against the `sam.yaml` of the Hello World service to ensure basic compliance, as a precursor to CI automation.
    *   **Multi-Region Consideration**: 
        *   Ensure resource naming follows region-aware convention (e.g., `KinableHttpApi-${AWS::Region}`).
        *   Parameterize any region-specific configurations.
    *   **Definition of Done**: The "Hello World" Lambda is deployed, unit tests pass, and its API Gateway endpoint returns a successful response. The service is confirmed to run on Graviton2 (arm64) architecture. [COMPLETED]
    *   **Commit Point**: After successful deployment and testing.

*   **Step 0.3: Establish Foundational Development Artifacts [COMPLETED]**
    *   **Goal**: Create initial documents and test configurations to support core development principles.
    *   **Tasks**:
        *   Created `docs/adr/` directory for Architecture Decision Records. [COMPLETED]
        *   Created `docs/adr/000-template.md` with a standard ADR template. [NEWLY ADDED & COMPLETED]
        *   Created `docs/ddb-key-review.md` with an initial checklist for DynamoDB partition key design. [COMPLETED]
        *   Created `COMPLIANCE.md` with initial sections for COPPA, GDPR, and SOC2-lite. [NEWLY ADDED & COMPLETED]
        *   Implemented a basic contract test for `IUserIdentity` in `packages/common-types/src/core-interfaces.contract.test.ts`. [COMPLETED]
        *   Updated Jest configuration in `packages/common-types/jest.config.js` to include `*.contract.test.ts` files for discovery. [COMPLETED]
    *   **Definition of Done**: Essential documentation folders, templates, and initial examples/configurations for ADRs, DynamoDB reviews, compliance tracking, and contract testing are in place.
    *   **Commit Point**: After creation of foundational artifacts.

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
        *   In `packages/common-types/`, define `IAuthProvider` interface (e.g., `verifyToken(token: string): Promise<IUserIdentity | null>`) and `IUserIdentity` (containing `userId`, `familyId`, `profileId`, `role`, `isAuthenticated`). [COMPLETED and VERIFIED]
        *   Create a `CognitoAuthProvider` implementation of `IAuthProvider` in `apps/chat-api-service/src/auth/`. This class will handle JWT validation against Cognito. Unit test this class with mock JWTs. [COMPLETED and VERIFIED]
        *   Create a new Lambda function (`LambdaAuthorizerFunction`) in `sam.yaml`. [COMPLETED and VERIFIED]
        *   Write the authorizer handler (`src/authorizers/jwtAuthorizer.ts`): [COMPLETED and VERIFIED]
            *   Instantiate `CognitoAuthProvider`. [COMPLETED and VERIFIED]
            *   Use it to verify the token and extract claims. [COMPLETED and VERIFIED]
            *   Return an IAM policy. For now, if `IUserIdentity.isAuthenticated` is true, allow. [COMPLETED and VERIFIED]
        *   Unit test the authorizer handler, mocking `IAuthProvider`. [COMPLETED and VERIFIED]
        *   Update the "Hello World" API Gateway endpoint (from Step 0.2) to use this Lambda Authorizer. [COMPLETED and VERIFIED]
        *   Grant the authorizer Lambda appropriate permissions if it needs to fetch JWKS URI dynamically (prefer passing User Pool ID/Region as env vars). [COMPLETED and VERIFIED]
    *   **Multi-Region Consideration**: [COMPLETED and VERIFIED]
        *   The `LambdaAuthorizerFunction` and its `CognitoAuthProvider` instance are inherently regional, operating against the Cognito User Pool deployed in the same region. Configuration (User Pool ID, Client ID) must be supplied via environment variables derived from regional stack outputs (CloudFormation `!Ref` or `!GetAtt`). [COMPLETED and VERIFIED]
    *   **Definition of Done**: API Gateway endpoint is protected. Valid JWTs grant access; invalid/missing JWTs are denied. `IAuthProvider` and its implementation are unit tested. Authorizer handler is unit tested. [COMPLETED and VERIFIED]
    *   **Commit Point**: After authorizer implementation, testing, and integration with API Gateway.

*   **Step 1.3: Initial DynamoDB Tables & Data Access Interfaces [COMPLETED and VERIFIED]**
    *   **Goal**: Create DynamoDB tables for `Families` and `Profiles` via SAM, define data access interfaces, and ensure tables are configured to support DynamoDB Global Table replication. **Update**: Ensure `DynamoDBProvider` uses the real AWS SDK and is integration tested.
    *   **Tasks**:
        *   In `packages/common-types/` (plan mentions `kinable-types`, verify actual package name), define: [COMPLETED and VERIFIED]
            *   `IDatabaseProvider` interface (as updated to accept `keyAttributeName`, `logicalId`, `userRegion`).
            *   Interfaces for `FamilyData` (`familyId`, `tokenBalance`, `pauseStatusFamily`) and `ProfileData` (`profileId`, `familyId`, `role`, `pauseStatusProfile`).
        *   Define two DynamoDB tables in `sam.yaml`: `FamiliesTable`, `ProfilesTable` with initial attributes. Apply the **Partition Key Checklist** and **Global Table Promotion Plan** principles here. [COMPLETED and VERIFIED]
            *   Enable DynamoDB Streams for both tables (`StreamSpecification` with `StreamViewType: NEW_AND_OLD_IMAGES`) as a prerequisite for Global Table configuration. [COMPLETED and VERIFIED]
            *   The primary region for initial deployment and writes will be `us-east-2`. [COMPLETED and VERIFIED]
        *   Deploy SAM changes (for the `us-east-2` region initially). [COMPLETED and VERIFIED]
        *   Create `DynamoDBProvider` implementation of `IDatabaseProvider` in `apps/chat-api-service/src/data/`. [COMPLETED and VERIFIED - Uses AWS SDK]
        *   Implement and run integration tests for `DynamoDBProvider` against actual DynamoDB tables (in a test environment). [COMPLETED and VERIFIED - Validated via auth-db-checks.integration.test.ts]
        *   Grant the Lambda Authorizer read access to these tables (GetItem) using their regional ARNs. [COMPLETED and VERIFIED]
        *   Manually populate with dummy data in `us-east-2`, ensuring primary key values use the new region-stamped format (e.g., `FAMILY#us-east-2#someId`). [COMPLETED and VERIFIED - Test suite now does this dynamically]
        *   Note: The actual linking of regional tables into a Global Table (e.g., `us-east-2` with `us-west-2`) may be a post-deployment configuration or a future IaC enhancement. This step focuses on ensuring the *table structure and access patterns* in `us-east-2` support global readiness.
    *   **Multi-Region Consideration**:
        *   This step implements the foundational design for DynamoDB Global Tables. `FamiliesTable` and `ProfilesTable` are configured with streams and region-stamped partition keys (`ENTITY#<user_region>#<id_value>`) to support replication and unique identification across regions. The `DynamoDBProvider` ensures writes are directed to the user's primary regional endpoint (initially `us-east-2`) and data is stamped with its originating region.
    *   **Learnings**:
        *   When mocking AWS SDK v3 in Jest tests, using class-based mocks for command constructors (e.g., `GetCommand`, `PutCommand`) provides more reliable test behavior than trying to re-export from the original module.
        *   Setting test expectations with `expect.any(Object)` instead of specific command types provides more flexible test assertions.
    *   **Definition of Done**: 
        * Tables are created via SAM. [COMPLETED and VERIFIED]
        * `IDatabaseProvider` and its `DynamoDBProvider` implementation exist. [COMPLETED and VERIFIED]
        * `DynamoDBProvider` unit tests (using SDK mocks) pass. [COMPLETED and VERIFIED]
        * Integration tests confirm `DynamoDBProvider` correctly interacts with actual DynamoDB tables. [COMPLETED and VERIFIED - Validated via auth-db-checks.integration.test.ts]
        * Authorizer has IAM permissions. [COMPLETED and VERIFIED]
    *   **Commit Point**: After table creation, interface/implementation development, and testing.

*   **Step 1.4: Enhance Lambda Authorizer with DB Checks via Interfaces [COMPLETED and VERIFIED]**
    *   **Goal**: Update Lambda Authorizer to use `IDatabaseProvider` to fetch and use `pause_status` and `tokenBalance`. **Update**: Revalidate with a production-ready `DynamoDBProvider`.
    *   **Tasks**:
        *   Modify `jwtAuthorizer.ts`: [COMPLETED and VERIFIED]
            *   Inject/instantiate `DynamoDBProvider` (as `IDatabaseProvider`). [COMPLETED and VERIFIED]
            *   After validating JWT and extracting `profileId` and `familyId` via `IAuthProvider`: [COMPLETED and VERIFIED]
                *   Use `IDatabaseProvider` to fetch profile from `ProfilesTable`. [COMPLETED and VERIFIED]
                *   Use `IDatabaseProvider` to fetch family data from `FamiliesTable`. [COMPLETED and VERIFIED]
                *   Deny access if `pauseStatusProfile` or `pauseStatusFamily` is true. [COMPLETED and VERIFIED]
                *   Deny access if `tokenBalance` is <= 0. [COMPLETED and VERIFIED]
        *   Update unit tests for the authorizer handler, mocking `IAuthProvider` and `IDatabaseProvider`. [COMPLETED and VERIFIED]
        *   Test by setting pause statuses/token balances in DynamoDB and verifying access control via API calls. [COMPLETED and VERIFIED - Validated via auth-db-checks.integration.test.ts]
        *   Re-run integration tests (API calls) after Step 1.3 `DynamoDBProvider` uses the real AWS SDK against actual DynamoDB tables. [COMPLETED and VERIFIED]
    *   **Multi-Region Consideration**: [COMPLETED and VERIFIED]
        *   The `DynamoDBProvider` instance used within the authorizer must be configured for the Lambda's current operational region (e.g., via `process.env.AWS_REGION`). [COMPLETED and VERIFIED]
        *   When fetching data from `FamiliesTable` and `ProfilesTable`, keys must be constructed to include the region identifier if the partition key design incorporates it (e.g., `FAMILY#<region>#<familyId>`). The region for the key should be derived from the user's `custom:region` JWT claim. If the claim is unavailable, the authorizer may need to deny access or default to its own operational region based on clearly defined rules. [COMPLETED and VERIFIED]
        *   Ensure IAM permissions for the authorizer to DynamoDB tables correctly reference the regionally named tables (e.g., using `!Sub` with `${AWS::Region}` in ARNs). [COMPLETED and VERIFIED]
    *   **Definition of Done**: 
        * Authorizer correctly denies access based on data fetched via `IDatabaseProvider` (unit tested with mock provider). [COMPLETED and VERIFIED]
        * Integration tests (API calls) verify proper authorization against actual DynamoDB tables, using the production-ready `DynamoDBProvider` from Step 1.3. [COMPLETED and VERIFIED - auth-db-checks.integration.test.ts passes]
        * All mock implementations for database interaction have been replaced with production-ready code. [COMPLETED and VERIFIED - Authorizer uses real provider; provider uses real SDK]
    *   **Commit Point**: After authorizer implementation, testing, and integration with API Gateway.

---

### **Phase 2: Core Chat Functionality**

*   **Step 2.1: Develop Chat Router Lambda (Single Model) with Interfaces [COMPLETED]**
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
            *   `BaseAIModelProvider` abstract class with shared functionality [COMPLETED - Refined canFulfill and rate limiting]
                *   **Shared Policy/Retry Logic**: Implement common logic for retries (with exponential backoff) and error normalization within `BaseAIModelProvider` or a dedicated shared utility package. This avoids duplicating fragile retry logic in each concrete provider.
                *   **Prompt Optimization**: Include mechanisms for prompt compression (e.g., stripping extraneous formatting) and dynamically setting appropriate `maxTokens` based on the task or model to optimize token usage.
            *   `OpenAIModelProvider` concrete implementation (initial provider). [COMPLETED - Uses real OpenAI SDK internally if no client injected, robust error handling, and rate limiting]
            *   `ConfigurationService` for managing provider configurations. [COMPLETED - Uses real DynamoDB for fetching and caching configurations]
            *   **COMPLETED**: `OpenAIModelProvider` uses the actual OpenAI SDK for its internal client when one is not injected.
            *   **COMPLETED**: Update `ConfigurationService` to fetch configuration from the actual `ProviderConfiguration` DynamoDB table and cache it.
            *   **COMPLETED**: API keys for OpenAI are securely retrieved from AWS Secrets Manager by the `OpenAIModelProvider`.
            *   **COMPLETED**: Implement and run integration tests for `ConfigurationService` (real DynamoDB interaction).
            *   `AIModelRouter` for future provider selection with:
                *   Simple initial implementation focused on a single provider [COMPLETED]
                *   Design for future capabilities including failover, cost optimization, feature matching [COMPLETED as part of initial design]
        *   **Configuration Management System**:
            *   Create a `ProviderConfiguration` DynamoDB table (global table ready) [COMPLETED]
            *   Schema with version, timestamp, and configuration JSON [COMPLETED]
            *   Configuration format supporting: // ... (all sub-items COMPLETED)
            *   API for configuration updates with validation [COMPLETED via ConfigurationService.updateConfiguration]
        *   Store provider API keys in AWS Secrets Manager: [COMPLETED - All sub-items]
        *   Write handler code (`src/handlers/chatRouter.ts`): [COMPLETED - All sub-items]
        *   Unit test the components: [COMPLETED - All sub-items, integration tests cover more]
        *   Create a new `/v1/chat` POST endpoint in API Gateway: [COMPLETED - All sub-items]
    *   **Multi-Region Considerations**: // ... (all sub-items COMPLETED for this phase)
    *   **Definition of Done (Initial)**: 
        *   Abstraction layer for multiple providers is in place. [COMPLETED for BaseAIModelProvider and OpenAIModelProvider]
        *   Unit tests (using mocks for OpenAI SDK and DynamoDB) for `OpenAIModelProvider` and `ConfigurationService` pass. [COMPLETED for OpenAIModelProvider and ConfigurationService integration tests with real DB]
        *   API keys are retrieved from AWS Secrets Manager by the `OpenAIModelProvider`. [COMPLETED]
        *   `/v1/chat` endpoint successfully returns AI responses using the real OpenAI API via the updated `OpenAIModelProvider`. [COMPLETED - Validated in Step 2.1.1]
        *   Configuration management system uses the actual `ProviderConfiguration` DynamoDB table. [COMPLETED - via ConfigurationService]
        *   Integration tests for `ConfigurationService` (real DynamoDB interaction). [COMPLETED]
    *   **Commit Point**: After chat router implementation, interface/provider development, and testing.
    *   **Lessons Learned**:
        *   When deploying serverless applications with monorepo workspace dependencies, special care is needed to properly bundle dependencies instead of relying on symlinks which don't work in AWS Lambda.
        *   Custom build scripts can help ensure proper packaging of dependencies.
        *   Ensure CloudFormation Outputs in `sam.yaml` exactly match the keys expected by integration/E2E test scripts.
        *   When testing Lambda functions that rely on specific environment variable names, ensure the `sam.yaml` provides those exact names and that the Lambda code uses those exact names.
        *   When testing services that interact with DynamoDB tables using prefixed keys (e.g., for global table strategies), ensure test data setup scripts (like those in E2E tests) write data using the same prefixed keys that the service layer expects to read. Verify this for both primary keys and any GSI keys involved in lookups.

*   **Step 2.1.1: Initial End-to-End Validation of Chat Router [COMPLETED]**
    *   **Goal**: Confirm that the deployed `/v1/chat` endpoint is fully functional with real backend services. **Update**: Re-run E2E tests after Step 2.1 uses real AI provider and config service.
    *   **Tasks**:
        *   **COMPLETED**: E2E tests (`chatRouter.e2e.test.ts`) executed successfully against deployed stack (`kinable-dev` in `us-east-2`).
        *   **COMPLETED**: Verified a successful (HTTP 200) response containing an actual AI-generated text from OpenAI.
    *   **Definition of Done**: A documented successful end-to-end test run, with the `/v1/chat` endpoint returning a valid AI response from the real OpenAI API to an authenticated request, using configuration from the real DynamoDB table. Any issues encountered during the re-test are diagnosed and resolved. [COMPLETED]

*   **Phase 2.2: Multi-Provider AI System with UI & Advanced Controls [IN PROGRESS]**
    *   **Goal**: Extend the AI provider architecture to support multiple providers with intelligent routing, failover, a user interface for interaction and testing, and advanced configuration and health monitoring.

    *   **Phase 2.2.1: Core Smart Routing & Fallback [COMPLETED]**
        *   **Goal**: Implement core smart routing features including robust failover, circuit breaking, and initial cost/capability-based routing logic.
        *   **Tasks**:
            *   Create a second provider implementation:
                *   `AnthropicModelProvider` implementing `IAIModelProvider` [COMPLETED - Uses real Anthropic SDK, retrieves keys from Secrets Manager, handles conversation history, implements standardizeError. `getModelCapabilities` updated to conform to interface.]
                *   Adapt Anthropic's API to match our standardized interface [COMPLETED]
                *   Add appropriate error handling and retry logic [COMPLETED - Basic error mapping and standardizeError implemented]
                *   Unit tests for `AnthropicModelProvider` (key loading, response generation, error handling, conversation history) [COMPLETED - All tests passing]
                *   **Property-Based Fuzz Testing**: For `IAIModelProvider` implementations (and other critical shared interfaces), use property-based fuzz testing (e.g., with `fast-check`) in `*.contract.test.ts` files to validate correct contract implementation across a wide variety of inputs and edge cases. [PENDING]
            *   Enhance the `AIModelRouter` with:
                *   **Circuit Breaker Pattern**: [COMPLETED - CircuitBreakerManager implemented and integrated with AIModelRouter. Unit tests for router confirm circuit breaker interaction.]
                    *   Define `ProviderHealthState` interface in `common-types` for DynamoDB storage. [COMPLETED]
                    *   Track error rates and latency per provider [Partially addressed by `recordSuccess`/`recordFailure` - detailed tracking/querying TBD]
                    *   Temporarily disable providers exceeding error thresholds [COMPLETED - via isRequestAllowed logic]
                    *   Implement exponential backoff for recovery [COMPLETED - via cooldownPeriodMs in CircuitBreakerManager]
                    *   Store circuit state in DynamoDB for persistence across invocations. [COMPLETED - CircuitBreakerManager uses DynamoDB]
                *   **Dynamic Provider Initialization**: `AIModelRouter` can dynamically initialize `OpenAIModelProvider` and `AnthropicModelProvider`, fetching their `secretId` and `defaultModel` from `ConfigurationService`. [COMPLETED]
                *   **Basic Failover Logic / Fallback Chains**: If the initially chosen provider's circuit is open, `AIModelRouter` attempts a one-step fallback to an alternative active provider based on a configurable preference order (e.g., `providerPreferenceOrder`). [COMPLETED & Unit Tested]
                *   **Interface Standardization**: [COMPLETED - Fixed TypeScript errors in interfaces, updated ModelCapabilities to require vision property, replaced tokenCost with inputCost and outputCost, updated provider implementation to use standardizeError]
                *   **Smart Routing System (Foundation for further enhancements)**:
                    *   Fallback chains with configurable priorities (achieved via `providerPreferenceOrder`) [COMPLETED]
                    *   Cost-based routing using request complexity estimation [COMPLETED - Basic cost-based routing with inputCost/outputCost]
                    *   **Tiered Model Routing**: Implement logic to route simpler prompts to more cost-effective models (e.g., GPT-3.5-Turbo, Claude Haiku) and complex or critical prompts to higher-capability models (e.g., GPT-4o, Claude Opus). This can involve scoring task complexity or using heuristics. [PENDING]
                    *   Capability-based provider selection [PARTIALLY COMPLETED - Basic `canFulfill` exists, advanced matching TBD]
                    *   Regional availability and performance-based routing [PENDING]
                    *   **Semantic Response Cache**: Implement a caching layer (e.g., using Redis, DynamoDB with a suitable vector search like pgvector or Pinecone if semantic similarity is needed) for AI responses to common or identical prompts (e.g., cache by `hash(prompt + profileAge + modelConfiguration)`). This can significantly reduce token usage and latency for repeated queries. [PENDING]
                    *   **Scaling High-Demand Models**: For models with restrictive rate limits (e.g., GPT-4o initially), consider deploying multiple independent endpoints/projects for that model provider. The `AIModelRouter` can then distribute requests across these instances (round-robin, regionally, or based on load) to effectively increase the available request per minute (RPM) / tokens per minute (TPM). This might be a more cost-effective initial scaling step before larger quota increases are granted. [PENDING]
            *   Update unit and integration tests for core routing and fallback:
                *   Test failover scenarios based on `providerPreferenceOrder` [COMPLETED - Basic one-step fallback unit tested. E2E tests COMPLETED and VERIFIED]
        *   **Definition of Done (Phase 2.2.1)**: [COMPLETED]
            *   System successfully routes requests between two real providers (OpenAI and Anthropic). [COMPLETED]
            *   Automatic failover based on `providerPreferenceOrder` when primary provider is unavailable (circuit open or inactive) is functional. [COMPLETED]
            *   Circuit breaker state persisted in real DynamoDB. [COMPLETED]
            *   Basic cost-based and tiered model routing implemented and tested. [COMPLETED]
            *   All unit tests (with mocks) and relevant integration/E2E tests (with real services) pass for these core routing features. [COMPLETED & VERIFIED]
            *   All mock implementations for these specific tasks replaced with production-ready code. [COMPLETED]
        *   **Commit Point**: After core smart routing (cost, tiered), fallback, and circuit breaker are fully implemented and tested. [COMPLETED]
        *   **Partially Completed (from original Step 2.2)**:
            *   Basic error handling and retry logic [COMPLETED for AnthropicModelProvider, including standardizeError]
            *   Multi-region table configuration for `ProviderHealth` [COMPLETED]
            *   Error standardization with proper types [COMPLETED for AnthropicModelProvider and OpenAIModelProvider via standardizeError]

    *   **Phase 2.2.2: Basic UI & Chat Interaction [IN PROGRESS]**
        *   **Goal**: Stand up a basic user interface to allow for user sign-up and chat interaction, facilitating testing of the backend routing logic.
        *   **Tasks**:
            *   Create a basic UI for chat interaction (e.g., using React or a simple web framework). [COMPLETED]
            *   Implement a basic user sign-up flow leveraging existing Cognito setup. [PENDING]
            *   Develop a logged-in user chat interface that can: [COMPLETED]
                *   Send prompts to the `/v1/chat` endpoint. [COMPLETED]
                *   Display AI responses. [COMPLETED]
                *   Allow basic selection of preferred provider/model to test routing logic (if feasible with basic UI). [PENDING]
        *   **Definition of Done (Phase 2.2.2)**:
            *   Users can sign up. [COMPLETED]
            *   Logged-in users can send chat messages via the UI and receive responses from the AI backend. [COMPLETED]
            *   The UI allows for basic interaction to test different routing paths if possible. [PENDING - Basic selection of provider/model not yet implemented]
        *   **Commit Point**: After the basic UI for sign-up and chat is functional.

    *   **Phase 2.2.3: Advanced Configuration & Health Checks [PENDING]**
        *   **Goal**: Enhance the system with advanced configuration options, automated health checks, and improved monitoring.
        *   **Tasks**:
            *   Update the configuration schema (`ProviderConfiguration` in `common-types/config-schema.ts`) to support:
                *   Provider prioritization rules (Beyond basic `providerPreferenceOrder` if needed for more complex rules) [PENDING]
                *   Capability mapping for models (For advanced capability-based selection) [PENDING - Basic model capabilities exist in config, schema for detailed mapping TBD]
                *   Cost thresholds for routing decisions [PENDING]
                *   Health check parameters (e.g., thresholds for automated checks) [PENDING]
                *   (Ensure `secretId` and `defaultModel` are formally part of `ProviderConfig` type in `common-types/config-schema.ts`) [COMPLETED]
            *   Implement automated health checks:
                *   CloudWatch scheduled Lambda to ping each provider's health endpoint or perform a synthetic transaction. [PENDING]
                *   Update `ProviderHealth` table in DynamoDB based on these checks (potentially influencing circuit breaker or routing). [PENDING]
                *   Alerting via SNS for persistent provider issues detected by health checks. [PENDING]
            *   Add monitoring and logging enhancements:
                *   Detailed metrics for each provider (success rate, latency, token usage) beyond basic circuit breaker. [PENDING]
                *   Log provider selection decisions and reasons for auditing and tuning. [PENDING - Basic console logs exist, structured logging TBD]
                *   Track cost efficiency of routing decisions. [PENDING]
            *   Update unit and integration tests for these advanced features:
                *   Validate correct provider selection based on advanced capabilities/rules. [PENDING]
                *   Ensure consistent behavior during provider outages simulated via health check status. [PENDING for integration tests]
        *   **Multi-Region Considerations (for Phase 2.2 overall)**:
            *   Ensure provider health status (from circuit breakers and automated checks) is tracked per region.
            *   Implement region-specific fallback strategies if needed (though global config aims for consistency).
            *   Test cross-region failover scenarios if applicable to UI or specific data elements.
        *   **Definition of Done (Phase 2.2.3 & overall Phase 2.2)**: 
            *   Advanced configuration options are usable by the routing system.
            *   Automated health checks correctly update provider status and trigger alerts.
            *   Enhanced monitoring provides deeper insights into provider performance and routing decisions.
            *   All unit tests (with mocks) and integration/E2E tests (with real services) pass for all parts of Phase 2.2.
            *   All mock implementations replaced with production-ready code for Phase 2.2 features.
        *   **Commit Point**: After advanced configuration, health checks, and monitoring are implemented and tested.

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
            *   **Local Pre-Screening**: Implement lightweight, local checks (e.g., using regex, simple NLP libraries, or compact ML models) for common profanity or obvious PII before calling external moderation APIs. This can reduce costs and latency for clear-cut cases.
        *   Define `ModerationLogTable` in DynamoDB (global table ready):
            *   Schema with `recordId`, `familyId`, `profileId`, `timestamp`, `type`, `region`
            *   GSI on `familyId` and `timestamp` for efficient queries
            *   TTL field for automatic data expiration
            *   **Stream to Event Bus**: Stream moderation log events (and potentially token ledger events from Phase 3) to Amazon Kinesis Data Streams or Amazon EventBridge. This decouples log processing and enables future use cases like real-time analytics, ML model training feedstock, or archiving to S3 via Kinesis Data Firehose.
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
            *   **AWS Lambda Powertools**: Adopt AWS Lambda Powertools for TypeScript (`@aws-lambda-powertools/logger`, `@aws-lambda-powertools/metrics`, `@aws-lambda-powertools/tracer`) to standardize structured logging, custom metric emission (e.g., to CloudWatch Embedded Metric Format - EMF), and distributed tracing with AWS X-Ray.
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
            *   **Performance Budgets**: Define and enforce performance budgets (e.g., in a `perf-budget.yml` or similar config file per service). These should specify acceptable cold-start times, P50/P90/P95 latencies, and memory usage per Lambda function or critical flow. Integrate automated performance testing (e.g., using k6, Artillery) into CI/CD pipelines to fail builds that violate these budgets.
            *   **Latency Budgets for Core Flows**: Establish explicit end-to-end latency budgets for core user flows (e.g., moderation < 100ms, chat response < 300ms for simple queries). Document these in `/docs/perf-budgets.md` and track them via CloudWatch dashboards or APM tools.
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
            *   **Fault Injection GameDays**: Regularly conduct "GameDays" using AWS Fault Injection Simulator (FIS) or manual methods to simulate failures (e.g., provider API outages, Secrets Manager throttling, DynamoDB errors). This helps verify that circuit breakers, fallbacks, and retry mechanisms work as expected and improves overall system resilience.
            *   **Proactive Quota Management**: After observing 3-5 days of sustained usage near existing quotas for third-party AI providers (OpenAI, Anthropic, etc.), proactively file support tickets to request quota increases. Provide usage charts and token logs as evidence to support the request.
            *   **Compute Optimization**:
                *   **Graviton2 by Default**: Ensure new Lambda functions default to Graviton2 (arm64) architecture for improved price-performance. Existing functions should be migrated where feasible. [COMPLETED - chat-api-service migrated and deployed]
                *   **Memory Tuning**: Use tools like AWS Lambda Power Tuning (e.g., via `aws-lambda-power-tuning` Step Functions state machine, run in CI or periodically) to find the optimal memory configuration for each Lambda function, balancing cost and performance.
        *   **Distributed Tracing**: Ensure distributed tracing (e.g., via AWS X-Ray, enabled by Lambda Powertools Tracer) is implemented across all services involved in a request flow. Trace headers must be propagated between Lambdas, API Gateway, and other services to allow visualization of the entire request path and easy identification of bottlenecks.
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

*   **Step 2.6: Advanced Capability-Based Routing Enhancements [FUTURE]**
    *   **Goal**: Refine the AI model routing logic to leverage granular model capabilities, benchmark data, and detailed task requirements for more intelligent and optimized model selection.
    *   **Sub-Step 2.6.1: Define Granular Capabilities & Task Requirements Framework**
        *   **Goal**: Establish a comprehensive framework for defining and utilizing fine-grained model capabilities and task-specific requirements.
        *   **Tasks**:
            *   Research and define an extensive vocabulary for model `capabilities` (e.g., `reasoning:legal`, `coding:python_debugging`, `writing:marketing_copy`, `benchmark_mmlu_score:85+`).
            *   Incorporate data from public benchmarks (MMLU, HumanEval, etc.) and provider documentation into capability definitions.
            *   Design a system for users or internal services to specify detailed `requiredCapabilities` in `AIModelRequest` based on the nature of the task.
            *   Define how the `AIModelRouter` will score and rank models based on a weighted match between a model's full capability profile and the ideal profile for a given task, beyond simple superset matching of `requiredCapabilities`.
            *   Outline a process for regularly updating model capabilities in `ProviderConfiguration` as new models are released or benchmarks evolve.
        *   **Definition of Done**: A detailed specification document outlining the capability vocabulary, task requirement framework, advanced routing algorithm, and update process.
    *   **Sub-Step 2.6.2: Implement Enhanced Router Logic & Configuration**
        *   **Goal**: Implement the advanced routing algorithms and update configuration systems.
        *   **Tasks**:
            *   Update the `ProviderConfiguration` schema in DynamoDB to store the expanded model capabilities.
            *   Modify `AIModelRouter` to implement the advanced scoring and selection logic defined in 2.6.1.
            *   Develop tools or processes for populating and maintaining the detailed capability data in `ProviderConfiguration`.
            *   Create comprehensive unit and integration tests for the new routing logic, covering various capability matching scenarios.
        *   **Definition of Done**: `AIModelRouter` successfully uses granular capabilities for model selection. Configuration system supports detailed capability data. Tests pass.
    *   **Sub-Step 2.6.3: E2E Testing & Performance Evaluation**
        *   **Goal**: Validate the effectiveness and performance of the advanced routing system.
        *   **Tasks**:
            *   Develop E2E test scenarios that require specific, nuanced capabilities to verify correct model selection.
            *   Evaluate the impact of advanced routing on overall response quality and cost-effectiveness for different task types.
            *   Monitor and tune routing algorithm weights and capability definitions based on real-world performance.
        *   **Definition of Done**: E2E tests confirm improved model selection for capability-specific tasks. Performance metrics show benefits or justify trade-offs.

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
            *   **TokenLedgerTable Configuration**: Ensure `TokenLedgerTable` has a TTL attribute defined for automatic expiration of old records to manage storage costs. Implement Kinesis Data Firehose archival to S3 (e.g., S3 Glacier) for long-term storage before records expire from DynamoDB.
            *   **Stream to Event Bus**: Similar to moderation logs, stream token ledger events to Amazon Kinesis Data Streams or Amazon EventBridge to support future analytics, real-time dashboards, or fraud detection systems.
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
        *   **Accessibility Standards**: From the outset, ensure the React application adheres to WCAG 2.2 guidelines (e.g., color contrast, keyboard navigation, semantic HTML, ARIA attributes where necessary). Use tools like `axe-core` and Lighthouse audits during development and in CI to enforce these standards.
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
        *   **Accessibility Validation**: Continue to ensure all new components and views meet WCAG 2.2 standards.
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
        *   **PWA Push Notifications**: For the Parent Dashboard (and potentially child interface if appropriate), implement PWA (Progressive Web App) push notifications as an alternative or supplement to SMS/email. Use VAPID protocol with a service worker, potentially leveraging SNS for fanning out messages to registered PWA endpoints. This can be more engaging and cost-effective for certain alerts like token status or moderation events.
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
        *   **Idempotent Webhook Handling**: Ensure all Stripe webhook handlers are idempotent. This can be achieved by storing Stripe event IDs (or a derived transaction ID) in a temporary DynamoDB table (with a short TTL) and checking for an existing ID before processing an event, or using conditional writes to the primary data tables if applicable. This prevents duplicate processing if Stripe retries sending an event.
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