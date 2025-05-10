# Kinable Project

A monorepo for Kinable services and shared packages, setup for AWS serverless development.

## Project Structure

```
kinable/
├── apps/                      # Application packages
│   └── api-example-service/   # Example Lambda API service
├── packages/                  # Shared internal packages
│   └── common-types/          # Shared TypeScript types
```

## Tech Stack

- **Languages:** TypeScript
- **Package Management:** PNPM with workspaces
- **Build System:** Turborepo
- **Testing:** Jest
- **Linting:** ESLint
- **Cloud Infrastructure:** AWS SAM

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

## Deployment

For Lambda services, run the following from the service directory:

```bash
pnpm run deploy
```

This will run the SAM deploy process with guided setup. 