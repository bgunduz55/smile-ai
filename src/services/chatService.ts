import * as vscode from 'vscode';
import { aiService } from './aiService';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export class ChatService {
    private static instance: ChatService;
    private messages: ChatMessage[] = [];
    private webviewPanel: vscode.WebviewPanel | undefined;

    private constructor() {}

    public static getInstance(): ChatService {
        if (!ChatService.instance) {
            ChatService.instance = new ChatService();
        }
        return ChatService.instance;
    }

    public async openChat() {
        if (this.webviewPanel) {
            this.webviewPanel.reveal();
            return;
        }

        this.webviewPanel = vscode.window.createWebviewPanel(
            'smileChat',
            'Smile AI Chat',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.webviewPanel.webview.html = this.getWebviewContent();

        this.webviewPanel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        await this.handleUserMessage(message.text);
                        break;
                }
            },
            undefined,
            []
        );

        this.webviewPanel.onDidDispose(
            () => {
                this.webviewPanel = undefined;
            },
            null,
            []
        );
    }

    private async handleUserMessage(content: string) {
        const userMessage: ChatMessage = {
            role: 'user',
            content,
            timestamp: new Date()
        };

        this.messages.push(userMessage);
        await this.updateWebview();

        try {
            const response = await aiService.generateResponse(content);
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: response,
                timestamp: new Date()
            };

            this.messages.push(assistantMessage);
            await this.updateWebview();
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            vscode.window.showErrorMessage(`Chat hatası: ${errorMessage}`);
        }
    }

    private async updateWebview() {
        if (!this.webviewPanel) {
            return;
        }

        this.webviewPanel.webview.html = this.getWebviewContent();
    }

    private getWebviewContent(): string {
        const messagesHtml = this.messages.map(message => `
            <div class="message ${message.role}">
                <div class="content">${message.content}</div>
            </div>
        `).join('');

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Smile AI Chat</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        margin: 0;
                        padding: 20px;
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                    }
                    .messages {
                        margin-bottom: 20px;
                        overflow-y: auto;
                        max-height: calc(100vh - 150px);
                    }
                    .message {
                        margin: 10px 0;
                        padding: 10px;
                        border-radius: 5px;
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
                        border: 1px solid var(--vscode-input-border);
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
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
                    ${messagesHtml}
                </div>
                <div class="input-container">
                    <input type="text" id="messageInput" placeholder="Mesajınızı yazın...">
                    <button onclick="sendMessage()">Gönder</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const messageInput = document.getElementById('messageInput');

                    messageInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            sendMessage();
                        }
                    });

                    function sendMessage() {
                        const text = messageInput.value;
                        if (text) {
                            vscode.postMessage({
                                command: 'sendMessage',
                                text: text
                            });
                            messageInput.value = '';
                        }
                    }

                    const messages = document.querySelector('.messages');
                    messages.scrollTop = messages.scrollHeight;
                </script>
            </body>
            </html>
        `;
    }
}

export const chatService = ChatService.getInstance(); 