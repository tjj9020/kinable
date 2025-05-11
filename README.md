# Kinable Project

A monorepo for Kinable services and shared packages, setup for AWS serverless development. This repository houses a family-safe, token-based AI chat application.

## Project Structure

```
kinable/
├── apps/                             # Application packages
│   ├── chat-api-service/             # Main API service for chat functionality
│   │   ├── dist/                     # Compiled TypeScript output
│   │   ├── src/                      # Source code
│   │   │   ├── auth/                 # Authentication providers and logic
│   │   │   ├── authorizers/          # Lambda authorizer functions
│   │   │   ├── data/                 # Data access providers (future)
│   │   │   ├── handlers/             # Lambda handler functions
│   │   │   └── models/               # Model interfaces and implementations (future)
│   │   ├── sam.yaml                  # SAM template for deployment
│   │   └── tests/                    # Service-level tests
│   └── parent-dashboard/             # React app for parent dashboard (future)
├── packages/                         # Shared internal packages
│   └── common-types/                 # Shared TypeScript interfaces and types
│       └── src/                      # Source folder
│           ├── core-interfaces.ts    # Core application interfaces
│           └── index.ts              # Package entry point
├── tools/                            # Developer tools & utilities
│   └── auth-testing/                 # Authentication testing utilities
└── PROJECT_PLAN.md                   # Project implementation plan
```

## Code Organization Guidelines

### Interface-Driven Development

1. **Define Interfaces First**: All integrations with external services should be abstracted behind interfaces.
   - Define interfaces in `packages/common-types/` before implementation
   - Example interfaces: `IAuthProvider`, `IDatabaseProvider`, `IAIModelProvider`

2. **Provider Pattern**: Use the provider pattern for concrete implementations
   - Place implementations in the appropriate service directory (`apps/{service}/src/{category}/`)
   - Example: `CognitoAuthProvider` in `apps/chat-api-service/src/auth/`

3. **Service Structure**:
   - `src/auth/` - Authentication-related code
   - `src/authorizers/` - API Gateway authorizers
   - `src/data/` - Database interactions
   - `src/handlers/` - Lambda handlers (entry points)
   - `src/models/` - AI model interactions
   - `src/moderation/` - Content moderation

### Testing Approach

1. **Unit Tests**: All classes/functions should have unit tests
   - Place tests alongside source files (e.g., `CognitoAuthProvider.test.ts` next to `CognitoAuthProvider.ts`)
   - Use Jest mocks for dependencies
   - Focus on testing business logic in isolation

2. **Mocks**: Use `__mocks__` directories for common mocks
   - Example: `src/auth/__mocks__/CognitoAuthProvider.ts`

### Deployment & Infrastructure

1. **SAM Templates**: Each service should have a `sam.yaml` file defining all cloud resources
   - Use CloudFormation parameters and outputs
   - Define IAM roles with the principle of least privilege

2. **Environment Variables**: Use environment variables for configuration
   - Pass through SAM template to Lambda functions
   - Store secrets in AWS Secrets Manager

## Tech Stack

- **Languages:** TypeScript
- **Package Management:** PNPM with workspaces
- **Build System:** Turborepo
- **Testing:** Jest
- **Linting:** ESLint
- **Cloud Infrastructure:** AWS SAM, CloudFormation
- **AWS Services:** Lambda, API Gateway, Cognito, DynamoDB

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Build all packages:
   ```bash
   pnpm build
   ```

3. Run tests:
   ```bash
   pnpm test
   ```

4. Run linting:
   ```bash
   pnpm lint
   ```

## Development

This project uses the AWS SSO configuration for the "Kinable Development" AWS account. See the [NEW_PROJECT_GUIDE.md](NEW_PROJECT_GUIDE.md) for detailed instructions on working with AWS resources.

Refer to [PROJECT_PLAN.md](PROJECT_PLAN.md) for the detailed implementation plan and current progress.

## Deployment

### SAM Build and Deployment Workflow

Our serverless applications are built and deployed using AWS SAM (Serverless Application Model). Follow these steps for deployment:

1. **Build the TypeScript code**:
   ```bash
   cd apps/chat-api-service
   pnpm build
   ```
   This compiles TypeScript to JavaScript in the `dist/` directory, which SAM will package.

2. **Build the SAM application**:
   ```bash
   sam build -t sam.yaml
   ```
   This command:
   - Processes the SAM template (`sam.yaml`)
   - Copies source code and dependencies
   - Creates deployment artifacts in `.aws-sam/build/`

3. **Deploy to AWS**:
   ```bash
   sam deploy -t sam.yaml --profile kinable-dev
   ```
   This command:
   - Uses the AWS `kinable-dev` profile (defined in AWS SSO)
   - Deploys resources to the AWS account (105784982857)
   - Creates/updates CloudFormation stack
   - Packages and uploads artifacts to S3
   - Deploys Lambda functions, API Gateway, and other resources

   For first-time deployments, use guided mode:
   ```bash
   sam deploy -t sam.yaml --guided --profile kinable-dev
   ```
   This will walk you through configuration options and save them to `samconfig.toml`.

4. **Verify deployment**:
   ```bash
   aws cloudformation describe-stacks --stack-name chat-api-service --profile kinable-dev
   ```
   Or check the CloudFormation console in the AWS Management Console.

### Troubleshooting Deployments

- If your SSO token expires, refresh it with:
  ```bash
  aws sso login --profile kinable-dev
  ```

- For stack deployment failures, check CloudFormation in the AWS Console:
  - Look for stacks in `ROLLBACK_FAILED` or `UPDATE_ROLLBACK_FAILED` states
  - You may need to manually delete failed stacks before redeploying

- Verify Lambda functions have correct IAM permissions via their execution roles

- For API Gateway issues, check the API endpoint configuration and authorizer settings 