'use client'

import React, { useState, useEffect, useRef, FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import chatHistoryDBService, { Message as DBMessage } from '@/lib/ChatHistoryDBService'
import { sendChatMessage, ChatRequest as ApiChatRequest } from '@/lib/api-service'
import { CognitoUser } from '@/lib/auth-service' // Assuming CognitoUser type is needed

interface UIMessage extends Omit<DBMessage, 'messageId'> {
  id: string; 
}

interface ChatViewProps {
  currentConversationId: string | null;
  user: CognitoUser | null; // Pass the user object for sending messages
  onTitleUpdated: (updatedConversationId: string) => void; // Add the new prop
}

const ChatView: React.FC<ChatViewProps> = ({ currentConversationId, user, onTitleUpdated }) => {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const generateId = () => crypto.randomUUID()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    // Placeholder: Load messages for currentConversationId
    const loadMessages = async () => {
      if (!currentConversationId) {
        setMessages([]); // Clear messages if no conversation is selected
        return;
      }
      setLoading(true);
      try {
        const dbMessages = await chatHistoryDBService.getMessagesForConversation(currentConversationId);
        const uiMessages: UIMessage[] = dbMessages.map(m => ({ ...m, id: m.messageId }));
        setMessages(uiMessages);

        // If the conversation is new and empty (after potential creation flow handled by parent),
        // a welcome message might be added here or in the parent component that manages conversation creation.
        // For now, this just loads existing messages.
      } catch (error) {
        console.error('Error loading messages for conversation:', currentConversationId, error);
        setMessages([]); // Clear messages on error
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
  }, [currentConversationId])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const currentInput = input.trim()
    if (!currentInput || loading || !currentConversationId || !user || !user.getUsername()) return;

    const userId = user.getUsername();

    const userUIMessage: UIMessage = {
      id: generateId(),
      role: 'user',
      content: currentInput,
      timestamp: Date.now(),
      conversationId: currentConversationId,
    }
    setMessages(prev => [...prev, userUIMessage])
    setInput('')
    setLoading(true)

    try {
      const historyForAPI = (await chatHistoryDBService.getMessagesForConversation(currentConversationId, 9))
        .map(m => ({ role: m.role, content: m.content, id: m.messageId, timestamp: m.timestamp }))

      await chatHistoryDBService.addMessage({
        conversationId: currentConversationId,
        role: 'user',
        content: currentInput,
      })
      
      // Attempt to auto-update title for new conversations after first user message
      try {
        const conversation = await chatHistoryDBService.getConversation(currentConversationId);
        if (conversation && conversation.title === 'New Conversation') {
          const firstUserMessageContent = currentInput;
          // Generate title: first 4 words or up to 30 chars, then ellipsis if longer
          let newTitle = firstUserMessageContent.split(' ').slice(0, 4).join(' ');
          if (newTitle.length > 30) {
            newTitle = newTitle.substring(0, 27) + '...';
          } else if (firstUserMessageContent.length > newTitle.length) {
            newTitle += '...';
          }
          if (newTitle.trim() === '...') newTitle = "Chat"; // Fallback if input is too short for a meaningful title
          
          await chatHistoryDBService.updateConversation(currentConversationId, { title: newTitle });
          // No need to directly update sidebar here; its useEffect on currentConversationId will cause a refresh.
          onTitleUpdated(currentConversationId); // Call the callback
        }
      } catch (titleError) {
        console.error("Error auto-updating conversation title:", titleError);
      }
      
      const request: ApiChatRequest = {
        prompt: currentInput,
        history: historyForAPI as any, 
        conversationId: currentConversationId,
      }
      console.log('[DEBUG] ChatView - Sending to API:', JSON.stringify(request, null, 2));
      
      const response = await sendChatMessage(request)
      
      const aiDbMessage = await chatHistoryDBService.addMessage({
        conversationId: currentConversationId,
        role: 'assistant',
        content: response.text, 
      })
      const aiUIMessage: UIMessage = { ...aiDbMessage, id: aiDbMessage.messageId }
      setMessages(prev => [...prev, aiUIMessage])

    } catch (error) {
      console.error('Error sending message:', error)
      const errorContent = error instanceof Error && error.message ? error.message : 'Sorry, I encountered an error.'
      // Add error message to UI and DB
      try {
        const errorDbMsg = await chatHistoryDBService.addMessage({
            conversationId: currentConversationId,
            role: 'assistant',
            content: errorContent,
            status: 'failed',
        });
        setMessages(prev => [...prev, { ...errorDbMsg, id: errorDbMsg.messageId }]);
      } catch (dbError) {
        console.error('Failed to save error message to DB', dbError);
        // Fallback UI error message if DB save fails
        setMessages(prev => [...prev, {
            id: generateId(),
            conversationId: currentConversationId,
            role: 'assistant',
            content: 'Error sending message and failed to save error details.',
            timestamp: Date.now(),
            status: 'failed'
        }]);
      }
    } finally {
      setLoading(false)
    }
  }

  if (!currentConversationId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p>Select a conversation or start a new one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && messages.length === 0 && <p>Loading messages...</p>}
        {messages.map(message => (
          <div 
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div 
              className={`max-w-[80%] rounded-lg p-3 ${
                message.role === 'user' 
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Input area */}
      <form onSubmit={handleSubmit} className="border-t p-4">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={loading}
            className="flex-1"
          />
          <Button type="submit" disabled={loading}>
            {loading ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </form>
    </div>
  )
}

export default ChatView; 