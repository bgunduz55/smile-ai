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

        try {
            // Kullanıcı mesajını ekle
            const userMessage: ChatMessage = {
                role: 'user',
                content,
                timestamp: new Date()
            };

            this.messages.push(userMessage);
            await this._view.webview.postMessage({
                type: 'addMessage',
                role: 'user',
                content: content
            });

            // Yükleme göstergesini göster
            await this._view.webview.postMessage({
                type: 'showLoading'
            });

            // AI yanıtını al
            const response = await aiService.generateResponse(content);
            
            // Yükleme göstergesini gizle
            await this._view.webview.postMessage({
                type: 'hideLoading'
            });

            // AI yanıtını ekle
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: response,
                timestamp: new Date()
            };

            this.messages.push(assistantMessage);
            await this._view.webview.postMessage({
                type: 'addMessage',
                role: 'assistant',
                content: response
            });

        } catch (error: unknown) {
            // Yükleme göstergesini gizle
            await this._view.webview.postMessage({
                type: 'hideLoading'
            });

            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Chat error: ${errorMessage}`);
            await this._view.webview.postMessage({
                type: 'addMessage',
                role: 'assistant',
                content: `Error: ${errorMessage}`
            });
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
        const config = vscode.workspace.getConfiguration('smile-ai');
        const currentProvider = config.get<string>('aiProvider', 'ollama');
        const currentModel = config.get<string>(`${currentProvider}.model`, '');

        return `
            <div class="chat-container">
                <div class="chat-header">
                    <div class="model-selector">
                        <label>AI Model:</label>
                        <select id="modelSelect" onchange="updateModel(this.value)">
                            ${await this.getModelOptions(currentProvider, currentModel)}
                        </select>
                    </div>
                </div>
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
                <div id="loading" class="loading-indicator" style="display: none;">
                    <div class="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
            <style>
                .loading-indicator {
                    position: fixed;
                    bottom: 100px;
                    left: 20px;
                    background: var(--vscode-editor-background);
                    padding: 10px;
                    border-radius: 4px;
                    border: 1px solid var(--vscode-panel-border);
                }
                
                .typing-indicator {
                    display: flex;
                    gap: 5px;
                }
                
                .typing-indicator span {
                    width: 8px;
                    height: 8px;
                    background: var(--vscode-foreground);
                    border-radius: 50%;
                    animation: typing 1s infinite ease-in-out;
                    opacity: 0.4;
                }
                
                .typing-indicator span:nth-child(1) { animation-delay: 0.2s; }
                .typing-indicator span:nth-child(2) { animation-delay: 0.4s; }
                .typing-indicator span:nth-child(3) { animation-delay: 0.6s; }
                
                @keyframes typing {
                    0% { transform: translateY(0); }
                    50% { transform: translateY(-5px); }
                    100% { transform: translateY(0); }
                }
            </style>
            <script>
                const vscode = acquireVsCodeApi();
                
                function updateModel(value) {
                    vscode.postMessage({
                        type: 'updateSetting',
                        key: '${currentProvider}.model',
                        value: value
                    });
                }

                function showLoading() {
                    document.getElementById('loading').style.display = 'block';
                    document.getElementById('sendMessage').disabled = true;
                    document.getElementById('chatInput').disabled = true;
                }

                function hideLoading() {
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('sendMessage').disabled = false;
                    document.getElementById('chatInput').disabled = false;
                }

                function sendMessage() {
                    const chatInput = document.getElementById('chatInput');
                    const text = chatInput.value.trim();
                    if (text) {
                        showLoading();
                        vscode.postMessage({
                            type: 'sendMessage',
                            value: text
                        });
                        chatInput.value = '';
                    }
                }

                // Initialize chat input
                const chatInput = document.getElementById('chatInput');
                const sendButton = document.getElementById('sendMessage');

                if (chatInput && sendButton) {
                    chatInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });

                    sendButton.addEventListener('click', sendMessage);
                }

                // Handle messages from extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'addMessage') {
                        hideLoading();
                    }
                });
            </script>
        `;
    }

    private async getModelOptions(provider: string, currentModel: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('smile-ai');
        let options = '';

        switch (provider) {
            case 'ollama':
                const endpoint = config.get('ollama.endpoint', 'http://localhost:11434');
                try {
                    const response = await fetch(`${endpoint}/api/tags`);
                    if (response.ok) {
                        const data = await response.json() as { models: Array<{ name: string }> };
                        options = data.models.map(model => 
                            `<option value="${model.name}" ${model.name === currentModel ? 'selected' : ''}>
                                ${model.name}
                            </option>`
                        ).join('');
                    }
                } catch (error) {
                    console.error('Error fetching Ollama models:', error);
                }
                break;
            case 'openai':
                options = `
                    <option value="gpt-4" ${currentModel === 'gpt-4' ? 'selected' : ''}>GPT-4</option>
                    <option value="gpt-3.5-turbo" ${currentModel === 'gpt-3.5-turbo' ? 'selected' : ''}>GPT-3.5 Turbo</option>
                `;
                break;
            case 'anthropic':
                options = `
                    <option value="claude-3-opus-20240229" ${currentModel === 'claude-3-opus-20240229' ? 'selected' : ''}>Claude 3 Opus</option>
                    <option value="claude-3-sonnet-20240229" ${currentModel === 'claude-3-sonnet-20240229' ? 'selected' : ''}>Claude 3 Sonnet</option>
                    <option value="claude-2.1" ${currentModel === 'claude-2.1' ? 'selected' : ''}>Claude 2.1</option>
                `;
                break;
        }

        return options;
    }

    public setWebview(webview: vscode.WebviewView) {
        this._view = webview;
    }
} 