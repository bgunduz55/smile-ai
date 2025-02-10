import * as vscode from 'vscode';
import { aiService } from '../services/aiService';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.chatView';
    private _view?: vscode.WebviewView;
    private messages: ChatMessage[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {}

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

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleMessage(data.value);
                    break;
            }
        });
    }

    public async handleMessage(content: string) {
        if (!this._view) return;

        const userMessage: ChatMessage = {
            role: 'user',
            content,
            timestamp: new Date()
        };

        this.messages.push(userMessage);
        await this._updateView();

        try {
            const response = await aiService.generateResponse(content);
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: response,
                timestamp: new Date()
            };

            this.messages.push(assistantMessage);
            await this._updateView();
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Chat error: ${errorMessage}`);
        }
    }

    private async _updateView() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
        }
    }

    private _getHtmlForWebview(_webview: vscode.Webview) {
        const messageHtml = this.messages
            .map(
                (msg) => `
                <div class="message ${msg.role}">
                    <div class="message-content">${this._escapeHtml(msg.content)}</div>
                    <div class="message-timestamp">${msg.timestamp.toLocaleTimeString()}</div>
                </div>
            `
            )
            .join('');

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Smile AI Chat</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        margin: 0;
                        padding: 20px;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .messages {
                        margin-bottom: 20px;
                        overflow-y: auto;
                        max-height: calc(100vh - 150px);
                    }
                    .message {
                        margin: 10px 0;
                        padding: 10px;
                        border-radius: 4px;
                    }
                    .user {
                        background-color: var(--vscode-editor-selectionBackground);
                        margin-left: 20%;
                    }
                    .assistant {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        margin-right: 20%;
                    }
                    .message-timestamp {
                        font-size: 0.8em;
                        color: var(--vscode-descriptionForeground);
                        margin-top: 5px;
                    }
                    .input-container {
                        position: fixed;
                        bottom: 20px;
                        left: 20px;
                        right: 20px;
                        display: flex;
                        gap: 10px;
                    }
                    #messageInput {
                        flex: 1;
                        padding: 8px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                    }
                    button {
                        padding: 8px 16px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="messages">
                    ${messageHtml}
                </div>
                <div class="input-container">
                    <input type="text" id="messageInput" placeholder="Write your message...">
                    <button onclick="sendMessage()">Send</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const messageInput = document.getElementById('messageInput');
                    const messages = document.querySelector('.messages');

                    messageInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            sendMessage();
                        }
                    });

                    function sendMessage() {
                        const text = messageInput.value;
                        if (text) {
                            vscode.postMessage({
                                type: 'sendMessage',
                                value: text
                            });
                            messageInput.value = '';
                        }
                    }

                    // Scroll messages to bottom
                    messages.scrollTop = messages.scrollHeight;
                </script>

            </body>
            </html>
        `;
    }

    private _escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    public async getContent(): Promise<string> {
        return `
            <div class="chat-container">
                <div class="chat-messages" id="chatMessages">
                    ${this.messages.map(msg => `
                        <div class="chat-message ${msg.role}">
                            <div class="message-content">${this._escapeHtml(msg.content)}</div>
                            <div class="message-timestamp">${msg.timestamp.toLocaleTimeString()}</div>
                        </div>
                    `).join('')}
                </div>
                <div class="chat-input-container">
                    <textarea 
                        id="chatInput" 
                        placeholder="Type your message..."
                        rows="3"
                    ></textarea>
                    <button id="sendMessage">
                        <i class="codicon codicon-send"></i>
                        Send
                    </button>
                </div>
            </div>
        `;
    }

    public setWebview(webview: vscode.WebviewView) {
        this._view = webview;
    }
} 