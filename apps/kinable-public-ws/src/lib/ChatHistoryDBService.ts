import { openDB, DBSchema, IDBPDatabase, OpenDBCallbacks } from 'idb';

const DB_NAME = 'KinableChatHistoryDB';
const DB_VERSION = 1;

// Define interfaces based on Core Entities in PROJECT_PLAN_CHAT_HISTORY.md

export interface Topic {
  topicId: string; // Primary Key
  userId: string;
  title: string;
  createdAt: number; // Timestamp
  updatedAt: number; // Timestamp
}

export interface Conversation {
  conversationId: string; // Primary Key
  userId: string;
  title: string; // User-editable or auto-generated
  createdAt: number; // Timestamp
  lastMessageTimestamp: number; // Timestamp, for sorting
  topicId?: string | null; // Optional foreign key to Topic
}

// Re-using Message interface from api-service.ts for consistency,
// but ensuring it aligns with our needs for IndexedDB.
// If it diverges significantly, we can redefine it here.
// For now, assuming api-service.Message is compatible or will be made compatible.
export interface Message {
  messageId: string; // Primary Key
  conversationId: string; // Foreign Key to Conversation
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number; // Timestamp
  status?: 'sending' | 'sent' | 'delivered' | 'failed' | 'pending_sync'; // Optional status
  // Add other relevant fields from your existing Message type if needed
}

interface ChatHistoryDBSchema extends DBSchema {
  topics: {
    key: string; // topicId
    value: Topic;
    indexes: {
      'userId_updatedAt': [string, number]; // [Topic.userId, Topic.updatedAt]
    };
  };
  conversations: {
    key: string; // conversationId
    value: Conversation;
    indexes: {
      'userId_lastMessageTimestamp': [string, number]; // [Conversation.userId, Conversation.lastMessageTimestamp]
      'userId_topicId_lastMessageTimestamp': [string, string, number]; // [Conversation.userId, Conversation.topicId, Conversation.lastMessageTimestamp]
      'topicId': string; // Conversation.topicId
    };
  };
  messages: {
    key:string; // messageId
    value: Message;
    indexes: {
      'conversationId_timestamp': [string, number]; // [Message.conversationId, Message.timestamp]
    };
  };
}

let dbPromise: Promise<IDBPDatabase<ChatHistoryDBSchema>> | null = null;

const initializeDB = (): Promise<IDBPDatabase<ChatHistoryDBSchema>> => {
  if (!dbPromise) { // If null, create it
    dbPromise = openDB<ChatHistoryDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db: IDBPDatabase<ChatHistoryDBSchema>, oldVersion: number, newVersion: number | null, transaction: import('idb').IDBPTransaction<ChatHistoryDBSchema, ('topics' | 'conversations' | 'messages')[], "versionchange">, event: IDBVersionChangeEvent) {
        console.log(`Upgrading database from version ${oldVersion} to ${newVersion}`);
  
        // Create topics store
        if (!db.objectStoreNames.contains('topics')) {
          const topicsStore = db.createObjectStore('topics', { keyPath: 'topicId' });
          topicsStore.createIndex('userId_updatedAt', ['userId', 'updatedAt']);
          console.log('Created topics object store with userId_updatedAt index');
        }
  
        // Create conversations store
        if (!db.objectStoreNames.contains('conversations')) {
          const conversationsStore = db.createObjectStore('conversations', { keyPath: 'conversationId' });
          conversationsStore.createIndex('userId_lastMessageTimestamp', ['userId', 'lastMessageTimestamp']);
          conversationsStore.createIndex('userId_topicId_lastMessageTimestamp', ['userId', 'topicId', 'lastMessageTimestamp']);
          conversationsStore.createIndex('topicId', 'topicId'); // Index for filtering by topicId
          console.log('Created conversations object store with indexes');
        }
  
        // Create messages store
        if (!db.objectStoreNames.contains('messages')) {
          const messagesStore = db.createObjectStore('messages', { keyPath: 'messageId' });
          messagesStore.createIndex('conversationId_timestamp', ['conversationId', 'timestamp']);
          console.log('Created messages object store with conversationId_timestamp index');
        }
        // Handle other version upgrades here if needed in the future
      },
    });
  }
  return dbPromise!; // dbPromise is now guaranteed to be a Promise here, assert with !
};

// Export the db promise for use in service methods
export const getDB = async (): Promise<IDBPDatabase<ChatHistoryDBSchema>> => {
  const db = await initializeDB();
  if (!db) {
    throw new Error("Database could not be initialized.");
  }
  return db;
}

// Placeholder for service class/methods - to be filled in as per Task 1.2
export class ChatHistoryDBService {
  private dbPromise: Promise<IDBPDatabase<ChatHistoryDBSchema>>;

  constructor() {
    this.dbPromise = getDB();
  }

  // Topic methods
  async createTopic(topicDetails: { userId: string, title: string }): Promise<Topic> {
    const db = await this.dbPromise;
    const newTopic: Topic = {
      ...topicDetails,
      topicId: crypto.randomUUID(), // Generate a unique ID
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.put('topics', newTopic);
    return newTopic;
  }

  async getTopic(topicId: string): Promise<Topic | undefined> {
    const db = await this.dbPromise;
    return db.get('topics', topicId);
  }

  async getAllTopics(userId: string): Promise<Topic[]> {
    const db = await this.dbPromise;
    // Assuming direct index on userId is not present based on schema, iterate or use compound if available.
    // Current schema: 'userId_updatedAt'. So, we get all for a user and sort by updatedAt.
    // For simplicity, let's get all and filter, or use the index appropriately.
    // Using the 'userId_updatedAt' index to get topics for a user.
    // This will be sorted by userId, then by updatedAt ascending by default from the index.
    const topics = await db.getAllFromIndex('topics', 'userId_updatedAt', IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER]));
    // To sort by updatedAt descending (most recent first), sort on the client side:
    return topics.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async updateTopic(topicId: string, updates: { title?: string }): Promise<Topic | undefined> {
    const db = await this.dbPromise;
    const tx = db.transaction('topics', 'readwrite');
    const store = tx.objectStore('topics');
    const topic = await store.get(topicId);
    if (!topic) {
      await tx.done; // Ensure transaction completes even if topic not found
      return undefined;
    }
    const updatedTopic = {
      ...topic,
      ...updates,
      updatedAt: Date.now(),
    };
    await store.put(updatedTopic);
    await tx.done;
    return updatedTopic;
  }

  async deleteTopic(topicId: string): Promise<void> {
    const db = await this.dbPromise;
    // TODO: Decide on cascading delete or disassociation for conversations within this topic.
    // For now, just deleting the topic itself.
    // In a real scenario, we'd also delete/update associated conversations and potentially their messages or reassign topicId.
    await db.delete('topics', topicId);
    console.log(`Topic ${topicId} deleted. Child conversations are not yet handled.`);
  }

  // Conversation methods
  async createConversation(details: {
    userId: string;
    title: string;
    topicId?: string | null;
    // initialMessages?: Message[]; // We'll handle adding messages separately via addMessage
  }): Promise<Conversation> {
    const db = await this.dbPromise;
    const now = Date.now();
    const newConversation: Conversation = {
      userId: details.userId,
      title: details.title,
      topicId: details.topicId || null,
      conversationId: crypto.randomUUID(),
      createdAt: now,
      lastMessageTimestamp: now, // Initialize with creation time, update on new message
    };
    await db.put('conversations', newConversation);
    // If initialMessages were provided, they would be added here using addMessage method
    // For now, conversation is created empty, messages are added via addMessage.
    return newConversation;
  }

  async getConversation(conversationId: string): Promise<Conversation | undefined> {
    const db = await this.dbPromise;
    return db.get('conversations', conversationId);
  }

  async getAllConversations(userId: string): Promise<Conversation[]> {
    const db = await this.dbPromise;
    // Uses 'userId_lastMessageTimestamp' index, should fetch sorted by lastMessageTimestamp descending.
    // The index key path is ['userId', 'lastMessageTimestamp']
    const range = IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER]);
    const conversations = await db.getAllFromIndex('conversations', 'userId_lastMessageTimestamp', range);
    // The index sorts ascending by default. For descending (most recent first), sort client-side.
    return conversations.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
  }

  async getConversationsForTopic(topicId: string, userId: string): Promise<Conversation[]> {
    const db = await this.dbPromise;
    // Uses 'userId_topicId_lastMessageTimestamp' index.
    // Key path: ['userId', 'topicId', 'lastMessageTimestamp']
    // We need conversations for a specific userId and topicId, sorted by lastMessageTimestamp descending.
    const range = IDBKeyRange.bound(
      [userId, topicId, 0],
      [userId, topicId, Number.MAX_SAFE_INTEGER]
    );
    const conversations = await db.getAllFromIndex('conversations', 'userId_topicId_lastMessageTimestamp', range);
    // Sort client-side for descending order by lastMessageTimestamp.
    return conversations.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
  }

  async updateConversation(conversationId: string, updates: Partial<Pick<Conversation, 'title' | 'topicId'>>): Promise<Conversation | undefined> {
    const db = await this.dbPromise;
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');
    const conversation = await store.get(conversationId);
    if (!conversation) {
      await tx.done;
      return undefined;
    }
    const updatedConversation: Conversation = {
      ...conversation,
      ...updates,
      // Ensure topicId is explicitly null if being unset, not undefined
      topicId: updates.topicId === undefined ? conversation.topicId : updates.topicId,
      lastMessageTimestamp: Date.now(), // Updating a conversation (e.g., title, topic) also updates its 'activity' timestamp
    };
    await store.put(updatedConversation);
    await tx.done;
    return updatedConversation;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(['conversations', 'messages'], 'readwrite');
    const conversationsStore = tx.objectStore('conversations');
    const messagesStore = tx.objectStore('messages');

    // Delete the conversation itself
    await conversationsStore.delete(conversationId);

    // Delete all messages associated with this conversation
    let cursor = await messagesStore.index('conversationId_timestamp').openCursor(IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER]));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    await tx.done;
    console.log(`Conversation ${conversationId} and its messages deleted.`);
  }

  // Message methods
  async addMessage(messageData: Omit<Message, 'messageId' | 'timestamp'>): Promise<Message> {
    const db = await this.dbPromise;
    // Use a transaction to update both messages and the conversation's lastMessageTimestamp
    const tx = db.transaction(['messages', 'conversations'], 'readwrite');
    const messagesStore = tx.objectStore('messages');
    const conversationsStore = tx.objectStore('conversations');

    const now = Date.now();
    const newMessage: Message = {
      ...messageData,
      messageId: crypto.randomUUID(),
      timestamp: now,
      status: messageData.status || 'sent', // Default status if not provided
    };

    await messagesStore.put(newMessage);

    // Update the parent conversation's lastMessageTimestamp
    const conversation = await conversationsStore.get(messageData.conversationId);
    if (conversation) {
      const updatedConversation: Conversation = {
        ...conversation,
        lastMessageTimestamp: now, // Update to current time
      };
      await conversationsStore.put(updatedConversation);
    } else {
      // Log a warning if the conversation doesn't exist, though this ideally shouldn't happen.
      console.warn(`Attempted to add message to a non-existent conversation: ${messageData.conversationId}`);
    }

    await tx.done; // Ensure the transaction completes
    return newMessage;
  }

  async getMessagesForConversation(
    conversationId: string,
    limit?: number,
    beforeTimestamp?: number // For pagination: fetch messages older than this timestamp
  ): Promise<Message[]> {
    const db = await this.dbPromise;
    const store = db.transaction('messages').objectStore('messages');
    const index = store.index('conversationId_timestamp');

    // Define the range for the query.
    // We want messages for a specific conversationId, with timestamps up to beforeTimestamp (if provided).
    const upperTimestamp = beforeTimestamp !== undefined ? beforeTimestamp : Number.MAX_SAFE_INTEGER;
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, upperTimestamp]);

    const messages: Message[] = [];
    let cursor = await index.openCursor(range, 'prev'); // 'prev' to get newest messages first within the range

    while (cursor && (limit === undefined || messages.length < limit)) {
      messages.push(cursor.value);
      cursor = await cursor.continue();
    }

    // Messages are currently newest to oldest. Reverse to get chronological order for typical display.
    return messages.reverse();
  }

  async updateMessage(messageId: string, updates: Partial<Pick<Message, 'status' | 'content'>>): Promise<Message | undefined> {
    const db = await this.dbPromise;
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const message = await store.get(messageId);

    if (!message) {
      await tx.done;
      return undefined;
    }

    const updatedMessage: Message = {
      ...message,
      ...updates,
      // timestamp is not changed here, but one could add logic to update an 'updatedAt' field if it existed on Message
    };

    await store.put(updatedMessage);
    await tx.done;
    return updatedMessage;
  }
}

// Export a singleton instance for easy use across the application
const chatHistoryDBService = new ChatHistoryDBService();
export default chatHistoryDBService;

// For now, mainly exporting type definitions and the getDB function
// The full service methods will be implemented next. 