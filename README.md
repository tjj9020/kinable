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

For Lambda services, run the following from the service directory:

```bash
cd apps/chat-api-service
pnpm build                # Compile TypeScript
sam build -t sam.yaml     # Build SAM package
sam deploy -t sam.yaml --profile kinable-dev  # Deploy
```

This will run the SAM deploy process with guided setup for the first deployment. Subsequent deployments can use the generated `samconfig.toml` file. 