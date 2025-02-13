import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { ChatHistoryManager, ChatSession } from '../utils/ChatHistoryManager';
import { CodeChangeManager, CodeChange } from '../utils/CodeChangeManager';

export class ChatPanel {
    public static currentPanel: ChatPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _aiEngine: AIEngine;
    private _historyManager: ChatHistoryManager;
    private _codeChangeManager: CodeChangeManager;
    private _currentSession: ChatSession | undefined;
    private _currentChange: CodeChange | undefined;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        aiEngine: AIEngine,
        context: vscode.ExtensionContext
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._aiEngine = aiEngine;
        this._historyManager = ChatHistoryManager.getInstance(context);
        this._codeChangeManager = CodeChangeManager.getInstance(context);

        this._updateWebview();
        this._setWebviewMessageListener();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static show(
        context: vscode.ExtensionContext,
        aiEngine: AIEngine,
        fileContext?: any
    ) {
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'smileAIChat',
            'Smile AI Chat',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    vscode.Uri.joinPath(context.extensionUri, 'dist')
                ]
            }
        );

        ChatPanel.currentPanel = new ChatPanel(panel, context.extensionUri, aiEngine, context);
    }

    private _updateWebview() {
        const webview = this._panel.webview;

        // HTML içeriğini güncelle
        webview.html = this._getHtmlForWebview();

        // Mevcut oturumu ve geçmişi gönder
        this._sendMessage('updateSessions', {
            sessions: this._historyManager.getAllSessions(),
            currentSession: this._currentSession
        });

        // Mevcut kod değişikliğini gönder
        if (this._currentChange) {
            this._sendMessage('updateCodePreview', {
                preview: this._codeChangeManager.getPreviewContent(this._currentChange.id)
            });
        }
    }

    private _setWebviewMessageListener() {
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'createSession':
                        this._currentSession = this._historyManager.createSession(message.title);
                        this._updateWebview();
                        break;

                    case 'selectSession':
                        this._currentSession = this._historyManager.getSession(message.sessionId);
                        this._updateWebview();
                        break;

                    case 'sendMessage':
                        if (!this._currentSession) {
                            this._currentSession = this._historyManager.createSession('New Chat');
                        }
                        
                        await this._handleUserMessage(message.text);
                        break;

                    case 'applyChange':
                        if (this._currentChange) {
                            await this._codeChangeManager.applyChange(this._currentChange.id);
                            this._currentChange = undefined;
                            this._updateWebview();
                        }
                        break;

                    case 'revertChange':
                        if (this._currentChange) {
                            await this._codeChangeManager.revertChange(this._currentChange.id);
                            this._currentChange = undefined;
                            this._updateWebview();
                        }
                        break;

                    case 'clearSession':
                        if (this._currentSession) {
                            await this._historyManager.clearSession(this._currentSession.id);
                            this._updateWebview();
                        }
                        break;

                    case 'deleteSession':
                        if (this._currentSession) {
                            await this._historyManager.deleteSession(this._currentSession.id);
                            this._currentSession = undefined;
                            this._updateWebview();
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async _handleUserMessage(text: string) {
        if (!this._currentSession) return;

        // Kullanıcı mesajını ekle
        await this._historyManager.addMessage(this._currentSession.id, {
            role: 'user',
            content: text
        });

        // AI yanıtını al
        const response = await this._aiEngine.chat(text);

        // AI yanıtını ekle
        await this._historyManager.addMessage(this._currentSession.id, {
            role: 'assistant',
            content: response.message
        });

        // Kod değişikliği varsa kaydet
        if (response.codeChanges) {
            for (const change of response.codeChanges) {
                this._currentChange = this._codeChangeManager.createChange(
                    change.file,
                    change.originalContent,
                    change.newContent
                );
            }
        }

        this._updateWebview();
    }

    private _getHtmlForWebview(): string {
        const scriptUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js')
        );
        const styleUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css')
        );

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Smile AI Chat</title>
            </head>
            <body>
                <div class="container">
                    <div class="sidebar">
                        <div class="session-controls">
                            <button id="newChat">New Chat</button>
                        </div>
                        <div class="session-list" id="sessionList">
                            <!-- Session listesi dinamik olarak doldurulacak -->
                        </div>
                    </div>
                    <div class="main-content">
                        <div class="chat-container" id="chatContainer">
                            <!-- Mesajlar dinamik olarak doldurulacak -->
                        </div>
                        <div class="code-preview" id="codePreview">
                            <!-- Kod önizlemesi dinamik olarak doldurulacak -->
                        </div>
                        <div class="input-container">
                            <textarea id="userInput" placeholder="Mesajınızı yazın..."></textarea>
                            <button id="sendButton">Gönder</button>
                        </div>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private _sendMessage(command: string, data: any) {
        this._panel.webview.postMessage({ command, ...data });
    }

    public dispose() {
        ChatPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
} 