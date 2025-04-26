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
     * @returns A promise that resolves with the message ID if successful
     */
    public async sendMessage(content: string, streaming: boolean = true): Promise<{ messageId: string, status: string }> {
        // More detailed logging
        console.log('📩 [ChatService.sendMessage] Message received, length:', content.length);
        console.log(`📩 [ChatService.sendMessage] Content preview: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
        console.log(`📩 [ChatService.sendMessage] Streaming mode: ${streaming}`);
        console.log(`📩 [ChatService.sendMessage] Conversation ID: ${this.activeConversationId}`);
        
        // Check client connection 
        if (!this.mcpClient) {
            console.error('❌ [ChatService.sendMessage] MCPClient is null or undefined!');
            throw new Error('ChatService: MCPClient is not initialized');
        }

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
            // Check connection before sending - catch connection issues early
            if (typeof this.mcpClient.isConnectedToServer === 'function') {
                const isConnected = this.mcpClient.isConnectedToServer();
                console.log('🔌 [ChatService.sendMessage] MCPClient connection status:', isConnected ? 'Connected' : 'Not connected');
                
                if (!isConnected) {
                    console.warn('⚠️ [ChatService.sendMessage] MCPClient reports not connected, attempting to reconnect...');
                    
                    try {
                        // Try to reconnect
                        await this.mcpClient.connect();
                        console.log('✅ [ChatService.sendMessage] Reconnection successful!');
                    } catch (connectError) {
                        console.error('❌ [ChatService.sendMessage] Failed to reconnect:', connectError);
                        
                        // Add error message to history
                        const errorMessage: Message = {
                            role: 'assistant',
                            content: 'Error: Failed to connect to server. Please check your connection.',
                            timestamp: Date.now()
                        };
                        
                        await this.chatHistoryManager.addMessage(this.activeConversationId, errorMessage);
                        
                        // Emit event to update UI
                        this.emit('message', {
                            message: errorMessage,
                            conversationId: this.activeConversationId
                        });
                        
                        throw new Error('Failed to connect to server');
                    }
                }
            }
            
            console.log('📤 [ChatService.sendMessage] Server\'a chat mesajı gönderiliyor');
            console.log(`💬 [ChatService.sendMessage] İçerik: ${content.substring(0, 30)}${content.length > 30 ? '...' : ''}`);
            
            // Send to server with longer timeout (120 seconds)
            console.log('🔄 [ChatService.sendMessage] Calling mcpClient.sendChatMessage');
            const result = await this.mcpClient.sendChatMessage(content, this.activeConversationId, streaming);
            console.log('✅ [ChatService.sendMessage] MCPClient.sendChatMessage completed with result:', result);
            
            // Return the message ID for tracking
            return {
                messageId: result.messageId,
                status: result.status || 'sent'
            };
        } catch (error) {
            console.error('❌ [ChatService.sendMessage] Server\'a mesaj gönderirken hata:', error);
            
            // Add error message to history
            const errorMessage: Message = {
                role: 'assistant',
                content: `Error: Failed to send message to server. ${error instanceof Error ? error.message : 'Please check your connection.'}`,
                timestamp: Date.now()
            };
            
            await this.chatHistoryManager.addMessage(this.activeConversationId, errorMessage);
            
            // Emit event to update UI
            this.emit('message', {
                message: errorMessage,
                conversationId: this.activeConversationId
            });
            
            // Rethrow the error for upstream handling
            throw error;
        }
    }

    /**
     * Handle streaming response from server
     */
    private async handleStreamingResponse(payload: any): Promise<void> {
        try {
            // Extract all required fields
            const { status, content, originalMessageId, messageId } = payload;
            
            // Improved logging
            console.log(`🔄 [ChatService.handleStreamingResponse] Stream response received`);
            console.log(`  - Status: ${status}`);
            console.log(`  - OriginalMessageId: ${originalMessageId || 'MISSING'}`);
            console.log(`  - MessageId: ${messageId || 'MISSING'}`);
            console.log(`  - Content length: ${content?.length || 0}`);
            
            // Create a message object with available data
            const message: Message = {
                id: originalMessageId || messageId, // Use originalMessageId first, then fall back to messageId
                role: 'assistant',
                content: content || 'No response received from server. Please try again.',
                timestamp: Date.now()
            };
            
            // Get the ID to use for tracking this message - ensure consistency
            const messageTrackingId = originalMessageId || messageId || message.id;
            
            // Process based on status - IMPORTANT: Removed pending request check
            switch (status) {
                case 'started':
                    console.log(`🟢 [ChatService.handleStreamingResponse] Stream started, messageId: ${messageTrackingId}`);
                    // Always emit the event regardless of whether we recognize the message ID
                    this.emit('stream', {
                        status: 'started',
                        message,
                        originalMessageId: messageTrackingId
                    });
                    break;
                    
                case 'streaming':
                    console.log(`↔️ [ChatService.handleStreamingResponse] Stream continuing, messageId: ${messageTrackingId}, content length: ${content?.length || 0}`);
                    // Always emit the event regardless of whether we recognize the message ID
                    this.emit('stream', {
                        status: 'streaming',
                        message,
                        originalMessageId: messageTrackingId
                    });
                    break;
                    
                case 'completed':
                    console.log(`✅ [ChatService.handleStreamingResponse] Stream completed, messageId: ${messageTrackingId}`);
                    
                    // Save the completed message
                    if (content) {
                        // Add message to conversation
                        await this.chatHistoryManager.addMessage(this.activeConversationId, message);
                    }
                    
                    // Always emit the event regardless of whether we recognize the message ID
                    this.emit('stream', {
                        status: 'completed',
                        message,
                        originalMessageId: messageTrackingId
                    });
                    break;
                    
                default:
                    console.warn(`⚠️ [ChatService.handleStreamingResponse] Unknown stream status: ${status}`);
                    break;
            }
        } catch (error) {
            console.error('❌ [ChatService.handleStreamingResponse] Stream processing error:', error);
        }
    }

    /**
     * Handle regular chat response from server
     */
    private async handleChatResponse(payload: any): Promise<void> {
        const { status, content, conversationId } = payload;
        
        // Only process completed responses
        if (status === 'completed') {
            // Create assistant message
            const assistantMessage: Message = {
                role: 'assistant',
                content: content || 'No response received from server. Please try again.',
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