'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/logo'
import { getCurrentUser, signOut, CognitoUser } from '@/lib/auth-service'
import chatHistoryDBService, { Conversation as DBConversation } from '@/lib/ChatHistoryDBService'
import ChatSidebar from './components/ChatSidebar'
import ChatView from './components/ChatView'

export default function ChatPage() {
  const [user, setUser] = useState<CognitoUser | null>(null)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [sidebarConversations, setSidebarConversations] = useState<DBConversation[]>([]);
  const [isLoadingInitialState, setIsLoadingInitialState] = useState(true);
  const router = useRouter()

  const fetchAndUpdateSidebarConversations = useCallback(async (userIdToFetch: string) => {
    try {
      const fetchedConversations = await chatHistoryDBService.getAllConversations(userIdToFetch);
      setSidebarConversations(fetchedConversations);
      return fetchedConversations;
    } catch (error) {
      console.error("Failed to fetch sidebar conversations:", error);
      setSidebarConversations([]);
      return [];
    }
  }, []);

  useEffect(() => {
    const initializeUserAndConversation = async () => {
      setIsLoadingInitialState(true);
      try {
        const cognitoUser = getCurrentUser()
        if (!cognitoUser || !cognitoUser.getUsername()) {
          router.push('/login')
          return
        }
        setUser(cognitoUser)
        const userId = cognitoUser.getUsername()

        const userConversations = await fetchAndUpdateSidebarConversations(userId);

        if (userConversations.length > 0) {
          setCurrentConversationId(userConversations[0].conversationId) 
        } else {
          await handleCreateNewConversation(userId); 
        }
      } catch (error) {
        console.error('Auth check or chat initialization failed:', error)
        if (error instanceof Error && error.message.includes('No current user')) {
          router.push('/login')
        } 
      } finally {
        setIsLoadingInitialState(false);
      }
    }
    initializeUserAndConversation()
  }, [router, fetchAndUpdateSidebarConversations]);

  const handleSelectConversation = (conversationId: string) => {
    setCurrentConversationId(conversationId)
  }

  const handleCreateNewConversation = useCallback(async (userIdOverride?: string): Promise<string | null> => {
    const currentUserId = userIdOverride || user?.getUsername();
    if (!currentUserId) {
      console.error("User not available to create new conversation");
      return null;
    }
    try {
      const newConversation = await chatHistoryDBService.createConversation({
        userId: currentUserId,
        title: 'New Conversation',
      });
      if (newConversation) {
        const welcomeContent = 'Hello! How can I help you today?';
        await chatHistoryDBService.addMessage({
            conversationId: newConversation.conversationId,
            role: 'assistant',
            content: welcomeContent,
        });
        setCurrentConversationId(newConversation.conversationId);
        await fetchAndUpdateSidebarConversations(currentUserId);
        return newConversation.conversationId;
      }
      return null;
    } catch (error) {
      console.error("Failed to create new conversation:", error);
      return null;
    }
  }, [user, fetchAndUpdateSidebarConversations]);

  const handleDeleteConversation = useCallback(async (conversationIdToDelete: string) => {
    if (!user || !user.getUsername()) {
      console.error("User not available to delete conversation");
      return;
    }
    const userId = user.getUsername();
    try {
      await chatHistoryDBService.deleteConversation(conversationIdToDelete);
      const remainingConversations = await fetchAndUpdateSidebarConversations(userId);

      if (currentConversationId === conversationIdToDelete) {
        if (remainingConversations.length > 0) {
          setCurrentConversationId(remainingConversations[0].conversationId); 
        } else {
          setCurrentConversationId(null); 
        }
      } 
    } catch (error) {
      console.error(`Failed to delete conversation ${conversationIdToDelete}:`, error);
    }
  }, [user, currentConversationId, fetchAndUpdateSidebarConversations]);

  const handleConversationTitleUpdated = useCallback((updatedConversationId: string) => {
    if (user && user.getUsername()) {
      fetchAndUpdateSidebarConversations(user.getUsername());
    }
  }, [user, fetchAndUpdateSidebarConversations]);

  const handleLogout = () => {
    signOut()
    router.push('/login')
  }

  if (isLoadingInitialState) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <Logo size="large" />
        <p className="mt-4 text-lg text-muted-foreground">Loading your conversations...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between p-4 border-b shrink-0">
        <Logo size="small" />
        <div className="flex items-center gap-4">
          {user && (
            <span className="text-sm text-muted-foreground">
              {user.getUsername()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/4 min-w-[250px] max-w-[350px] h-full">
          <ChatSidebar 
            conversations={sidebarConversations}
            currentConversationId={currentConversationId}
            onSelectConversation={handleSelectConversation}
            onCreateNewConversation={() => handleCreateNewConversation()} 
            onDeleteConversation={handleDeleteConversation} 
          />
        </div>
        <div className="flex-1 h-full">
          <ChatView 
            currentConversationId={currentConversationId} 
            user={user}
            onTitleUpdated={handleConversationTitleUpdated}
          />
        </div>
      </div>
    </div>
  )
} 