'use client'

import { useState, useEffect, useRef, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/logo'
import { getCurrentUser, signOut } from '@/lib/auth-service'
import { sendChatMessage, ChatRequest, ChatResponse } from '@/lib/api-service'

// Message types for the chat interface
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any>(null)
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // Generate a unique ID for messages
  const generateId = () => Math.random().toString(36).substring(2, 15)
  
  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  
  // Check if user is authenticated
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const cognitoUser = getCurrentUser()
        if (!cognitoUser) {
          router.push('/login')
          return
        }
        
        setUser(cognitoUser)
        
        // Add welcome message
        setMessages([
          {
            id: generateId(),
            role: 'assistant',
            content: 'Hello! How can I help you today?',
            timestamp: Date.now()
          }
        ])
      } catch (error) {
        console.error('Auth check failed:', error)
        router.push('/login')
      }
    }
    
    checkAuth()
  }, [router])
  
  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages])
  
  // Handle sending a message
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    
    if (!input.trim() || loading) return
    
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    }
    
    // Add user message to chat
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    
    try {
      // Create chat request
      const request: ChatRequest = {
        prompt: input
      }
      
      // Get response from AI
      const response = await sendChatMessage(request)
      
      // Add AI response to chat
      const aiMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: response.text,
        timestamp: Date.now()
      }
      
      setMessages(prev => [...prev, aiMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      
      // Add error message
      setMessages(prev => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: Date.now()
        }
      ])
    } finally {
      setLoading(false)
    }
  }
  
  // Handle logout
  const handleLogout = () => {
    signOut()
    router.push('/login')
  }
  
  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b">
        <Logo size="small" />
        <div className="flex items-center gap-4">
          {user && (
            <span className="text-sm text-muted-foreground">
              {user.username}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </header>
      
      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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