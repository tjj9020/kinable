'use client'

import React from 'react'
import { Conversation } from '@/lib/ChatHistoryDBService'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react';

interface ChatSidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onCreateNewConversation: () => Promise<string | null>;
  onDeleteConversation: (conversationId: string) => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({ 
  conversations,
  currentConversationId, 
  onSelectConversation,
  onCreateNewConversation, 
  onDeleteConversation
}) => {
  return (
    <div className="flex flex-col h-full p-4 border-r bg-muted/40">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Chats</h2>
        <Button 
          variant="outline" 
          size="sm"
          onClick={onCreateNewConversation} 
        >
          New Chat
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
        {conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conversations yet. Click New Chat to start!</p>
        ) : (
          conversations.map(convo => (
            <div key={convo.conversationId} className="flex items-center justify-between group">
              <button
                onClick={() => onSelectConversation(convo.conversationId)}
                className={`flex-grow text-left px-3 py-2 rounded-md text-sm truncate ${
                  convo.conversationId === currentConversationId
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground'
                }`}
                title={convo.title}
              >
                {convo.title || 'Untitled Conversation'}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="p-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm("Are you sure you want to delete this chat?")) {
                    onDeleteConversation(convo.conversationId);
                  }
                }}
                title="Delete chat"
              >
                <X size={16} />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default ChatSidebar 