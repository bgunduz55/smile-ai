import * as vscode from 'vscode';
import { Message } from '../types/chat';
import { ChatService } from '../utils/ChatService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private chatService: ChatService;
    private pendingMessages: Map<string, Message> = new Map();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        chatService: ChatService
    ) {
        this.chatService = chatService;
        
        // Listen for messages from the ChatService
        this.chatService.on('message', (data) => {
            this.handleMessageFromService(data.message);
        });
        
        // Listen for streaming responses
        this.chatService.on('stream', (data) => {
            this.handleStreamingMessage(data.message, data.status);
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Set up message handler
        webviewView.webview.onDidReceiveMessage(message => {
            if (message.type === 'userMessage') {
                this.handleMessage(message.content);
            }
        });

        webviewView.webview.html = this._getHtmlForWebview();
        
        // Load initial conversation history
        this.loadConversationHistory();
    }

    private async loadConversationHistory(): Promise<void> {
        if (!this._view) return;
        
        const history = await this.chatService.getConversationHistory();
        history.forEach(message => {
            this._view?.webview.postMessage({ 
                type: 'addMessage', 
                message 
            });
        });
    }

    private handleMessage(message: string): void {
        // Add more detailed logging
        console.log('💬 [ChatViewProvider.handleMessage] Received user message:', message.substring(0, 30) + (message.length > 30 ? '...' : ''));
        console.log('🚀 [ChatViewProvider.handleMessage] Forwarding to ChatService.sendMessage');
        
        // Send to the chat service
        this.chatService.sendMessage(message, true)
            .then(() => {
                console.log('✅ [ChatViewProvider.handleMessage] Message successfully sent to ChatService');
            })
            .catch(error => {
                console.error('❌ [ChatViewProvider.handleMessage] Error sending message to ChatService:', error);
            });
    }
    
    private handleMessageFromService(message: Message): void {
        if (!this._view) return;
        
        this._view.webview.postMessage({ 
            type: 'addMessage', 
            message 
        });
    }
    
    private handleStreamingMessage(message: Message, status: string): void {
        if (!this._view) return;
        
        if (status === 'started') {
            // Create a placeholder for this message with an ID
            const messageId = `stream-${Date.now()}`;
            message.id = messageId;
            this.pendingMessages.set(messageId, message);
            
            this._view.webview.postMessage({ 
                type: 'addStreamingMessage', 
                message,
                messageId
            });
        } else if (status === 'streaming') {
            // Update the existing message
            this._view.webview.postMessage({ 
                type: 'updateStreamingMessage', 
                message,
                messageId: message.id
            });
        } else if (status === 'completed') {
            // Finalize the message
            this._view.webview.postMessage({ 
                type: 'completeStreamingMessage', 
                message,
                messageId: message.id
            });
            
            // Remove from pending
            if (message.id) {
                this.pendingMessages.delete(message.id);
            }
        }
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Chat View</title>
                <style>
                    #chat-container {
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        padding: 1rem;
                    }
                    .message-input {
                        position: fixed;
                        bottom: 1rem;
                        left: 1rem;
                        right: 1rem;
                        display: flex;
                        gap: 0.5rem;
                    }
                    #message-box {
                        flex: 1;
                        padding: 0.5rem;
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                    }
                    button {
                        padding: 0.5rem 1rem;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        cursor: pointer;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .messages {
                        margin-bottom: 60px;
                        overflow-y: auto;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }
                    .message {
                        padding: 8px 12px;
                        border-radius: 4px;
                        max-width: 80%;
                        word-wrap: break-word;
                    }
                    .user {
                        align-self: flex-end;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    .assistant {
                        align-self: flex-start;
                        background-color: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-panelTitle-activeBorder);
                    }
                    .typing {
                        position: relative;
                    }
                    .typing::after {
                        content: '';
                        width: 6px;
                        height: 6px;
                        background: var(--vscode-textLink-foreground);
                        display: inline-block;
                        margin-left: 4px;
                        border-radius: 50%;
                        animation: pulse 1s infinite;
                    }
                    @keyframes pulse {
                        0% { opacity: 0.4; }
                        50% { opacity: 1; }
                        100% { opacity: 0.4; }
                    }
                </style>
            </head>
            <body>
                <div id="chat-container">
                    <div id="messages" class="messages"></div>
                    <div class="message-input">
                        <input type="text" id="message-box" placeholder="Type your message...">
                        <button id="send-button">Send</button>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const messageBox = document.getElementById('message-box');
                    const sendButton = document.getElementById('send-button');
                    const messagesContainer = document.getElementById('messages');
                    
                    // Map to store pending streaming messages
                    const pendingMessages = new Map();

                    function sendMessage() {
                        const content = messageBox.value.trim();
                        if (content) {
                            vscode.postMessage({
                                type: 'userMessage',
                                content: content
                            });
                            messageBox.value = '';
                        }
                    }

                    messageBox.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            sendMessage();
                        }
                    });

                    sendButton.addEventListener('click', sendMessage);

                    window.addEventListener('message', event => {
                        const message = event.data;
                        
                        if (message.type === 'addMessage') {
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'message ' + message.message.role;
                            messageDiv.textContent = message.message.content;
                            messagesContainer.appendChild(messageDiv);
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        } 
                        else if (message.type === 'addStreamingMessage') {
                            // Create a new streaming message
                            const messageDiv = document.createElement('div');
                            messageDiv.id = message.messageId;
                            messageDiv.className = 'message assistant typing';
                            messageDiv.textContent = ''; // Start empty
                            messagesContainer.appendChild(messageDiv);
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;
                            
                            // Store reference
                            pendingMessages.set(message.messageId, messageDiv);
                        }
                        else if (message.type === 'updateStreamingMessage') {
                            // Update an existing streaming message
                            const messageDiv = pendingMessages.get(message.messageId);
                            if (messageDiv) {
                                messageDiv.textContent = message.message.content;
                                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                            }
                        }
                        else if (message.type === 'completeStreamingMessage') {
                            // Finalize a streaming message
                            const messageDiv = pendingMessages.get(message.messageId);
                            if (messageDiv) {
                                messageDiv.textContent = message.message.content;
                                messageDiv.classList.remove('typing');
                                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                                pendingMessages.delete(message.messageId);
                            }
                        }
                    });
                </script>
            </body>
            </html>`;
    }
} 