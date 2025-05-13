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
│           ├── config-schema.ts      # Configuration schemas for AI models
│           ├── ai-interfaces.ts      # AI model provider interfaces
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

3. **Integration Tests**: End-to-end tests for API endpoints
   - Located in `src/integration-tests/` directory
   - Test real AWS endpoints with test users/data
   - Run with `pnpm run test:e2e` 

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
- **Build System:** Turborepo (monorepo orchestration)
- **Testing:** Jest
- **Linting:** ESLint
- **Cloud Infrastructure:** AWS SAM, CloudFormation
- **AWS Services:** Lambda, API Gateway, Cognito, DynamoDB

## Build System & Standardization

### Turborepo for Repeatable Builds

We use Turborepo to ensure consistent, repeatable builds across all packages. This monorepo orchestration tool provides:

1. **Dependency-aware execution**:
   - Tasks run in the correct order based on package dependencies
   - Changes to shared packages automatically trigger rebuilds of dependent applications
   
2. **Intelligent caching**:
   - Identical inputs produce identical outputs without rerunning
   - Remote caching can be enabled for team-wide performance benefits
   
3. **Standardized pipelines**:
   - All commands (`build`, `lint`, `test`, `dev`) are defined centrally in `turbo.json`
   - Consistent behavior across packages, regardless of the underlying tools

4. **Build artifacts management**:
   - Output directories (`dist/`, `.aws-sam/build/`) are clearly specified
   - Prevents accidental inclusion of temporary/build files in Git

### How Our Build Pipeline Works

```
┌──────────────┐     ┌────────────────┐     ┌─────────────────┐
│ pnpm install ├────►│ turbo build    ├────►│ sam build       │
│              │     │ (all packages) │     │ (AWS packaging) │
└──────────────┘     └────────────────┘     └─────────────────┘
                           │
                           ▼
                     ┌────────────────┐
                     │ turbo test     │
                     │ (all packages) │
                     └────────────────┘
```

1. **Initial Setup**: Install dependencies with PNPM workspaces
   ```bash
   pnpm install
   ```

2. **Build All Packages**: Compile TypeScript in the correct dependency order
   ```bash
   pnpm build  # runs turbo build
   ```
   - `common-types` builds first (no dependencies)
   - Services build next, using the built common packages

3. **Run Tests**: Test all packages after building
   ```bash
   pnpm test  # runs turbo test
   ```

4. **Deploy**: Build SAM application (already compiled by Turborepo)
   ```bash
   cd apps/chat-api-service
   pnpm run deploy  # runs build-and-deploy.sh
   ```

### AWS Lambda Deployment

When deploying AWS Lambda functions from a monorepo with workspace dependencies, additional steps are needed to ensure proper bundling:

1. **Workspace Dependencies in Lambda**: AWS Lambda cannot resolve workspace symlinks, which means special handling is required for shared packages.

2. **Our Solution**: We use `build-and-deploy.sh` script that:
   - Builds all packages in the correct order
   - Runs SAM build
   - Properly bundles shared packages by replacing symlinks with actual code
   - Deploys to AWS

3. **Using the Deployment Script**:
   ```bash
   cd apps/chat-api-service
   pnpm run deploy  # or ./build-and-deploy.sh directly
   ```
   This script prompts for AWS profile, region, and stack name (with defaults).

### Enforcing Standards

To maintain strict standards as the application grows:

1. **Always use the standardized commands**:
   - `pnpm build` instead of direct `tsc` calls
   - `pnpm test` instead of direct `jest` calls
   - Never bypass Turborepo, which enforces dependencies

2. **Follow workspace conventions**:
   - Keep dependencies in sync across packages
   - Each package has its own `build` and `test` scripts
   - Package names are consistently prefixed with `@kinable/`

3. **Do not disable caching**:
   - Avoid `--force` flags that bypass caching
   - If builds need to be forced, use `turbo build --force`

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Build all packages:
   ```bash
   pnpm build  # uses Turborepo to build all packages in the correct order
   ```

3. Run tests:
   ```bash
   pnpm test  # uses Turborepo to run tests for all packages
   ```

4. Run linting:
   ```bash
   pnpm lint  # uses Turborepo to lint all packages
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

2. **Deploy with the automated script**:
   ```bash
   pnpm run deploy
   ```
   This command:
   - Builds all packages in the monorepo
   - Packages the Lambda functions with SAM
   - Properly bundles workspace dependencies
   - Deploys to AWS with the specified profile

   For first-time deployments, the script will prompt for:
   - AWS Profile (default: kinable-dev)
   - AWS Region (default: us-east-2)
   - Stack Name (default: kinable-dev)

3. **Run integration tests**:
   ```bash
   pnpm run test:e2e
   ```
   This sends requests to the deployed API endpoints with test data.

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