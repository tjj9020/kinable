# Quick Start Guide: New Project in Kinable Development Environment

## 1. Introduction

This guide provides instructions and best practices for starting a new project that will leverage the "Kinable Development" AWS account (ID: `105784982857`). It assumes you will be interacting with AWS resources using the AWS CLI and related tools (like AWS SAM CLI) configured with the `kinable-dev` profile.

## 2. Prerequisites

Before you begin, ensure you have the following:

*   **AWS CLI Installed:** If not already installed, follow the instructions at [Installing the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html).
*   **`kinable-dev` AWS CLI Profile Configured:**
    *   You must have configured this profile using `aws configure sso`.
    *   **SSO Start URL:** `https://d-9a6764510d.awsapps.com/start`
    *   During configuration, you should have selected the "Kinable Development" account (105784982857) and the "LingivoEnvironmentManager" permission set.
    *   If you haven't done this, run `aws configure sso --profile kinable-dev` (or just `aws configure sso` and choose `kinable-dev` as the profile name).
*   **Git Installed:** For version control.
*   **Development Tools:**
    *   Install necessary tools for your project's programming language and framework (e.g., Node.js, Python, Java, Go).
    *   **AWS SAM CLI (Recommended for Serverless Applications):** If you plan to build serverless applications, install the AWS SAM CLI: [Installing the AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html).

## 3. Setting Up Your New Project Repository

1.  **Create a New Repository:** Create a new Git repository (e.g., on GitHub, GitLab, AWS CodeCommit).
2.  **Clone Locally:** `git clone <your-repository-url>`
3.  **Initial Project Structure (Example):**
    ```
    your-new-project/
    ├── .git/
    ├── .gitignore
    ├── README.md
    ├── src/                     # Your application code
    ├── tests/                   # Unit, integration tests
    ├── infrastructure/          # IaC templates (e.g., SAM, CloudFormation)
    └── scripts/                 # Helper scripts (build, deploy, etc.)
    ```
4.  **Initialize `.gitignore`:** Add a `.gitignore` file appropriate for your project type and language (e.g., from [gitignore.io](https://www.toptal.com/developers/gitignore)).

## 4. Interacting with AWS using the `kinable-dev` Profile

Always ensure you are targeting the "Kinable Development" account by using the `kinable-dev` profile.

*   **Using the `--profile` flag:**
    ```bash
    aws s3 ls --profile kinable-dev
    sam deploy --guided --profile kinable-dev
    ```
*   **Setting the `AWS_PROFILE` Environment Variable (for the current terminal session):**
    ```bash
    export AWS_PROFILE=kinable-dev
    # Now subsequent commands in this session use the profile by default
    aws s3 ls
    sam deploy --guided
    ```

### Example: AWS SAM Workflow (Serverless Applications)

1.  **Initialize a new SAM application (if applicable):**
    ```bash
    sam init # Follow prompts
    ```
2.  **Build your application:**
    ```bash
    cd your-sam-app-directory/
    sam build --profile kinable-dev
    ```
3.  **Deploy your application:**
    The `--guided` flag is recommended for first-time deployments as it prompts for necessary parameters.
    ```bash
    sam deploy --guided --profile kinable-dev
    ```
    For subsequent deployments, you might use:
    ```bash
    sam deploy --stack-name your-stack-name --s3-bucket your-deployment-s3-bucket --capabilities CAPABILITY_IAM --profile kinable-dev
    ```
    *(Note: The `LingivoEnvironmentManager` permission set, with `PowerUserAccess`, should generally provide sufficient permissions for these operations in the dev account.)*

### Example: General AWS CloudFormation Deployment

```bash
aws cloudformation deploy \
  --template-file infrastructure/your-template.yaml \
  --stack-name your-new-project-stack \
  --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --profile kinable-dev
```

### Example: Interacting with other AWS Services

*   **Create an S3 Bucket:**
    ```bash
    aws s3 mb s3://your-unique-project-bucket-kinable-dev --profile kinable-dev
    ```
*   **List Lambda Functions:**
    ```bash
    aws lambda list-functions --profile kinable-dev
    ```

## 5. Development Best Practices

*   **Infrastructure as Code (IaC):**
    *   **ALWAYS** define your AWS resources using IaC (e.g., AWS SAM, AWS CloudFormation, CDK, Terraform).
    *   Store these templates within your project's `infrastructure/` (or similar) directory and commit them to version control.
    *   This ensures repeatability, traceability, and easier collaboration.
*   **Permissions:**
    *   The "LingivoEnvironmentManager" permission set provides broad `PowerUserAccess` suitable for development.
    *   Be mindful that for staging or production environments, you will need more restrictive, least-privilege IAM roles and permission sets.
*   **Resource Naming:** Adopt a consistent naming convention for your AWS resources, including an environment identifier (e.g., `kinable-dev-my-lambda`).
*   **Cost Management:** The "Kinable Development" account is for development. Be mindful of the resources you create and clean up unused resources to avoid unnecessary costs.
*   **Secrets Management:** For any sensitive data (API keys, database passwords), use AWS Secrets Manager or AWS Systems Manager Parameter Store instead of hardcoding them in your application or templates.
*   **Branching Strategy:** Use a Git branching strategy (e.g., GitFlow, feature branches) to manage your code and infrastructure changes.

## 6. Key Reminders & Information

*   **Profile:** Always use the `kinable-dev` AWS CLI profile.
*   **Account ID:** The "Kinable Development" account ID is `105784982857`.
*   **SSO Credentials:** Your SSO session provides temporary credentials. If they expire, the AWS CLI will typically prompt you to re-authenticate by opening your browser. You can also manually refresh by running `aws sso login --profile kinable-dev`.
*   **Organization Documentation:** For details on the overall AWS Organization structure, other accounts, and primary IaC for organization/SSO management, refer to the `README.md` in the central AWS management repository.

## 7. Troubleshooting Tips

*   **Verify Identity:** `aws sts get-caller-identity --profile kinable-dev` (Verifies the account and role your CLI is currently using).
*   **Check CloudTrail:** If API calls fail, check AWS CloudTrail in the "Kinable Development" account for detailed error messages.
*   **Ensure SSO Session is Active:** If commands suddenly fail, try `aws sso login --profile kinable-dev`.
*   **SAM CLI Issues:** Ensure your SAM CLI is up to date (`sam --version`). Check the `sam build` and `sam deploy` logs for errors.

---

This guide should provide a solid foundation. You can adapt and expand it with project-specific details as needed. 