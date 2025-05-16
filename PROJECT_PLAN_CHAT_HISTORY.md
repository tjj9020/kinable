# Project Plan: Robust Chat History for kinable-public-ws

This document outlines the plan to enhance the chat history functionality in `kinable-public-ws`, focusing on robustness, scalability, flexible organization, and improved user experience.

## Goals

*   Allow users to manage individual **Conversations** (chat sessions).
*   Enable users to optionally group Conversations under user-defined **Topics** (Projects/Umbrella Groupings).
*   Support starting Conversations independently or directly within a Topic.
*   Support assigning existing independent Conversations to Topics.
*   Display a primary list of all recent Conversations, sortable by activity, regardless of Topic assignment.
*   Replace `localStorage` with a more robust client-side storage solution (IndexedDB).
*   Implement backend persistence for Topics, Conversations, and Messages for cross-device sync and data durability.
*   Optimize chat history transmission to AI models.
*   Improve error handling and offline capabilities.

## Guiding Principles

*   **Leverage Existing Infrastructure and Patterns:** All new development should build upon and align with the existing infrastructure, architectural patterns, and technology stack of `kinable-public-ws` and associated backend services (e.g., `chat-api-service`). Avoid introducing new technologies or patterns unless a strong justification is provided and agreed upon.
*   **Incremental Implementation:** Follow the phased approach outlined, allowing for iterative development, testing, and feedback.
*   **User-Centric Design:** Prioritize user experience and the workflows outlined in the requirements.

## Core Entities

1.  **Topic:** A user-created container to group related Conversations.
    *   Attributes: `topicId`, `userId`, `title`, `createdAt`, `updatedAt`.
2.  **Conversation:** An individual chat session consisting of messages.
    *   Attributes: `conversationId`, `userId`, `title` (user-editable or auto-generated), `createdAt`, `lastMessageTimestamp`, `topicId` (optional foreign key to Topic).
3.  **Message:** An individual message within a Conversation.
    *   Attributes: `messageId`, `conversationId`, `role`, `content`, `timestamp`, `status`.

## Phases and Tasks

---

### Phase 1: Client-Side Storage Enhancement (IndexedDB)

**Objective:** Implement IndexedDB for robust local storage of Topics, Conversations, and Messages, supporting all specified user scenarios.

*   **Task 1.1: Design IndexedDB Schema** - **Status: Completed**
    *   Define object stores:
        *   `topics`: Stores Topic metadata. - **Status: Completed**
            *   Key: `topicId`.
            *   Attributes: `userId`, `title`, `createdAt`, `updatedAt`.
            *   Indexes: `userId_updatedAt` (for listing user's topics by recent activity).
        *   `conversations`: Stores Conversation metadata. - **Status: Completed**
            *   Key: `conversationId`.
            *   Attributes: `userId`, `title`, `createdAt`, `lastMessageTimestamp`, `topicId` (nullable).
            *   Indexes:
                *   `userId_lastMessageTimestamp` (for the primary list of all user's conversations, sorted by recency).
                *   `userId_topicId_lastMessageTimestamp` (for listing conversations within a specific topic for a user, sorted by recency).
                *   `topicId` (if querying conversations by topic frequently without userId context, though typically userId will be present).
        *   `messages`: Stores individual messages. - **Status: Completed**
            *   Key: `messageId`.
            *   Attributes: `conversationId`, `role`, `content`, `timestamp`, `status`.
            *   Indexes: `conversationId_timestamp` (for loading messages for a conversation chronologically).
    *   **Deliverable:** Schema definition document/diagram. - **Status: Completed (implicitly via implementation)**

*   **Task 1.2: Implement IndexedDB Wrapper/Service (`ChatHistoryDBService`)** - **Status: Partially Completed / In Progress**
    *   Create a TypeScript service to encapsulate all IndexedDB interactions. - **Status: Completed**
    *   **Topic Methods:**
        *   `initializeDB()`: Sets up the database and object stores. - **Status: Completed**
        *   `createTopic(topicDetails: { userId: string, title: string })` - **Status: Implemented (service-level)**
        *   `getTopic(topicId: string)` - **Status: Implemented (service-level)**
        *   `getAllTopics(userId: string)` - **Status: Implemented (service-level)**
        *   `updateTopic(topicId: string, updates: { title?: string })` - **Status: Implemented (service-level)**
        *   `deleteTopic(topicId: string)` (Consider how to handle conversations within: disassociate or delete them). - **Status: Implemented (service-level)**
    *   **Conversation Methods:**
        *   `createConversation(details: { userId: string, title: string, topicId?: string, initialMessages?: Message[] })` - **Status: Completed**
        *   `getConversation(conversationId: string)` - **Status: Implemented (service-level)**
        *   `getAllConversations(userId: string, sortBy?: 'lastMessageTimestamp' | ...)`: For the main list. - **Status: Completed**
        *   `getConversationsForTopic(topicId: string, userId: string)`
        *   `updateConversation(conversationId: string, updates: { title?: string, topicId?: string | null })`: Key for assigning to/from topics, or renaming. - **Status: Partially Implemented (service-level for title/timestamp; topicId planned)**
        *   `deleteConversation(conversationId: string)` (and its messages). - **Status: Implemented (service-level, includes message cascade)**
    *   **Message Methods:**
        *   `addMessage(message: { conversationId: string, role: string, content: string, ... })` - **Status: Completed**
        *   `getMessagesForConversation(conversationId: string, limit?: number, beforeTimestamp?: number)` - **Status: Completed**
        *   `updateMessage(messageId: string, updates: { status?: string, content?: string })`
    *   Use a library like `idb` for a cleaner API. - **Status: Completed**
    *   **Deliverable:** `ChatHistoryDBService.ts` with comprehensive unit tests. - **Status: Partially Completed (core service exists, unit tests pending)**

*   **Task 1.3: Integrate `ChatHistoryDBService` into UI Components** - **Status: Partially Completed / In Progress**
    *   **UI for Topic Management:** Components for listing, creating, selecting, renaming, and deleting Topics. - **Status: Not Started**
    *   **UI for Conversation Management:** - **Status: Not Started**
        *   Primary list of all recent conversations (using `getAllConversations`).
        *   When a Topic is selected, list conversations within that topic (using `getConversationsForTopic`).
        *   Ability to start a new Conversation (globally or within a Topic).
        *   Ability to select Conversation(s) and assign/move to a Topic (uses `updateConversation` to set `topicId`).
        *   Ability to remove a Conversation from a Topic (uses `updateConversation` to set `topicId` to null).
        *   Ability to rename a Conversation.
    *   **Chat Interface:** - **Status: Mostly Completed**
        *   Load messages for the selected Conversation using `getMessagesForConversation`. - **Status: Completed**
        *   Save new messages (user and assistant) using `addMessage` and update `lastMessageTimestamp` on the parent Conversation. - **Status: Completed**
        *   (Implicit from implementation: `chat/page.tsx` loads/creates initial conversation and sends DB history to API) - **Status: Completed**
    *   **Deliverable:** Updated and new React components for Topics, Conversations, and Messages. - **Status: Partially Completed (chat interface updated)**

*   **Task 1.4: Data Migration (Optional)**
    *   If migrating from an old `localStorage` structure.
    *   Map old chats to new `Conversations` (likely independent, with `topicId: null` initially).
    *   **Deliverable:** Migration utility.

---

### Phase 2: Backend Persistence & Synchronization

**Objective:** Persist Topics, Conversations, and Messages on the backend (e.g., DynamoDB) and synchronize with the client.

*   **Task 2.1: Design Backend Database Schema (e.g., DynamoDB)**
    *   **`Topics` Table:**
        *   `PK`: `userId`, `SK`: `topicId`
        *   Attributes: `title`, `createdAt`, `updatedAt`.
        *   (Optional GSI: `userId-updatedAt` if needing to sort user's topics by recency frequently without scanning all topics of a user).
    *   **`Conversations` Table:**
        *   `PK`: `userId`, `SK`: `lastMessageTimestamp#conversationId` ( zapewnia sortowanie po czasie ostatniej wiadomości malejąco)
        *   Attributes: `title`, `createdAt`, `topicId` (nullable, string), `actualLastMessageTimestamp` (number, for GSI sorting).
        *   GSI 1 (Conversations by Topic): `PK`: `topicId`, `SK`: `lastMessageTimestamp#conversationId`. Query this GSI to list conversations within a topic, sorted by recency. This GSI would only include items where `topicId` is present.
        *   (Consider if `title` needs to be searchable via GSI).
    *   **`Messages` Table:**
        *   `PK`: `conversationId`, `SK`: `timestamp#messageId`
        *   Attributes: `role`, `content`, `userId` (denormalized for easier direct queries/rules if needed), etc.
    *   **Deliverable:** Backend database schema definition.

*   **Task 2.2: Implement Backend API Endpoints (`chat-api-service`)**
    *   **Topic Endpoints:**
        *   `POST /api/chat/topics` (body: `{ title: string }`)
        *   `GET /api/chat/topics` (lists topics for the authenticated user)
        *   `GET /api/chat/topics/{topicId}`
        *   `PUT /api/chat/topics/{topicId}` (body: `{ title?: string }`)
        *   `DELETE /api/chat/topics/{topicId}`
    *   **Conversation Endpoints:**
        *   `POST /api/chat/conversations` (body: `{ title: string, topicId?: string }`)
        *   `GET /api/chat/conversations` (query params: `?topicId=...` or none for all user's conversations, sorted by recency)
        *   `GET /api/chat/conversations/{conversationId}`
        *   `PUT /api/chat/conversations/{conversationId}` (body: `{ title?: string, topicId?: string | null }`) - for renaming, assigning to topic, or un-assigning.
        *   `DELETE /api/chat/conversations/{conversationId}`
    *   **Message Endpoints:**
        *   `POST /api/chat/conversations/{conversationId}/messages` (body: `{ role: string, content: string }`)
        *   `GET /api/chat/conversations/{conversationId}/messages` (with pagination)
    *   Ensure authentication & authorization.
    *   **Deliverable:** API implementations with OpenAPI/Swagger docs and tests.

*   **Task 2.3: Implement Client-Side Sync Logic**
    *   Sync local IndexedDB with backend as the source of truth.
    *   Fetch initial data (topics, recent conversations) on load.
    *   Push local changes (new topics, conversations, messages, updates to topicId) to backend.
    *   Handle conflict resolution (e.g., last-write-wins, or more sophisticated strategies if needed, especially for `topicId` changes from multiple clients).
    *   Update IndexedDB based on backend responses.
    *   **Deliverable:** Updated client-side services for sync.

---

### Phase 3: Optimizing History Management & Transmission

**Objective:** Efficiently manage chat history for display and AI model context.

*   **Task 3.1: Context Window Management for AI Model** - **Status: Completed**
    *   When sending messages from a `Conversation` to the AI, send only the last N messages or messages within a token limit from that specific `Conversation`. - **Status: Completed**
    *   **Deliverable:** Updated client logic for preparing AI requests. - **Status: Completed**

*   **Task 3.2: UI Pagination/Infinite Scrolling**
    *   For message lists within a `Conversation`.
    *   For the list of all `Conversations`.
    *   For the list of `Conversations` within a `Topic`.
    *   **Deliverable:** Updated UI components.

---

### Phase 4: Enhanced Error Handling & User Experience

**Objective:** Improve application resilience and UX.

*   **Task 4.1: Graceful Error Handling**
    *   For all IndexedDB and API operations (Topics, Conversations, Messages).
    *   User-friendly feedback.
    *   **Deliverable:** Improved error handling.

*   **Task 4.2: Optimistic Updates with Failure States & Retry**
    *   For creating/updating Topics, Conversations, and sending Messages.
    *   Clear "failed" states and retry options.
    *   **Deliverable:** Enhanced optimistic update flows.

*   **Task 4.3: Basic Offline Support**
    *   **View Data Offline:** Cached Topics, Conversations, Messages from IndexedDB.
    *   **Queue Actions Offline:**
        *   Compose messages offline (queued for sync).
        *   Create/rename Topics/Conversations offline (queued).
        *   Assign/unassign Conversations from Topics offline (queued).
    *   **Sync Queued Actions:** On connectivity restoration. This requires careful handling of potential conflicts if data was changed on the server in the meantime.
    *   **Deliverable:** Offline support logic.

*   **Task 4.4: Implement Environment-Aware Logging**
    *   Modify logging statements (client-side `kinable-public-ws` and backend `chat-api-service`) to adjust verbosity based on the environment (e.g., `NODE_ENV`, `REACT_APP_ENV`, or specific environment variables like `LOG_LEVEL`).
    *   Ensure detailed/debug logs are available in development and test environments.
    *   Restrict logs to warnings, errors, or essential operational information in production environments to reduce noise and improve performance.
    *   Consider using a lightweight, dedicated logging library if not already in use (e.g., `pino` for Node.js, `loglevel` for frontend) or implement simple conditional checks around `console.log` statements.
    *   Update existing `[DEBUG]` logs to conform to the new environment-aware strategy.
    *   **Deliverable:** Updated logging implementation across relevant services, and standardized logging practices.

---

## Assumptions & Dependencies

*   Access to `kinable-public-ws` (Next.js frontend) and `chat-api-service` (backend).
*   Familiarity with DynamoDB (or chosen backend DB).
*   Existing authentication/authorization.

## Timeline & Resources

*   (To be filled)

## Risks & Mitigations

*   **Sync Logic Complexity:** Especially with offline edits and reparenting conversations. Mitigation: Thorough design of sync protocol, conflict resolution strategy (e.g., server wins, or diff-patch), and extensive testing.
*   **Data Integrity:** Ensuring `topicId` references are valid, and cascading deletes/disassociations are handled correctly. Mitigation: Careful schema design, transactional logic where possible (backend), and robust testing.
*   **UI Complexity:** Managing the two-tiered display (Topics and Conversations) and the actions to move conversations between them. Mitigation: Iterative UI design and user testing.

---
This plan provides a comprehensive roadmap. Tasks within phases can be parallelized where appropriate. 