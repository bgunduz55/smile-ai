import * as vscode from 'vscode';
import { Message } from '../types/chat';
import { ChatService } from '../utils/ChatService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private chatService: ChatService;
    private pendingMessages: Map<string, Message> = new Map();
    // Add a map to track originalMessageIds to local messageIds
    private messageIdMap: Map<string, string> = new Map();
    private config: { debug: boolean };
    private webviewReady: boolean = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        chatService: ChatService
    ) {
        this.chatService = chatService;
        this.config = { debug: true };
        
        // Listen for messages from the ChatService
        this.chatService.on('message', (data) => {
            this.handleMessageFromService(data.message);
        });
        
        // Listen for streaming responses
        this.chatService.on('stream', (data) => {
            console.log(`🌊 [ChatViewProvider.stream] Received stream event with status ${data.status} and original message ID: ${data.originalMessageId}`);
            this.handleStreamingMessage(data.message, data.status, data.originalMessageId);
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log(`🔄 [ChatViewProvider.resolveWebviewView] Resolving webview view`);
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            if (!this.webviewReady) {
                console.log(`✅ [ChatViewProvider.resolveWebviewView] First message received from webview, marking as ready`);
                this.webviewReady = true;
                // Process any pending messages immediately
                setTimeout(() => this.processPendingMessages(), 100);
            }
            
            switch (data.type) {
                case 'userMessage':
                    this.handleMessage(data.message);
                    break;
                case 'webviewReady':
                    console.log(`✅ [ChatViewProvider.resolveWebviewView] Received explicit webview ready message`);
                    this.webviewReady = true;
                    setTimeout(() => this.processPendingMessages(), 100);
                    break;
            }
        });

        // Set up a ready check to ensure webview is truly ready
        setTimeout(() => {
            if (!this.webviewReady) {
                console.log(`⚠️ [ChatViewProvider.resolveWebviewView] Webview not marked ready yet, setting ready anyway`);
                this.webviewReady = true;
                this.processPendingMessages();
            }
        }, 3000);

        // Load conversation history
        this.loadConversationHistory();
        
        // Wait a short time for the webview to initialize before processing pending messages
        setTimeout(() => {
            console.log(`⏱️ [ChatViewProvider.resolveWebviewView] Initial timeout complete, marking webview as ready`);
            this.webviewReady = true;
            this.processPendingMessages();
        }, 1000);

        // Also set up a listener for when the webview becomes visible
        webviewView.onDidChangeVisibility(() => {
            console.log(`👁️ [ChatViewProvider.onDidChangeVisibility] Visibility changed: ${webviewView.visible}`);
            if (webviewView.visible) {
                console.log(`🌐 [ChatViewProvider] Webview became visible, marking as ready and processing pending messages`);
                this.webviewReady = true;
                this.processPendingMessages();
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Create URIs to scripts and styles
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'codicon.css'));

        // Simple HTML structure for the chat UI
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <title>SmileAgent Chat</title>
            </head>
            <body>
                <div class="chat-container">
                    <div class="messages" id="chat-container"></div>
                </div>
                <div id="input-container">
                    <textarea id="message-input" placeholder="Type a message..."></textarea>
                    <button id="send-button">Send</button>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private handleMessage(message: string): void {
        // Add more detailed logging
        console.log('💬 [ChatViewProvider.handleMessage] Received user message:', message.substring(0, 30) + (message.length > 30 ? '...' : ''));
        console.log('🚀 [ChatViewProvider.handleMessage] Forwarding to ChatService.sendMessage');
        
        // Generate a local message ID for tracking
        const localMessageId = `msg_${Date.now()}`;
        
        // Also add the user message to the UI immediately
        if (this._view && this._view.webview && this.webviewReady) {
            try {
                this._view.webview.postMessage({
                    type: 'addStreamingMessage',
                    message: {
                        role: 'user',
                        content: message,
                        timestamp: Date.now()
                    },
                    messageId: localMessageId
                });
                console.log('✅ [ChatViewProvider.handleMessage] Added user message to UI, local ID:', localMessageId);
            } catch (error) {
                console.error('❌ [ChatViewProvider.handleMessage] Error sending user message to webview:', error);
            }
        } else {
            console.warn('⚠️ [ChatViewProvider.handleMessage] Webview not available for user message display');
        }
        
        // Send to the chat service
        this.chatService.sendMessage(message, true)
            .then((result) => {
                console.log('✅ [ChatViewProvider.handleMessage] Message successfully sent to ChatService', result);
                
                // Store the mapping between server message ID and our local ID
                if (result && result.messageId) {
                    console.log(`🔗 [ChatViewProvider.handleMessage] Mapping server messageId ${result.messageId} to local ID ${localMessageId}`);
                    this.messageIdMap.set(result.messageId, localMessageId);
                }
            })
            .catch(error => {
                console.error('❌ [ChatViewProvider.handleMessage] Error sending message to ChatService:', error);
                
                // Try to show an error message in the UI
                if (this._view && this._view.webview && this.webviewReady) {
                    try {
                        this._view.webview.postMessage({
                            type: 'newMessage',
                            message: {
                                role: 'error',
                                content: `Error sending message to server: ${error.message || 'Unknown error'}`,
                                id: `error_${Date.now()}`
                            }
                        });
                    } catch (uiError) {
                        console.error('❌ [ChatViewProvider.handleMessage] Error showing error message in UI:', uiError);
                    }
                }
            });
    }

    private handleMessageFromService(message: Message): void {
        if (this._view && this._view.webview && this.webviewReady) {
            try {
                this._view.webview.postMessage({
                    type: 'newMessage',
                    message
                });
                console.log('✅ [ChatViewProvider.handleMessageFromService] Message sent to webview');
            } catch (error) {
                console.error('❌ [ChatViewProvider.handleMessageFromService] Error sending message to webview:', error);
            }
        } else {
            console.warn('⚠️ [ChatViewProvider.handleMessageFromService] Webview not available, queueing message');
            if (message.id) {
                this.pendingMessages.set(message.id, message);
            } else {
                // Generate an ID if one doesn't exist
                const generatedId = `gen_${Date.now()}`;
                message.id = generatedId;
                this.pendingMessages.set(generatedId, message);
            }
        }
    }

    private handleStreamingMessage(message: Message, status: string, originalMessageId?: string): void {
        console.log(`💬 [ChatViewProvider.handleStreamingMessage] Received streaming message with status: ${status}`);
        console.log(`💬 [ChatViewProvider.handleStreamingMessage] originalMessageId: ${originalMessageId || 'undefined'}`);
        
        // Create a safe copy of the message to ensure we don't have undefined content
        const safeMessage = {
            ...message,
            content: message.content || ''  // Ensure content is never undefined
        };
        
        if (this.config.debug) {
            if (status === 'started') {
                console.log(`[ChatViewProvider] Streaming started for message ${originalMessageId}`);
            } else if (status === 'streaming') {
                console.log(`[ChatViewProvider] Streaming message: ${originalMessageId}, content length: ${safeMessage.content.length}`);
            } else if (status === 'completed') {
                console.log(`[ChatViewProvider] Stream completed for message ${originalMessageId}, final content length: ${safeMessage.content.length}`);
            }
        }

        // Check if webview is really available - use our ready flag
        if (!this._view || !this._view.webview || !this.webviewReady) {
            console.log(`⚠️ [ChatViewProvider.handleStreamingMessage] Webview not available or not ready, queueing message with status: ${status}`);
            console.log(`⚠️ [ChatViewProvider.handleStreamingMessage] webviewReady: ${this.webviewReady}, _view exists: ${!!this._view}, webview exists: ${!!this._view?.webview}`);
            
            // Only store messages with 'completed' status in the pending queue
            // This avoids partial messages from being stored
            if (status === 'completed' && originalMessageId) {
                this.pendingMessages.set(originalMessageId, safeMessage);
                console.log(`⚠️ [ChatViewProvider.handleStreamingMessage] Completed message saved to pending queue: ${originalMessageId}`);
                
                // Try to process pending messages after a short delay
                // This gives the webview more time to initialize
                setTimeout(() => {
                    if (this.webviewReady) {
                        console.log(`⏱️ [ChatViewProvider.handleStreamingMessage] Delayed attempt to process pending messages`);
                        this.processPendingMessages();
                    }
                }, 1000);
            } else {
                console.log(`⚠️ [ChatViewProvider.handleStreamingMessage] Non-completed message not saved to queue: ${originalMessageId}, status: ${status}`);
            }
            return;
        }
        
        // Find the local message ID if we have an original message ID
        let localMessageId = originalMessageId;
        if (originalMessageId && this.messageIdMap.has(originalMessageId)) {
            localMessageId = this.messageIdMap.get(originalMessageId);
            console.log(`🔍 [ChatViewProvider.handleStreamingMessage] Found local messageId ${localMessageId} for server messageId ${originalMessageId}`);
        } else if (originalMessageId) {
            console.log(`⚠️ [ChatViewProvider.handleStreamingMessage] No local messageId found for server messageId ${originalMessageId}, using it directly`);
            // If we don't have a mapping but we have an originalMessageId, use it directly
            localMessageId = originalMessageId;
        } else {
            // If we have neither, create a new random ID
            localMessageId = `auto_${Date.now()}`;
            console.log(`⚠️ [ChatViewProvider.handleStreamingMessage] No originalMessageId provided, created new ID: ${localMessageId}`);
        }
        
        // Log the message content for debugging
        console.log(`💬 [ChatViewProvider.handleStreamingMessage] Content length: ${safeMessage.content?.length || 0}`);
        if (safeMessage.content && safeMessage.content.length > 0) {
            console.log(`💬 [ChatViewProvider.handleStreamingMessage] Content preview: ${safeMessage.content.substring(0, 30)}...`);
        } else {
            console.log(`💬 [ChatViewProvider.handleStreamingMessage] Content is empty, will display typing indicator`);
        }
        
        try {
            // Process message based on status
            if (status === 'started') {
                // Send the correct message type for adding a new streaming message
                this._view.webview.postMessage({
                    type: 'addStreamingMessage',
                    message: {
                        role: safeMessage.role,
                        content: ''  // Start with empty content to show typing indicator
                    },
                    messageId: localMessageId
                });
                console.log(`✅ [ChatViewProvider.handleStreamingMessage] Started message sent to webview, ID: ${localMessageId}`);
            } else if (status === 'streaming') {
                // Send the correct message type for updating a streaming message
                this._view.webview.postMessage({
                    type: 'updateStreamingMessage',
                    message: {
                        content: safeMessage.content
                    },
                    messageId: localMessageId
                });
                console.log(`✅ [ChatViewProvider.handleStreamingMessage] Streaming update sent to webview, ID: ${localMessageId}`);
            } else if (status === 'completed') {
                // Ensure there's valid content for complete messages, otherwise set error
                const finalContent = safeMessage.content.trim() === '' 
                    ? 'Sorry, I encountered an issue generating a response. Please try again.'
                    : safeMessage.content;

                // Send the correct message type for completing a streaming message
                this._view.webview.postMessage({
                    type: 'completeStreamingMessage',
                    message: {
                        content: finalContent
                    },
                    messageId: localMessageId
                });
                console.log(`✅ [ChatViewProvider.handleStreamingMessage] Completed message sent to webview, ID: ${localMessageId}`);
            } else {
                // For other statuses, use a generic update
                this._view.webview.postMessage({
                    type: 'updateStreamingMessage',
                    message: safeMessage,
                    messageId: localMessageId
                });
                console.log(`✅ [ChatViewProvider.handleStreamingMessage] Generic update sent to webview, ID: ${localMessageId}, status: ${status}`);
            }
        } catch (error) {
            console.error(`❌ [ChatViewProvider.handleStreamingMessage] Error sending message to webview:`, error);
            
            // If we encounter an error sending to the webview, queue the message for later
            if (originalMessageId) {
                this.pendingMessages.set(originalMessageId, safeMessage);
                console.log(`⚠️ [ChatViewProvider.handleStreamingMessage] Message saved to pending queue after error: ${originalMessageId}`);
            }
        }
    }

    private loadConversationHistory(): void {
        // Here you would load conversation history from the ChatService
        // For now, just a stub
        console.log('Loading conversation history...');
    }

    private processPendingMessages(): void {
        if (this.pendingMessages.size === 0) {
            return;
        }
        
        console.log(`🔄 [ChatViewProvider.processPendingMessages] Processing ${this.pendingMessages.size} pending messages`);
        
        // Check if we have a webview to send to
        if (!this._view || !this._view.webview || !this.webviewReady) {
            console.log(`⚠️ [ChatViewProvider.processPendingMessages] Webview not available or not ready, cannot process pending messages`);
            console.log(`⚠️ [ChatViewProvider.processPendingMessages] webviewReady: ${this.webviewReady}, _view exists: ${!!this._view}, webview exists: ${!!this._view?.webview}`);
            return;
        }
        
        // Process each pending message
        const pendingMessagesCopy = new Map(this.pendingMessages);
        pendingMessagesCopy.forEach((message, originalMessageId) => {
            console.log(`🔄 [ChatViewProvider.processPendingMessages] Processing message: ${originalMessageId}`);
            
            try {
                // Send directly to the webview as a complete non-streaming message
                this._view!.webview.postMessage({
                    type: 'newMessage',
                    message: {
                        role: message.role || 'assistant',
                        content: message.content || 'No content provided',
                        id: originalMessageId
                    }
                });
                
                console.log(`✅ [ChatViewProvider.processPendingMessages] Successfully sent message ${originalMessageId} to webview`);
                
                // Remove from pending queue
                this.pendingMessages.delete(originalMessageId);
            } catch (error) {
                console.error(`❌ [ChatViewProvider.processPendingMessages] Error sending message ${originalMessageId} to webview:`, error);
            }
        });
        
        console.log(`✅ [ChatViewProvider.processPendingMessages] Processed all pending messages, remaining: ${this.pendingMessages.size}`);
    }
}
