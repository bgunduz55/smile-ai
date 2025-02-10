import * as vscode from 'vscode';
import { ChatViewProvider } from './chatViewProvider';
import { ComposerViewProvider } from './composerViewProvider';
import { SuggestionViewProvider } from './suggestionViewProvider';
import { RulesViewProvider } from './rulesViewProvider';

type ModelProvider = 'ollama' | 'llamacpp' | 'openai' | 'anthropic';
type OpenAIModel = 'gpt-4' | 'gpt-3.5-turbo';
type AnthropicModel = 'claude-3-opus-20240229' | 'claude-3-sonnet-20240229' | 'claude-2.1';

export class MainViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.mainView';
    private _view?: vscode.WebviewView;
    private chatViewProvider: ChatViewProvider;
    private composerViewProvider: ComposerViewProvider;
    private suggestionViewProvider: SuggestionViewProvider;
    private rulesViewProvider: RulesViewProvider;
    private currentTab: string = 'chat';

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {
        console.log('MainViewProvider: Constructor called');
        this.chatViewProvider = new ChatViewProvider(_extensionUri);
        this.composerViewProvider = new ComposerViewProvider(_extensionUri);
        this.suggestionViewProvider = new SuggestionViewProvider(_extensionUri);
        this.rulesViewProvider = new RulesViewProvider(_extensionUri);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('MainViewProvider: resolveWebviewView starting');
        this._view = webviewView;

        console.log('MainViewProvider: Setting webview options');
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist')
            ]
        };

        // For each provider, set the webview
        console.log('MainViewProvider: Setting webview for providers');
        this.chatViewProvider.setWebview(webviewView);
        this.composerViewProvider.setWebview(webviewView);
        this.suggestionViewProvider.setWebview(webviewView);
        this.rulesViewProvider.setWebview(webviewView);

        // Load initial HTML
        console.log('MainViewProvider: Loading initial HTML');
        const initialHtml = this._getHtmlForWebview(webviewView.webview);
        console.log('MainViewProvider: Initial HTML length:', initialHtml.length);
        webviewView.webview.html = initialHtml;

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log('MainViewProvider: Message received:', message);
            switch (message.type) {
                case 'switchTab':
                    console.log('MainViewProvider: Tab change request:', message.tab);
                    await this.switchTab(message.tab);
                    break;
                case 'updateSetting':
                    console.log('MainViewProvider: Setting update request:', message.key, message.value);
                    await this.updateSetting(message.key, message.value);
                    break;
                case 'getProviderSettings':
                    console.log('MainViewProvider: Provider settings request:', message.provider);
                    const settingsHtml = this._getProviderSpecificSettings(message.provider);
                    await this._view?.webview.postMessage({
                        type: 'updateProviderSettings',
                        content: settingsHtml
                    });
                    break;
                default:
                    // Forward messages to appropriate provider
                    console.log('MainViewProvider: Forwarding message to appropriate provider:', this.currentTab);
                    switch (this.currentTab) {
                        case 'chat':
                            await this.chatViewProvider.handleMessage(message);
                            break;
                        case 'composer':
                            await this.composerViewProvider.handleMessage(message);
                            break;
                        case 'suggestions':
                            await this.suggestionViewProvider.handleMessage(message);
                            break;
                        case 'rules':
                            await this.rulesViewProvider.handleMessage(message);
                            break;
                    }
                    break;
            }
        });

        // Wait for HTML to load then switch to initial tab
        console.log('MainViewProvider: Setting up initial tab switch');
        setTimeout(async () => {
            console.log('MainViewProvider: Switching to initial tab');
            await this.switchTab('chat');
            console.log('MainViewProvider: Initial tab switch completed');
        }, 1000);

        console.log('MainViewProvider: resolveWebviewView completed');
    }

    public async switchTab(tabId: string) {
        console.log(`MainViewProvider: switchTab called with tabId: ${tabId}`);
        if (!this._view) {
            console.log('MainViewProvider: View is not initialized');
            return;
        }

        console.log(`MainViewProvider: Switching to tab: ${tabId}`);
        this.currentTab = tabId;
        let content = '';

        try {
            switch (tabId) {
                case 'chat':
                    console.log('MainViewProvider: Getting chat content');
                    content = await this.chatViewProvider.getContent();
                    break;
                case 'composer':
                    console.log('MainViewProvider: Getting composer content');
                    content = await this.composerViewProvider.getContent();
                    break;
                case 'suggestions':
                    console.log('MainViewProvider: Getting suggestions content');
                    content = await this.suggestionViewProvider.getContent();
                    break;
                case 'rules':
                    console.log('MainViewProvider: Getting rules content');
                    content = await this.rulesViewProvider.getContent();
                    break;
                case 'settings':
                    console.log('MainViewProvider: Getting settings content');
                    content = this._getSettingsContent();
                    break;
            }

            console.log(`MainViewProvider: Content length: ${content.length}`);
            console.log('MainViewProvider: Content:', content.substring(0, 200)); // İlk 200 karakteri göster

            // Update tab content
            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId,
                content
            });

            console.log('MainViewProvider: Posted message to webview');
        } catch (error) {
            console.error(`MainViewProvider: Error switching to tab ${tabId}:`, error);
            vscode.window.showErrorMessage(`Failed to load ${tabId} content`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get resource URIs
        const mainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        console.log('MainViewProvider: Resource URIs:', {
            mainUri: mainUri.toString(),
            styleUri: styleUri.toString(),
            codiconsUri: codiconsUri.toString()
        });

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
                <link rel="stylesheet" href="${styleUri}">
                <link rel="stylesheet" href="${codiconsUri}">
                <title>Smile AI</title>
            </head>
            <body>
                <div class="tab-container">
                    <div class="tab-buttons">
                        <button class="tab-button active" data-tab="chat">
                            <i class="codicon codicon-comment-discussion"></i>
                            Chat
                        </button>
                        <button class="tab-button" data-tab="composer">
                            <i class="codicon codicon-edit"></i>
                            Composer
                        </button>
                        <button class="tab-button" data-tab="suggestions">
                            <i class="codicon codicon-lightbulb"></i>
                            Suggestions
                        </button>
                        <button class="tab-button" data-tab="rules">
                            <i class="codicon codicon-book"></i>
                            Rules
                        </button>
                        <button class="tab-button" data-tab="settings">
                            <i class="codicon codicon-gear"></i>
                            Settings
                        </button>
                    </div>
                    <div class="tab-content">
                        <div id="chat" class="tab-pane active">
                            Loading chat...
                        </div>
                        <div id="composer" class="tab-pane">
                            Loading composer...
                        </div>
                        <div id="suggestions" class="tab-pane">
                            Loading suggestions...
                        </div>
                        <div id="rules" class="tab-pane">
                            Loading rules...
                        </div>
                        <div id="settings" class="tab-pane">
                            Loading settings...
                        </div>
                    </div>
                </div>
                <script src="${mainUri}"></script>
            </body>
            </html>
        `;
    }

    private _getSettingsContent(): string {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const currentProvider = config.get<ModelProvider>('aiProvider', 'ollama');
        const temperature = config.get('temperature', 0.7);
        const maxTokens = config.get('maxTokens', 2048);

        return `
            <div class="settings-container">
                <div class="setting-group">
                    <h3>Model Settings</h3>
                    <div class="setting-item">
                        <label for="modelProvider">AI Provider</label>
                        <select id="modelProvider" onchange="updateSetting('aiProvider', this.value)" value="${currentProvider}">
                            <option value="ollama" ${currentProvider === 'ollama' ? 'selected' : ''}>Ollama</option>
                            <option value="llamacpp" ${currentProvider === 'llamacpp' ? 'selected' : ''}>LlamaCpp</option>
                            <option value="openai" ${currentProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
                            <option value="anthropic" ${currentProvider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
                        </select>
                    </div>
                    <div id="modelSettings">
                        ${this._getProviderSpecificSettings(currentProvider)}
                    </div>
                </div>
                
                <div class="setting-group">
                    <h3>General Settings</h3>
                    <div class="setting-item">
                        <label for="temperature">Temperature</label>
                        <input type="range" id="temperature" 
                            min="0" max="1" step="0.1" 
                            value="${temperature}"
                            oninput="updateSetting('temperature', this.value); document.getElementById('temperatureValue').textContent = this.value;">
                        <span id="temperatureValue">${temperature}</span>
                    </div>
                    <div class="setting-item">
                        <label for="maxTokens">Max Tokens</label>
                        <input type="number" id="maxTokens" 
                            value="${maxTokens}" 
                            min="1" max="8192"
                            onchange="updateSetting('maxTokens', this.value)">
                    </div>
                </div>
                <script>
                    function updateSetting(key, value) {
                        vscode.postMessage({
                            type: 'updateSetting',
                            key: key,
                            value: value
                        });
                        
                        if (key === 'aiProvider') {
                            // Update provider specific settings
                            vscode.postMessage({
                                type: 'getProviderSettings',
                                provider: value
                            });
                        }
                    }
                </script>
            </div>
        `;
    }

    private _getProviderSpecificSettings(provider: ModelProvider): string {
        const config = vscode.workspace.getConfiguration('smile-ai');
        
        switch (provider) {
            case 'openai':
                const apiKey = config.get('openai.apiKey', '');
                const model = config.get<OpenAIModel>('openai.model', 'gpt-4');
                return `
                    <div class="provider-settings">
                        <div class="setting-item">
                            <label for="openaiApiKey">API Key</label>
                            <input type="password" id="openaiApiKey" 
                                value="${apiKey}"
                                onchange="updateSetting('openai.apiKey', this.value)">
                        </div>
                        <div class="setting-item">
                            <label for="openaiModel">Model</label>
                            <select id="openaiModel" 
                                onchange="updateSetting('openai.model', this.value)"
                                value="${model}">
                                <option value="gpt-4" ${model === 'gpt-4' ? 'selected' : ''}>GPT-4</option>
                                <option value="gpt-3.5-turbo" ${model === 'gpt-3.5-turbo' ? 'selected' : ''}>GPT-3.5 Turbo</option>
                            </select>
                        </div>
                    </div>
                `;
            case 'anthropic':
                const anthropicKey = config.get('anthropic.apiKey', '');
                const anthropicModel = config.get<AnthropicModel>('anthropic.model', 'claude-3-opus-20240229');
                return `
                    <div class="provider-settings">
                        <div class="setting-item">
                            <label for="anthropicApiKey">API Key</label>
                            <input type="password" id="anthropicApiKey" 
                                value="${anthropicKey}"
                                onchange="updateSetting('anthropic.apiKey', this.value)">
                        </div>
                        <div class="setting-item">
                            <label for="anthropicModel">Model</label>
                            <select id="anthropicModel" 
                                onchange="updateSetting('anthropic.model', this.value)"
                                value="${anthropicModel}">
                                <option value="claude-3-opus-20240229" ${anthropicModel === 'claude-3-opus-20240229' ? 'selected' : ''}>Claude 3 Opus</option>
                                <option value="claude-3-sonnet-20240229" ${anthropicModel === 'claude-3-sonnet-20240229' ? 'selected' : ''}>Claude 3 Sonnet</option>
                                <option value="claude-2.1" ${anthropicModel === 'claude-2.1' ? 'selected' : ''}>Claude 2.1</option>
                            </select>
                        </div>
                    </div>
                `;
            case 'ollama':
                const ollamaEndpoint = config.get('ollama.endpoint', 'http://localhost:11434');
                const ollamaModel = config.get('ollama.model', 'llama2');
                return `
                    <div class="provider-settings">
                        <div class="setting-item">
                            <label for="ollamaEndpoint">Endpoint</label>
                            <input type="text" id="ollamaEndpoint" 
                                value="${ollamaEndpoint}"
                                onchange="updateSetting('ollama.endpoint', this.value)">
                        </div>
                        <div class="setting-item">
                            <label for="ollamaModel">Model</label>
                            <input type="text" id="ollamaModel" 
                                value="${ollamaModel}"
                                onchange="updateSetting('ollama.model', this.value)">
                        </div>
                    </div>
                `;
            default:
                return '';
        }
    }

    private async updateSetting(key: string, value: any) {
        try {   
            const config = vscode.workspace.getConfiguration('smile-ai');
            await config.update(key, value, vscode.ConfigurationTarget.Global);
            
            // If the AI provider changed, restart the relevant service
            if (key === 'aiProvider') {
                // TODO: Restart the AI service
                vscode.window.showInformationMessage(`AI Provider changed to ${value}`);
            }

            
            console.log(`Setting updated successfully: ${key} = ${value}`);
        } catch (error) {
            console.error('Error updating setting:', error);
            vscode.window.showErrorMessage(`Failed to update setting: ${key}`);
        }
    }
} 