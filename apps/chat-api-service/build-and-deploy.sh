#!/bin/bash
set -e

# Ensure we're in the right directory
cd "$(dirname "$0")"

echo "=== Building and deploying chat-api-service to AWS ==="

# Step 1: Build all packages in the monorepo
echo "=== Step 1: Building all packages ==="
cd ../..
pnpm build
cd - > /dev/null

# Step 2: Run SAM build
echo "=== Step 2: Building Lambda package with SAM ==="
sam build -t sam.yaml

# Step 3: Fix the symlinks to ensure AWS Lambda can find all dependencies
echo "=== Step 3: Fixing package dependencies for AWS Lambda ==="
for function_dir in .aws-sam/build/*/; do
  echo "Processing: $function_dir"
  
  # Check if @kinable directory exists in node_modules
  if [ -d "${function_dir}node_modules/@kinable" ]; then
    # If common-types is a symlink, replace it with actual files
    if [ -L "${function_dir}node_modules/@kinable/common-types" ]; then
      echo "Replacing symlink with actual files in $function_dir"
      rm -f "${function_dir}node_modules/@kinable/common-types"
      mkdir -p "${function_dir}node_modules/@kinable/common-types"
      cp -r ../../packages/common-types/dist/* "${function_dir}node_modules/@kinable/common-types/"
      cp ../../packages/common-types/package.json "${function_dir}node_modules/@kinable/common-types/"
    fi
  else
    echo "Creating @kinable/common-types directory in $function_dir"
    mkdir -p "${function_dir}node_modules/@kinable/common-types"
    cp -r ../../packages/common-types/dist/* "${function_dir}node_modules/@kinable/common-types/"
    cp ../../packages/common-types/package.json "${function_dir}node_modules/@kinable/common-types/"
  fi
done

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