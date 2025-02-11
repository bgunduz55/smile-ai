import * as vscode from 'vscode';
import { aiService } from '../services/aiService';
import { SettingsService } from '../services/settingsService';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.chatView';
    private _view?: vscode.WebviewView;
    private messages: ChatMessage[] = [];
    private settingsService: SettingsService;

    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {
        this.settingsService = SettingsService.getInstance();
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
                id: Date.now().toString(),
                role: 'user',
                content,
                timestamp: Date.now()
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
                id: Date.now().toString(),
                role: 'assistant',
                content: response,
                timestamp: Date.now()
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

    private _getHtmlForWebview(webview: vscode.Webview) {
        const settings = this.settingsService.getSettings();
        const currentProvider = settings.provider || 'ollama';
        const providerSettings = settings[currentProvider] || {};
        const activeModels = providerSettings.activeModels || [];
        const currentModel = providerSettings.model || '';

        const modelSelectorHtml = `
            <div class="model-selector" data-provider="${currentProvider}">
                <label>Model:</label>
                <select id="modelSelect" onchange="window.updateModel('${currentProvider}', this.value)">
                    ${activeModels.map(model => `
                        <option value="${model}" ${model === currentModel ? 'selected' : ''}>
                            ${model}
                        </option>
                    `).join('\n')}
                </select>
            </div>
        `;

        const messageHtml = this.messages
            .map(
                (msg) => `
                <div class="message ${msg.role}">
                    <div class="message-content">${this._escapeHtml(msg.content)}</div>
                    <div class="message-time">${this.formatTime(msg.timestamp)}</div>
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
                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 20px;
                        padding: 10px;
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        border-radius: 4px;
                    }
                    .model-selector {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    .model-selector select {
                        padding: 4px 8px;
                        background-color: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        border-radius: 4px;
                    }
                    .messages {
                        margin-bottom: 20px;
                        overflow-y: auto;
                        max-height: calc(100vh - 200px);
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
                    .message-time {
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
                <div class="header">
                    ${modelSelectorHtml}
                </div>
                <div class="messages">
                    ${messageHtml}
                </div>
                <div class="input-container">
                    <input type="text" id="messageInput" placeholder="Write your message...">
                    <button onclick="sendMessage()">Send</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const messages = document.querySelector('.messages');
                    const messageInput = document.getElementById('messageInput');

                    window.updateModel = (provider, model) => {
                        vscode.postMessage({
                            type: 'setActiveModel',
                            provider: provider,
                            model: model
                        });
                    };

                    window.sendMessage = () => {
                        const message = messageInput.value.trim();
                        if (message) {
                            vscode.postMessage({
                                type: 'sendMessage',
                                value: message
                            });
                            messageInput.value = '';
                        }
                    };

                    messageInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            sendMessage();
                        }
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'addMessage': {
                                const messageDiv = document.createElement('div');
                                messageDiv.className = 'message ' + message.role;
                                const content = document.createElement('div');
                                content.className = 'message-content';
                                content.textContent = message.content;
                                const time = document.createElement('div');
                                time.className = 'message-time';
                                time.textContent = new Date().toLocaleTimeString();
                                messageDiv.appendChild(content);
                                messageDiv.appendChild(time);
                                messages.appendChild(messageDiv);
                                messages.scrollTop = messages.scrollHeight;
                                break;
                            }
                            case 'showLoading':
                                // TODO: Implement loading indicator
                                break;
                            case 'hideLoading':
                                // TODO: Hide loading indicator
                                break;
                        }
                    });

                    // Initial scroll to bottom
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

    private formatTime(timestamp: number): string {
        return new Date(timestamp).toLocaleTimeString();
    }

    public async getContent(): Promise<string> {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const currentProvider = config.get<string>('modelProvider', 'ollama');
        const currentModel = config.get(`${currentProvider}.model`, '');

        return `
            <div class="page-container">
                <div class="page-header">
                    <div class="model-selector">
                        <label>Aktif Model:</label>
                        <div class="active-model">
                            <span class="provider-badge">${currentProvider}</span>
                            <span class="model-name">${currentModel || 'Model seçilmedi'}</span>
                        </div>
                    </div>
                </div>
                
                <div class="page-content">
                    <div class="chat-messages" id="chatMessages">
                        ${this.renderMessages()}
                    </div>
                </div>
                
                <div class="page-footer">
                    <div class="chat-input">
                        <textarea 
                            class="chat-textarea" 
                            placeholder="Mesajınızı yazın..."
                            rows="3"
                        ></textarea>
                        <button class="action-button" id="sendMessage">
                            <i class="codicon codicon-send"></i>
                            Gönder
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    private renderMessages(): string {
        if (this.messages.length === 0) {
            return `
                <div class="chat-welcome">
                    <h3>Sohbete Başlayın</h3>
                    <p>AI asistanınız size yardımcı olmak için hazır.</p>
                </div>
            `;
        }

        return this.messages.map(msg => this.renderMessage(msg)).join('\\n');
    }

    private renderMessage(message: ChatMessage): string {
        const isUser = message.role === 'user';
        return `
            <div class="chat-message ${isUser ? 'user' : 'assistant'}">
                <div class="message-content">
                    ${this.formatMessageContent(message.content)}
                </div>
                <div class="message-meta">
                    <span class="message-time">${this.formatTime(message.timestamp)}</span>
                    ${isUser ? '' : `
                        <button class="action-button small" onclick="copyToClipboard('${message.id}')">
                            <i class="codicon codicon-copy"></i>
                        </button>
                    `}
                </div>
            </div>
        `;
    }

    private formatMessageContent(content: string): string {
        // TODO: Implement message formatting (markdown, code blocks, etc.)
        return this._escapeHtml(content);
    }

    public setWebview(webview: vscode.WebviewView) {
        this._view = webview;
    }
} 