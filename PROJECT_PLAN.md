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
    *   DynamoDB partition keys incorporate region information (e.g., `PK = FAMILY#<region>#<familyId>`).
    *   All authorization and data operations remain region-local.
    *   Interfaces should be designed to accommodate region-specific implementations.

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
        *   In `packages/common-types/` (or a dedicated auth package), define `IAuthProvider` interface (e.g., `verifyToken(token: string): Promise<IUserIdentity | null>`) and `IUserIdentity` (containing `userId`, `familyId`, `profileId`, `role`, `isAuthenticated`).
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

*   **Step 1.3: Initial DynamoDB Tables & Data Access Interfaces [COMPLETED]**
    *   **Goal**: Create DynamoDB tables for `Families` and `Profiles` via SAM, and define data access interfaces.
    *   **Tasks**:
        *   In `packages/kinable-types/` (or a dedicated data package), define:
            *   `IDatabaseProvider` interface with methods like `getItem(tableName: string, key: object): Promise<object | null>`, `updateItem(...)`, etc.
            *   Interfaces for `FamilyData` (`familyId`, `tokenBalance`, `pauseStatusFamily`) and `ProfileData` (`profileId`, `familyId`, `role`, `pauseStatusProfile`).
        *   Define two DynamoDB tables in `sam.yaml`: `FamiliesTable`, `ProfilesTable` with initial attributes.
        *   Deploy SAM changes.
        *   Create `DynamoDBProvider` implementation of `IDatabaseProvider` in `apps/chat-api-service/src/data/`. Unit test this with mocks for the AWS SDK.
        *   Grant the Lambda Authorizer read access to these tables (GetItem).
        *   Manually populate with dummy data corresponding to test Cognito users.
    *   **Multi-Region Consideration**:
        *   Use region-aware naming for tables (e.g., `KinableFamilies-${AWS::Region}-${AWS::StackName}`).
        *   Design partition keys to incorporate region (prepare for `FAMILY#<region>#<familyId>` format).
        *   Ensure the `DynamoDBProvider` implementation accepts region as a parameter.
    *   **Learnings**:
        *   When mocking AWS SDK v3 in Jest tests, using class-based mocks for command constructors (e.g., `GetCommand`, `PutCommand`) provides more reliable test behavior than trying to re-export from the original module.
        *   Setting test expectations with `expect.any(Object)` instead of specific command types provides more flexible test assertions.
    *   **Definition of Done**: Tables are created via SAM. `IDatabaseProvider` and its `DynamoDBProvider` implementation exist and are unit tested. Authorizer has IAM permissions.
    *   **Commit Point**: After table creation, interface/implementation development, and testing.

*   **Step 1.4: Enhance Lambda Authorizer with DB Checks via Interfaces**
    *   **Goal**: Update Lambda Authorizer to use `IDatabaseProvider` to fetch and use `pause_status` and `tokenBalance`.
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
    *   **Multi-Region Consideration**:
        *   The `DynamoDBProvider` instance used within the authorizer must be configured for the Lambda's current operational region (e.g., via `process.env.AWS_REGION`).
        *   When fetching data from `FamiliesTable` and `ProfilesTable`, keys must be constructed to include the region identifier if the partition key design incorporates it (e.g., `FAMILY#<region>#<familyId>`). The region for the key should be derived from the user's `custom:region` JWT claim. If the claim is unavailable, the authorizer may need to deny access or default to its own operational region based on clearly defined rules.
        *   Ensure IAM permissions for the authorizer to DynamoDB tables correctly reference the regionally named tables (e.g., using `!Sub` with `${AWS::Region}` in ARNs).
    *   **Definition of Done**: Authorizer correctly denies access based on data fetched via `IDatabaseProvider`. Unit tests updated and pass.
    *   **Commit Point**: After authorizer enhancements and thorough testing.

---

### **Phase 2: Core Chat Functionality**

*   **Step 2.1: Develop Chat Router Lambda (Single Model) with Interfaces**
    *   **Goal**: Create a Lambda that uses an `IAIModelProvider` interface to send a prompt to an AI model and return the response.
    *   **Tasks**:
        *   In `packages/kinable-types/` (or a dedicated AI package), define `IAIModelProvider` (e.g., `generateResponse(prompt: string, userId: string): Promise<AIResponse>`) and `AIResponse` (containing `text`, `promptTokens`, `completionTokens`).
        *   Create `OpenAIModelProvider` implementation of `IAIModelProvider` in `apps/chat-api-service/src/ai/`. This class will handle calls to OpenAI. Unit test this class, mocking the OpenAI SDK/API calls.
        *   Store the OpenAI API key in AWS Secrets Manager.
        *   Create `ChatRouterFunction` Lambda in `sam.yaml`. Grant it permission to read the secret.
        *   Write handler code (`src/handlers/chatRouter.ts`):
            *   Inject/instantiate `OpenAIModelProvider`.
            *   Retrieve API key from Secrets Manager (can be done within the provider).
            *   Accept a prompt from the API Gateway event (validated by authorizer).
            *   Use `IAIModelProvider` to get the AI's response.
            *   Return the response.
        *   Unit test the `ChatRouterFunction` handler, mocking `IAIModelProvider`.
        *   Create a new `/chat` POST endpoint in API Gateway, protected by `LambdaAuthorizerFunction`.
    *   **Multi-Region Consideration**:
        *   Design `IAIModelProvider` to support region-specific model routing.
        *   Secrets Manager keys should follow region-aware naming pattern.
        *   Prepare for region-specific model availability (some AI providers have regional restrictions).
    *   **Definition of Done**: `/chat` endpoint successfully returns an AI response via the interface-driven model provider. Unit tests pass. API key is secure.
    *   **Commit Point**: After chat router implementation, interface/provider development, and testing.

*   **Step 2.2: Basic Moderation Engine Lambda (Pre-Prompt) with Interfaces**
    *   **Goal**: Create a `ModerationEngineFunction` using an `IModerationProvider` to check prompts.
    *   **Tasks**:
        *   In `packages/kinable-types/` (or a dedicated moderation package), define `IModerationProvider` (e.g., `checkText(text: string, userId: string): Promise<ModerationResult>`) and `ModerationResult` (containing `isFlagged`, `categories`, `filteredText?`).
        *   Create `OpenAIModerationProvider` implementation of `IModerationProvider` in `apps/chat-api-service/src/moderation/`. Unit test this.
        *   Create `ModerationEngineFunction` Lambda in `sam.yaml`. Grant secret access if needed.
        *   Write handler code (`src/handlers/moderationEngine.ts`):
            *   Inject/instantiate `OpenAIModerationProvider`.
            *   Call `IModerationProvider.checkText()`.
            *   Log to `ModerationLogTable` (defined in `sam.yaml`, schema per `TECH_ROADMAP.md`) via `IDatabaseProvider` if flagged. Grant Lambda write access.
            *   Return result.
        *   Unit test the handler, mocking `IModerationProvider` and `IDatabaseProvider`.
        *   Modify `ChatRouterFunction`:
            *   Invoke `ModerationEngineFunction` (or directly use `IModerationProvider`) with the user's prompt.
            *   If moderation blocks, return an error.
        *   Update `ChatRouterFunction` unit tests.
    *   **Multi-Region Consideration**:
        *   Moderation logs should include region information.
        *   Ensure `ModerationLogTable` follows region-aware naming and partition key design.
    *   **Definition of Done**: Prompts are moderated via interfaces. Flagged prompts are blocked and logged. Unit tests pass.
    *   **Commit Point**: After moderation implementation for prompts, testing.

*   **Step 2.3: Moderation Engine Lambda (Post-Response) via Interfaces**
    *   **Goal**: Enhance to moderate AI responses using `IModerationProvider`.
    *   **Tasks**:
        *   Modify `ChatRouterFunction`:
            *   After receiving AI response, use `IModerationProvider.checkText()` with the AI's response.
            *   If flagged, filter/block and log.
        *   Update `ModerationLogTable` entries to distinguish prompt vs. response moderation.
        *   Update `ChatRouterFunction` unit tests.
    *   **Definition of Done**: AI responses are moderated. Flagged content handled and logged. Unit tests pass.
    *   **Commit Point**: After moderation implementation for responses, testing.

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
        *   Token ledger entries must include region information.
        *   Billing operations should be isolated to the user's region to prevent cross-region consistency issues.
        *   `TokenLedgerTable` should follow region-aware naming and partition key strategy.
    *   **Definition of Done**: Tokens deducted and logged via interfaces. Insufficient token scenarios handled. Unit tests pass.
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
    *   **Definition of Done**: Basic React app runs locally, with build/test setup.
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
    *   **Definition of Done**: Guardian can get profiles via API. Child gets 403. Unit tests pass.
    *   **Commit Point**: After dashboard API endpoint implementation and testing.

*   **Step 4.3: Frontend Integration for Profile Listing**
    *   **Goal**: Dashboard React app fetches and displays profiles.
    *   **Tasks**:
        *   Implement Cognito login in React app (e.g., AWS Amplify UI or `amazon-cognito-identity-js`), ensuring it's configured for the regional Cognito User Pool.
        *   Create a service/hook in React to call `/dashboard/profiles` with JWT.
        *   Display profiles in a component.
        *   Basic unit/integration tests for the React components.
    *   **Definition of Done**: Logged-in guardian sees family profiles in the React app.
    *   **Commit Point**: After frontend integration and display of profiles.

*   **Step 4.4: Basic Child Chat Interface (MVP)**
    *   **Goal**: Create a minimal, functional interface for a child to send prompts and receive AI responses, demonstrating the end-to-end chat flow.
    *   **Tasks**:
        *   Develop a simple client (e.g., a basic web component or a very streamlined Flutter view if resources allow) for child interaction.
        *   Integrate with the `/chat` endpoint.
        *   Display AI responses.
        *   Ensure it respects authentication and authorization from Phase 1.
    *   **Multi-Region Consideration**: Similar to Parent Dashboard: API endpoint configuration and Cognito integration should be region-aware.
    *   **Definition of Done**: A child user can log in (via test credentials), send a prompt, and receive a moderated AI response. Basic token deduction is visible in `FamiliesTable`.
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
    *   **Definition of Done**: Moderation flow is managed by Step Functions. Existing moderation capabilities are preserved. Unit tests for Step Function integration pass.
    *   **Commit Point**: After Step Function based moderation engine is implemented and tested.

*   **Step 5.2: Readability Rewriter Service**
    *   **Goal**: Implement a service to adjust the complexity and style of AI responses to be more age-appropriate.
    *   **Tasks**:
        *   Define `IReadabilityProvider` interface and its implementation (e.g., using another LLM call to simplify text via `IAIModelProvider`).
        *   Integrate the `ReadabilityRewriterService` as an optional step in the Moderation Step Function.
        *   Add controls in the Parent Dashboard for guardians to enable/configure readability settings per profile.
    *   **Multi-Region Consideration**: `IAIModelProvider` used by the rewriter should be region-aware. Any data storage/logging specific to readability should be regional.
    *   **Definition of Done**: AI responses can be automatically simplified based on profile settings. Parent dashboard controls are functional.
    *   **Commit Point**: After Readability Rewriter is implemented and integrated.

*   **Step 5.3: Advanced Moderation Rules & Enhanced Logging**
    *   **Goal**: Implement the custom age-based rule engine and improve detail in moderation logging.
    *   **Tasks**:
        *   Develop the custom rule engine logic (as per `TECH_ROADMAP.md`).
        *   Integrate this engine into the `IModerationProvider` or directly into the Step Function workflow.
        *   Expand `ModerationLogTable` schema to include more detailed context about flagged content and applied rules (e.g., rule ID, matched content snippet).
    *   **Multi-Region Consideration**: `ModerationLogTable` is already noted to be region-aware. Custom rules, if stored (e.g., in DynamoDB or config files), should be manageable per region.
    *   **Definition of Done**: Custom moderation rules are active and integrated. Logs provide comprehensive audit trails for moderation events.
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
    *   **Definition of Done**: Access control for defined actions is governed by Cedar policies in AVP. Unit tests for policy enforcement pass.
    *   **Commit Point**: After AVP integration and initial policy setup.

*   **Step 6.2: Notification System (SNS/SES)**
    *   **Goal**: Implement a system for notifying users of important events.
    *   **Tasks**:
        *   Set up SNS topics for different event types (e.g., token quota warnings, content moderation flags, major account changes).
        *   Configure SES for sending email notifications, including verified sender identities and email templates.
        *   Integrate event publishing into relevant services (e.g., `BillingLedgerFunction` for token warnings, `ModerationEngine` Step Function for flags).
        *   Add notification preferences in the Parent Dashboard (e.g., opt-in/out for certain notification types).
    *   **Multi-Region Consideration**: SNS Topics and SES configurations are regional. Notifications should be triggered and sent from the user's primary region. Manage templates per region if they have regional content.
    *   **Definition of Done**: Users receive notifications for configured events based on their preferences.
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
    *   **Definition of Done**: End-to-end Stripe billing flow is operational for subscriptions and booster packs. Parent dashboard provides billing management.
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
    *   **Definition of Done**: Chat messages are delivered in real-time via WebSockets to appropriate clients. Connection handling is robust.
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

**Next Steps:**

Shall we begin with **Phase 0, Step 0.1: Verify Monorepo and Tooling Setup**?
Or would you like to refine any part of this plan further? 