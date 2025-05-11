# Kinable AI Chat Application: Project Implementation Plan

## Core Working Agreements & Principles

1.  **Interface-Driven Development**:
    *   We do not depend directly on third-party services or SDKs within our core business logic.
    *   We define interfaces within our application (e.g., `IDatabaseProvider`, `IAuthProvider`, `IAIModelProvider`, `IModerationProvider`, `IBillingProvider`).
    *   Concrete implementations of these interfaces (e.g., `DynamoDBProvider`, `CognitoAuthProvider`, `OpenAIProvider`) will adapt the third-party services.
    *   This allows for easier testing (using mocks/stubs for interfaces) and flexibility in swapping out underlying services. Business logic will only interact with these defined interfaces.

2.  **SOLID Design Principles**:
    *   We adhere strictly to SOLID principles (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion) in all code design and implementation.

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
    *   **Definition of Done**: The "Hello World" Lambda is deployed, unit tests pass, and its API Gateway endpoint returns a successful response.
    *   **Commit Point**: After successful deployment and testing.

---

### **Phase 1: Authentication & Authorization Core**

*   **Step 1.1: Setup Amazon Cognito User Pool (via IaC)**
    *   **Goal**: Create a Cognito User Pool to manage family users (guardians and children) using SAM.
    *   **Tasks**:
        *   Define a Cognito User Pool via SAM template (`sam.yaml` in `apps/chat-api-service/`).
            *   Configure standard attributes (email).
            *   Define custom attributes: `familyId` (string), `profileId` (string), `role` (string, e.g., "guardian", "child").
            *   Set up an App Client.
        *   Deploy the changes: `sam deploy --profile kinable-dev`.
        *   Manually create a test guardian user and a test child user in the Cognito console, populating the custom attributes for initial testing.
    *   **Definition of Done**: Cognito User Pool and App Client are created via SAM. Test users exist.
    *   **Commit Point**: After Cognito resources are deployed and test users created.

*   **Step 1.2: Develop Basic Lambda Authorizer with Interfaces**
    *   **Goal**: Create a Lambda Authorizer that validates Cognito JWTs and extracts custom claims, using an `IAuthProvider` interface.
    *   **Tasks**:
        *   In `packages/kinable-types/` (or a dedicated auth package), define `IAuthProvider` interface (e.g., `verifyToken(token: string): Promise<IUserIdentity | null>`) and `IUserIdentity` (containing `userId`, `familyId`, `profileId`, `role`, `isValid`).
        *   Create a `CognitoAuthProvider` implementation of `IAuthProvider` in `apps/chat-api-service/src/auth/`. This class will handle JWT validation against Cognito. Unit test this class with mock JWTs.
        *   Create a new Lambda function (`LambdaAuthorizerFunction`) in `sam.yaml`.
        *   Write the authorizer handler (`src/authorizers/jwtAuthorizer.ts`):
            *   Instantiate `CognitoAuthProvider`.
            *   Use it to verify the token and extract claims.
            *   Return an IAM policy. For now, if `IUserIdentity.isValid` is true, allow.
        *   Unit test the authorizer handler, mocking `IAuthProvider`.
        *   Update the "Hello World" API Gateway endpoint (from Step 0.2) to use this Lambda Authorizer.
        *   Grant the authorizer Lambda appropriate permissions if it needs to fetch JWKS URI dynamically (prefer passing User Pool ID/Region as env vars).
    *   **Definition of Done**: API Gateway endpoint is protected. Valid JWTs grant access; invalid/missing JWTs are denied. `IAuthProvider` and its implementation are unit tested. Authorizer handler is unit tested.
    *   **Commit Point**: After authorizer implementation, testing, and integration with API Gateway.

*   **Step 1.3: Initial DynamoDB Tables & Data Access Interfaces**
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
    *   **Definition of Done**: Tokens deducted and logged via interfaces. Insufficient token scenarios handled. Unit tests pass.
    *   **Commit Point**: After billing/ledger implementation and testing.

---

### **Phase 4: Basic Parent Dashboard (Read-Only) with Frontend & API**

*   **Step 4.1: Setup React App for Parent Dashboard**
    *   **Goal**: Initialize a basic React application.
    *   **Tasks**:
        *   Create `apps/parent-dashboard/`. Scaffold React project (Vite/CRA with TypeScript).
        *   Setup basic routing. Configure build/lint/test scripts.
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
            *   Use `IDatabaseProvider` to query `ProfilesTable` by `familyId`.
            *   Return profiles.
        *   Unit test handler, mocking `IDatabaseProvider`.
        *   Grant `GetFamilyProfilesFunction` read access to `ProfilesTable`.
    *   **Definition of Done**: Guardian can get profiles via API. Child gets 403. Unit tests pass.
    *   **Commit Point**: After dashboard API endpoint implementation and testing.

*   **Step 4.3: Frontend Integration for Profile Listing**
    *   **Goal**: Dashboard React app fetches and displays profiles.
    *   **Tasks**:
        *   Implement Cognito login in React app (e.g., AWS Amplify UI or `amazon-cognito-identity-js`).
        *   Create a service/hook in React to call `/dashboard/profiles` with JWT.
        *   Display profiles in a component.
        *   Basic unit/integration tests for the React components.
    *   **Definition of Done**: Logged-in guardian sees family profiles in the React app.
    *   **Commit Point**: After frontend integration and display of profiles.

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

---

This project plan will be stored as `PROJECT_PLAN.md` in the root of the `kinable` repository.

**Next Steps:**

Shall we begin with **Phase 0, Step 0.1: Verify Monorepo and Tooling Setup**?
Or would you like to refine any part of this plan further? 