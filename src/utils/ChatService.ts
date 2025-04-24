import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { MCPClient } from '../mcp/MCPClient';
import { Message } from '../types/chat';
import { ChatHistoryManager } from './ChatHistoryManager';

/**
 * Chat service that handles interactions between UI and server
 * Follows clean architecture principles
 */
export class ChatService extends EventEmitter {
    private static instance: ChatService;
    private mcpClient: MCPClient;
    private chatHistoryManager: ChatHistoryManager;
    private activeConversationId: string = 'default';

    constructor(mcpClient: MCPClient, chatHistoryManager: ChatHistoryManager) {
        super();
        this.mcpClient = mcpClient;
        this.chatHistoryManager = chatHistoryManager;
        
        // Listen for streaming responses
        this.mcpClient.on('chat-stream', (payload) => {
            this.handleStreamingResponse(payload);
        });
        
        // Listen for complete responses
        this.mcpClient.on('chat-response', (payload) => {
            this.handleChatResponse(payload);
        });
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(mcpClient: MCPClient, context: vscode.ExtensionContext): ChatService {
        if (!ChatService.instance) {
            const chatHistoryManager = ChatHistoryManager.getInstance(context);
            ChatService.instance = new ChatService(mcpClient, chatHistoryManager);
        }
        return ChatService.instance;
    }

    /**
     * Send a message to the chat service
     */
    public async sendMessage(content: string, streaming: boolean = true): Promise<void> {
        // Create a user message
        const userMessage: Message = {
            role: 'user',
            content,
            timestamp: Date.now()
        };
        
        // Add to local history
        await this.chatHistoryManager.addMessage(this.activeConversationId, userMessage);
        
        // Emit event to update UI immediately
        this.emit('message', {
            message: userMessage,
            conversationId: this.activeConversationId
        });
        
        try {
            console.log('📤 [ChatService.sendMessage] Server\'a chat mesajı gönderiliyor');
            console.log(`💬 [ChatService.sendMessage] İçerik: ${content.substring(0, 30)}${content.length > 30 ? '...' : ''}`);
            
            // Send to server with longer timeout (120 seconds)
            await this.mcpClient.sendChatMessage(content, this.activeConversationId, streaming);
        } catch (error) {
            console.error('❌ [ChatService.sendMessage] Server\'a mesaj gönderirken hata:', error);
            
            // Add error message to history
            const errorMessage: Message = {
                role: 'assistant',
                content: 'Error: Failed to send message to server. Please check your connection.',
                timestamp: Date.now()
            };
            
            await this.chatHistoryManager.addMessage(this.activeConversationId, errorMessage);
            
            // Emit event to update UI
            this.emit('message', {
                message: errorMessage,
                conversationId: this.activeConversationId
            });
        }
    }

    /**
     * Handle streaming response from server
     */
    private async handleStreamingResponse(payload: any): Promise<void> {
        const { status, content, conversationId } = payload;
        
        // Create assistant message
        const assistantMessage: Message = {
            role: 'assistant',
            content: content || '',
            timestamp: Date.now()
        };
        
        // Only store completed messages to avoid duplicates
        if (status === 'completed') {
            await this.chatHistoryManager.addMessage(conversationId, assistantMessage);
        }
        
        // Emit stream event
        this.emit('stream', {
            message: assistantMessage,
            status,
            conversationId
        });
    }

    /**
     * Handle regular chat response from server
     */
    private async handleChatResponse(payload: any): Promise<void> {
        const { status, content, conversationId } = payload;
        
        // Only process completed responses
        if (status === 'completed' && content) {
            // Create assistant message
            const assistantMessage: Message = {
                role: 'assistant',
                content,
                timestamp: Date.now()
            };
            
            // Add to local history
            await this.chatHistoryManager.addMessage(conversationId, assistantMessage);
            
            // Emit event to update UI
            this.emit('message', {
                message: assistantMessage,
                conversationId
            });
        }
    }

    /**
     * Set the active conversation
     */
    public setActiveConversation(conversationId: string): void {
        this.activeConversationId = conversationId;
    }

    /**
     * Get message history for conversation
     */
    public async getConversationHistory(conversationId: string = this.activeConversationId): Promise<Message[]> {
        const session = await this.chatHistoryManager.getSession(conversationId);
        return session?.messages || [];
    }
} 