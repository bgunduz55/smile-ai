import * as vscode from 'vscode';
import { ChatService } from '../../application/services/ChatService';
import { Message } from '../../domain/entities/Message';
import { ChatSession } from '../../domain/entities/ChatSession';
import { AIModelConfig } from '../../domain/interfaces/IAIService';
import { ModelProvider } from '../../models/settings';
import { marked } from 'marked';
import hljs from 'highlight.js';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.chatView';
    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly chatService: ChatService
    ) {
        this._extensionUri = extensionUri;
        const renderer = new marked.Renderer();
        marked.setOptions({
            renderer,
            gfm: true,
            breaks: true
        });

        // Kod bloklarının nasıl işleneceğini özelleştir
        renderer.code = ({ text, lang }) => {
            const validLanguage = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
            const highlighted = hljs.highlight(text, { language: validLanguage }).value;
            return `<pre><code class="hljs language-${validLanguage}">${highlighted}</code></pre>`;
        };
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this._setWebviewMessageListener(webviewView.webview);
        this._initializeProviders();
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const styleChatUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleMainUri}" rel="stylesheet">
                <link href="${styleChatUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <title>Chat</title>
            </head>
            <body>
                <div class="chat-container">
                    <div class="chat-messages" id="chatMessages"></div>
                    <div class="chat-input-container">
                        <textarea id="chatInput" placeholder="Type your message..."></textarea>
                        <button id="sendButton" class="send-button">
                            <i class="codicon codicon-send"></i>
                        </button>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private async _initializeProviders(): Promise<void> {
        if (!this._view) return;

        const providers = await this.chatService.getAvailableProviders();
        const currentProvider = this.chatService.getCurrentProvider();

        await this._view.webview.postMessage({
            type: 'updateProviders',
            providers: providers.map(provider => ({
                id: provider,
                name: this._formatProviderName(provider),
                isActive: provider === currentProvider
            }))
        });

        // Mevcut provider için modelleri yükle
        await this._loadModelsForProvider(currentProvider);
    }

    private _formatProviderName(provider: ModelProvider): string {
        switch (provider) {
            case 'ollama': return 'Ollama (Local)';
            case 'openai': return 'OpenAI';
            case 'anthropic': return 'Anthropic Claude';
            case 'lmstudio': return 'LM Studio (Local)';
            case 'localai': return 'LocalAI (Local)';
            case 'deepseek': return 'Deepseek Coder';
            case 'qwen': return 'Qwen';
            default: return provider;
        }
    }

    private async _loadModelsForProvider(provider: ModelProvider | null): Promise<void> {
        if (!this._view || !provider) return;

        try {
            const service = this.chatService.getCurrentService();
            if (!service) {
                await this.chatService.switchProvider(provider);
                return;
            }
            
            const models = await service.getAvailableModels();
            await this._view.webview.postMessage({
                type: 'updateModels',
                models: models.map(model => ({
                    name: model,
                    isActive: false
                }))
            });
        } catch (error) {
            this._showError(error);
        }
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message: any) => {
                const { command, text } = message;

                switch (command) {
                    case 'sendMessage':
                        try {
                            const response = await this.chatService.sendMessage(text);
                            webview.postMessage({
                                type: 'addMessage',
                                message: response
                            });
                        } catch (error) {
                            webview.postMessage({
                                type: 'error',
                                message: error instanceof Error ? error.message : 'An error occurred'
                            });
                        }
                        break;

                    case 'streamMessage':
                        try {
                            await this.chatService.streamMessage(text, (content: string) => {
                                webview.postMessage({
                                    type: 'updateStream',
                                    content
                                });
                            });
                        } catch (error) {
                            webview.postMessage({
                                type: 'error',
                                message: error instanceof Error ? error.message : 'An error occurred'
                            });
                        }
                        break;

                    case 'getHistory':
                        try {
                            const history = await this.chatService.getSessionHistory();
                            webview.postMessage({
                                type: 'setHistory',
                                messages: history
                            });
                        } catch (error) {
                            webview.postMessage({
                                type: 'error',
                                message: error instanceof Error ? error.message : 'An error occurred'
                            });
                        }
                        break;

                    case 'clearChat':
                        try {
                            await this.chatService.clearSession();
                            webview.postMessage({
                                type: 'clearChat'
                            });
                        } catch (error) {
                            webview.postMessage({
                                type: 'error',
                                message: error instanceof Error ? error.message : 'An error occurred'
                            });
                        }
                        break;
                }
            },
            undefined,
            []
        );
    }

    private _showError(error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        vscode.window.showErrorMessage(`Chat error: ${message}`);
    }
} 