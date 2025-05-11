Here’s a **project prompt** you can commit to your Git repository as `PROJECT_CONTEXT.md`. It serves as a central onboarding document for contributors, AI agents, and human developers — giving them immediate clarity on your goals, MVP scope, and where to find deeper technical references.

---

```markdown
# PROJECT_CONTEXT.md

## Overview

This project is a scalable, secure, and AI-powered family communication platform. It enables parents and children to safely engage with large language models (LLMs) like GPT-4o, Claude Sonnet, and Bedrock Claude through shared, moderated, and token-metered interactions.

Our product provides:
- A **shared token-based subscription model** for families
- **Parental oversight**, moderation, and controls
- **Model routing and billing intelligence**
- **AI-enhanced learning and conversation tools** designed for kids and teens

This application is built on a **serverless AWS architecture** that supports high concurrency, low latency, and clear cost boundaries.

---

## MVP Goals

The MVP focuses on enabling families to safely and effectively use AI chat for learning, planning, creativity, and curiosity.

### Core MVP Capabilities
- Multi-profile family accounts (parent + children)
- AI chat via OpenAI GPT-4o, Claude Sonnet, or Bedrock Claude
- Real-time moderation and age-based safety filtering
- Token tracking per family (usage limits, booster packs)
- Parental dashboard (pause profile, view usage, purchase tokens)
- Booster pack Stripe billing flow
- System-enforced routing of prompts to lowest-cost eligible model

---

## MVP User Journeys

### 🧑‍🎓 Teen (Child Profile)
> As a teen, I want to ask questions, explore topics, and get help with homework using safe and respectful AI tools.

- Interacts via chat interface (mobile/web)
- Receives real-time filtered responses
- Uses "Explain-It Mode" for simplification
- May trigger token use alerts to parents

### 👩 Parent (Guardian Profile)
> As a parent, I want to supervise and configure how my kids use the AI system, review conversations, and manage our subscription.

- Views per-child usage reports
- Sets limits or pauses accounts
- Upgrades plan or buys boosters via Stripe
- Gets notified when token limits are near

### ⚙️ System / Admin
> As the system, I must meter every prompt, enforce moderation rules, and route traffic efficiently to preserve cost and safety.

- Applies model billing multipliers
- Logs moderation events
- Uses DynamoDB and S3 for token/account history
- Sends alerts (SNS/email) when needed

---

## Technical Documentation

Please refer to the following files for implementation and build guidance:

- [`TECH_ROADMAP.md`](./TECH_ROADMAP.md): Full implementation plan, stack decisions, security model, and service boundaries.
- [`NEW_PROJECT_GUIDE.md`](./NEW_PROJECT_GUIDE.md): How to work with our AWS environments, deploy infrastructure, and test serverless APIs.
- [`README.md`](./README.md): Directory structure, tooling setup, and build instructions.

---

## Contribution Guidelines

Any code, agent behavior, or service module must:
- Respect our token accounting system
- Enforce age-based safety logic
- Preserve privacy (no unauthorized data sharing)
- Use configuration over hardcoded logic (model routing, limits)

You may use this document as a context foundation for AI agent chains, engineering assistants, or onboarding workflows.

```

---

Would you like a follow-up version of this prompt that’s optimized for an OpenAI function-calling agent or GitHub Copilot agent?
