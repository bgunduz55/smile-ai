import * as vscode from 'vscode';
import { ChatViewProvider } from '../presentation/webview/ChatViewProvider';
import { SuggestionViewProvider } from './suggestionViewProvider';
import { RulesViewProvider } from './rulesViewProvider';
import { SettingsViewProvider } from './settingsViewProvider';
import { AIServiceFactory, AIProvider } from '../services/llm/aiServiceFactory';
import { SettingsService } from '../services/settingsService';
import { RateLimiterService } from '../services/rateLimiterService';
import { ErrorHandlingService } from '../services/errorHandlingService';
import { ChatService } from '../application/services/ChatService';
import { VSCodeChatRepository } from '../infrastructure/repositories/VSCodeChatRepository';
import { ModelProvider } from '../models/settings';

interface WebviewMessage {
    command: string;
    view?: string;
    provider?: string;
    settings?: any;
    message?: string;
}

interface WebviewResponse {
    type: string;
    view?: string;
    provider?: string;
    providers?: Array<{
        id: string;
        name: string;
        isActive: boolean;
    }>;
    message?: string;
}

type ViewType = 'chat' | 'composer' | 'suggestions' | 'rules' | 'settings';

export class MainViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.mainView';
    private _view?: vscode.WebviewView;
    private readonly viewTypes: ViewType[] = [
        'chat',
        'composer',
        'suggestions',
        'rules',
        'settings'
    ];
    private readonly chatProvider: ChatViewProvider;
    private readonly suggestionProvider: SuggestionViewProvider;
    private readonly rulesProvider: RulesViewProvider;
    private readonly settingsProvider: SettingsViewProvider;
    private readonly chatService: ChatService;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly settingsService: SettingsService,
        private readonly rateLimiter: RateLimiterService,
        private readonly errorHandler: ErrorHandlingService,
        private readonly context: vscode.ExtensionContext
    ) {
        const aiServiceFactory = AIServiceFactory.getInstance(settingsService, rateLimiter, errorHandler);
        const chatRepository = VSCodeChatRepository.getInstance(context);
        this.chatService = ChatService.getInstance(
            chatRepository,
            aiServiceFactory,
            settingsService,
            rateLimiter,
            errorHandler
        );
        this.chatProvider = new ChatViewProvider(extensionUri, this.chatService);
        this.suggestionProvider = new SuggestionViewProvider(extensionUri, this.chatService);
        this.rulesProvider = new RulesViewProvider(extensionUri, this.chatService);
        this.settingsProvider = new SettingsViewProvider(extensionUri, settingsService);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this._setWebviewMessageListener(webviewView.webview);
        void this.updateProviders();
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                const { command, view, provider } = message;

                switch (command) {
                    case 'switchView': {
                        if (typeof view === 'string' && this.isValidView(view)) {
                            this.handleViewSwitch(view);
                        }
                        break;
                    }

                    case 'switchProvider': {
                        if (typeof provider === 'string' && this.isValidProvider(provider)) {
                            try {
                                await this.chatService.switchProvider(provider);
                                const response: WebviewResponse = {
                                    type: 'providerSwitched',
                                    provider
                                };
                                void webview.postMessage(response);
                            } catch (error) {
                                const response: WebviewResponse = {
                                    type: 'error',
                                    message: error instanceof Error ? error.message : 'Failed to switch provider'
                                };
                                void webview.postMessage(response);
                            }
                        }
                        break;
                    }

                    case 'updateSettings':
                        await this._handleSettingsUpdate(message.settings);
                        break;

                    case 'sendMessage':
                        if (typeof message.message === 'string') {
                            await this._handleMessageSend(message.message);
                        }
                        break;
                }
            },
            undefined,
            []
        );
    }

    private isValidProvider(provider: string): provider is ModelProvider {
        return ['ollama', 'openai', 'anthropic', 'lmstudio', 'localai', 'deepseek', 'qwen'].includes(provider);
    }

    private isValidView(view: string): view is ViewType {
        return this.viewTypes.includes(view as ViewType);
    }

    public handleViewSwitch(view: ViewType): void {
        if (!this._view) {
            return;
        }

        const response: WebviewResponse = {
            type: 'viewSwitched',
            view
        };
        void this._view.webview.postMessage(response);
    }

    private async _handleSettingsUpdate(settings: any) {
        try {
            await this.settingsService.updateSettings(settings);
            if (this._view) {
                this._view.webview.postMessage({ command: 'settingsUpdated' });
            }
        } catch (error) {
            await this.errorHandler.handleError(error);
        }
    }

    private async _handleMessageSend(message: string) {
        try {
            const response = await this.chatService.sendMessage(message);
            if (this._view) {
                this._view.webview.postMessage({ command: 'messageReceived', message: response });
            }
        } catch (error) {
            await this.errorHandler.handleError(error);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};">
                <link href="${styleMainUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <title>Smile AI</title>
            </head>
            <body>
                <div class="main-container">
                    <div class="view-selector">
                        <button id="chatButton" class="view-button active">
                            <i class="codicon codicon-comment-discussion"></i>
                            Chat
                        </button>
                        <button id="composerButton" class="view-button">
                            <i class="codicon codicon-edit"></i>
                            Composer
                        </button>
                        <button id="suggestionsButton" class="view-button">
                            <i class="codicon codicon-lightbulb"></i>
                            Suggestions
                        </button>
                        <button id="rulesButton" class="view-button">
                            <i class="codicon codicon-list-tree"></i>
                            Rules
                        </button>
                        <button id="settingsButton" class="view-button">
                            <i class="codicon codicon-settings-gear"></i>
                            Settings
                        </button>
                    </div>
                    <div class="provider-selector">
                        <select id="providerSelect">
                            <!-- Providers will be dynamically added here -->
                        </select>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private async updateProviders(): Promise<void> {
        if (!this._view) {
            return;
        }

        const providers = await this.chatService.getAvailableProviders();
        const currentProvider = this.chatService.getCurrentProvider();

        const response: WebviewResponse = {
            type: 'updateProviders',
            providers: providers.map(provider => ({
                id: provider,
                name: this.formatProviderName(provider),
                isActive: provider === currentProvider
            }))
        };
        void this._view.webview.postMessage(response);
    }

    private formatProviderName(provider: ModelProvider): string {
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
}