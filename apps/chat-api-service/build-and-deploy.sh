#!/bin/bash
set -e

# Ensure we're in the right directory
cd "$(dirname "$0")"

TEMP_LOCKFILE_NAME="pnpm-lock.yaml.sam-build-temp"
BUILD_COMMON_TYPES_DIR=".build-common-types"

# Cleanup function to remove temp lockfile and build directory
cleanup() {
  echo "Cleaning up temporary lockfile..."
  rm -f "$TEMP_LOCKFILE_NAME"
  echo "Cleaning up temporary common-types directory..."
  rm -rf "$BUILD_COMMON_TYPES_DIR"
}

# Set trap to ensure cleanup runs on script exit or failure
trap cleanup EXIT SIGINT SIGTERM

echo "=== Building and deploying chat-api-service to AWS ==="

# Step 1: Build all packages in the monorepo
echo "=== Step 1: Building all packages ==="
cd ../..
pnpm build
cd - > /dev/null # Return to apps/chat-api-service

# Step 1.5: Prepare lockfile for SAM build
echo "=== Step 1.5: Preparing lockfile for SAM build ==="
cp ../../pnpm-lock.yaml "$TEMP_LOCKFILE_NAME"

# Step 1.6: Prepare common-types for SAM build
echo "=== Step 1.6: Preparing common-types for SAM build ==="
mkdir -p "$BUILD_COMMON_TYPES_DIR/dist"
cp -r ../../packages/common-types/dist/* "$BUILD_COMMON_TYPES_DIR/dist/"
cp ../../packages/common-types/package.json "$BUILD_COMMON_TYPES_DIR/"
echo "Created temporary common-types at $BUILD_COMMON_TYPES_DIR"

# Step 2: Run SAM build (will now use Makefile)
echo "=== Step 2: Building Lambda package with SAM ==="
sam build -t sam.yaml

# Temporary files will be removed by the trap on exit

# Step 4: Deploy to AWS
echo "=== Step 4: Deploying to AWS ==="
read -p "Enter AWS profile (default: kinable-dev): " AWS_PROFILE
AWS_PROFILE=${AWS_PROFILE:-kinable-dev}

read -p "Enter AWS region (default: us-east-2): " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-2}

read -p "Enter stack name (default: kinable-dev): " STACK_NAME
STACK_NAME=${STACK_NAME:-kinable-dev}

echo "Deploying to stack $STACK_NAME in region $AWS_REGION using profile $AWS_PROFILE..."
sam deploy --stack-name $STACK_NAME --region $AWS_REGION --profile $AWS_PROFILE --no-confirm-changeset

echo "=== Deployment complete! ==="
echo "You can now run integration tests with:"
echo "node src/integration-tests/fullChatFlow.integration.test.mjs" 