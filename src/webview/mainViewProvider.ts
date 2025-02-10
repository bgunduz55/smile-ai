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
            enableCommandUris: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'dist', 'media'),
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
            try {
                switch (message.type) {
                    case 'switchTab':
                        console.log('MainViewProvider: Tab change request:', message.tab);
                        await this.switchTab(message.tab);
                        break;
                    case 'updateSetting':
                        console.log('MainViewProvider: Setting update request:', message.key, message.value);
                        await this.updateSetting(message.key, message.value);
                        break;
                    case 'refreshOllamaModels':
                        console.log('MainViewProvider: Refreshing Ollama models');
                        await this.refreshOllamaModels();
                        break;
                    case 'sendMessage':
                        console.log('MainViewProvider: Sending message:', message.message);
                        await this.chatViewProvider.handleMessage(message);
                        break;
                    default:
                        console.log('MainViewProvider: Unknown message type:', message.type);
                        break;
                }
            } catch (error) {
                console.error('MainViewProvider: Error handling message:', error);
                vscode.window.showErrorMessage('Error handling message: ' + (error instanceof Error ? error.message : 'Unknown error'));
            }
        });

        // Load initial content
        console.log('MainViewProvider: Loading initial content');
        this.loadInitialContent();
    }

    private async loadInitialContent() {
        try {
            if (!this._view) {
                console.error('MainViewProvider: View is not initialized');
                return;
            }

            console.log('MainViewProvider: Loading chat content');
            const chatContent = await this.chatViewProvider.getContent();
            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId: 'chat',
                content: chatContent
            });

            console.log('MainViewProvider: Loading composer content');
            const composerContent = await this.composerViewProvider.getContent();
            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId: 'composer',
                content: composerContent
            });

            console.log('MainViewProvider: Loading suggestions content');
            const suggestionsContent = await this.suggestionViewProvider.getContent();
            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId: 'suggestions',
                content: suggestionsContent
            });

            console.log('MainViewProvider: Loading rules content');
            const rulesContent = await this.rulesViewProvider.getContent();
            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId: 'rules',
                content: rulesContent
            });

            console.log('MainViewProvider: Loading settings content');
            const settingsContent = this._getSettingsContent();
            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId: 'settings',
                content: settingsContent
            });

            // Switch to initial tab
            console.log('MainViewProvider: Switching to initial tab');
            await this.switchTab('chat');
        } catch (error) {
            console.error('MainViewProvider: Error loading initial content:', error);
            vscode.window.showErrorMessage('Failed to load initial content: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    public async switchTab(tabId: string) {
        console.log(`MainViewProvider: switchTab called with tabId: ${tabId}`);
        if (!this._view) {
            console.error('MainViewProvider: View is not initialized');
            return;
        }

        try {
            this.currentTab = tabId;
            let content = '';

            console.log(`MainViewProvider: Getting content for tab: ${tabId}`);
            switch (tabId) {
                case 'chat':
                    content = await this.chatViewProvider.getContent();
                    break;
                case 'composer':
                    content = await this.composerViewProvider.getContent();
                    break;
                case 'suggestions':
                    content = await this.suggestionViewProvider.getContent();
                    break;
                case 'rules':
                    content = await this.rulesViewProvider.getContent();
                    break;
                case 'settings':
                    content = this._getSettingsContent();
                    break;
                default:
                    console.error('MainViewProvider: Unknown tab:', tabId);
                    return;
            }

            console.log(`MainViewProvider: Content length: ${content.length}`);
            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId,
                content
            });
            console.log('MainViewProvider: Tab content updated');

        } catch (error) {
            console.error(`MainViewProvider: Error switching to tab ${tabId}:`, error);
            vscode.window.showErrorMessage(`Failed to load ${tabId} content: ` + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const mainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'codicon.css'));

        console.log('MainViewProvider: Resource URIs:', { mainUri, styleUri, codiconsUri });

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource}; font-src ${webview.cspSource};">
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
                            <div class="loading">Loading chat...</div>
                        </div>
                        <div id="composer" class="tab-pane">
                            <div class="loading">Loading composer...</div>
                        </div>
                        <div id="suggestions" class="tab-pane">
                            <div class="loading">Loading suggestions...</div>
                        </div>
                        <div id="rules" class="tab-pane">
                            <div class="loading">Loading rules...</div>
                        </div>
                        <div id="settings" class="tab-pane">
                            <div class="loading">Loading settings...</div>
                        </div>
                    </div>
                </div>
                <script src="${mainUri}"></script>
            </body>
            </html>
        `;
    }

    private _getSettingsContent(): string {
        try {
            const config = vscode.workspace.getConfiguration('smile-ai');
            const currentProvider = config.get<ModelProvider>('aiProvider', 'ollama');
            const temperature = config.get('temperature', 0.7);
            const maxTokens = config.get('maxTokens', 2048);

            // OpenAI model kontrolü
            const openaiModel = config.get<string>('openai.model', '');
            const openaiCustomModel = typeof openaiModel === 'string' && openaiModel.startsWith('gpt-') ? openaiModel : '';

            // Anthropic model kontrolü
            const anthropicModel = config.get<string>('anthropic.model', '');
            const anthropicCustomModel = typeof anthropicModel === 'string' && anthropicModel.startsWith('claude-') ? anthropicModel : '';

            return `
                <div class="settings-container">
                    <div class="setting-group">
                        <h3>AI Providers</h3>
                        <div class="provider-list">
                            <div class="provider-item ${currentProvider === 'ollama' ? 'active' : ''}" 
                                 onclick="updateSetting('aiProvider', 'ollama')">
                                <div class="provider-header">
                                    <h4>Ollama</h4>
                                    <span class="provider-badge ${currentProvider === 'ollama' ? 'active' : ''}">
                                        ${currentProvider === 'ollama' ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <p>Local AI models with Ollama</p>
                                <div class="provider-settings ${currentProvider === 'ollama' ? 'show' : ''}">
                                    <div class="setting-item">
                                        <label for="ollamaEndpoint">Endpoint</label>
                                        <input type="text" id="ollamaEndpoint" 
                                            value="${config.get('ollama.endpoint', 'http://localhost:11434')}"
                                            onchange="updateSetting('ollama.endpoint', this.value)">
                                    </div>
                                    <div class="setting-item">
                                        <label>Installed Models</label>
                                        <div class="model-list" id="ollamaModelList">
                                            <div class="loading-models">Loading installed models...</div>
                                        </div>
                                        <div class="setting-item">
                                            <label for="ollamaCustomModel">Pull New Model</label>
                                            <div class="custom-model-input">
                                                <input type="text" id="ollamaCustomModel" 
                                                    placeholder="Enter model name (e.g. llama2:latest)"
                                                    onchange="updateSetting('ollama.customModel', this.value)">
                                                <button onclick="pullOllamaModel(document.getElementById('ollamaCustomModel').value)">
                                                    Pull Model
                                                </button>
                                            </div>
                                        </div>
                                        <button onclick="refreshOllamaModels()" class="refresh-button">
                                            <i class="codicon codicon-refresh"></i>
                                            Refresh Models
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div class="provider-item ${currentProvider === 'openai' ? 'active' : ''}"
                                 onclick="updateSetting('aiProvider', 'openai')">
                                <div class="provider-header">
                                    <h4>OpenAI</h4>
                                    <span class="provider-badge ${currentProvider === 'openai' ? 'active' : ''}">
                                        ${currentProvider === 'openai' ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <p>GPT-4 and other OpenAI models</p>
                                <div class="provider-settings ${currentProvider === 'openai' ? 'show' : ''}">
                                    <div class="setting-item">
                                        <label for="openaiApiKey">API Key</label>
                                        <input type="password" id="openaiApiKey" 
                                            value="${config.get('openai.apiKey', '')}"
                                            onchange="updateSetting('openai.apiKey', this.value)">
                                    </div>
                                    <div class="setting-item">
                                        <label>Models</label>
                                        <div class="model-list">
                                            <div class="model-item">
                                                <input type="checkbox" id="gpt4" 
                                                    ${openaiModel === 'gpt-4' ? 'checked' : ''}
                                                    onchange="updateSetting('openai.model', 'gpt-4')">
                                                <label for="gpt4">
                                                    GPT-4
                                                    <span class="model-details">Latest GPT-4 model</span>
                                                </label>
                                            </div>
                                            <div class="model-item">
                                                <input type="checkbox" id="gpt35" 
                                                    ${openaiModel === 'gpt-3.5-turbo' ? 'checked' : ''}
                                                    onchange="updateSetting('openai.model', 'gpt-3.5-turbo')">
                                                <label for="gpt35">
                                                    GPT-3.5 Turbo
                                                    <span class="model-details">Latest GPT-3.5 model</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div class="setting-item">
                                            <label for="openaiCustomModel">Custom Model</label>
                                            <div class="custom-model-input">
                                                <input type="text" id="openaiCustomModel" 
                                                    placeholder="Enter custom model name (e.g. gpt-4-0125-preview)"
                                                    value="${openaiCustomModel}"
                                                    onchange="updateSetting('openai.model', this.value)">
                                                <button onclick="addCustomModel('openai', document.getElementById('openaiCustomModel').value)">
                                                    Add Model
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="provider-item ${currentProvider === 'anthropic' ? 'active' : ''}"
                                 onclick="updateSetting('aiProvider', 'anthropic')">
                                <div class="provider-header">
                                    <h4>Anthropic</h4>
                                    <span class="provider-badge ${currentProvider === 'anthropic' ? 'active' : ''}">
                                        ${currentProvider === 'anthropic' ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <p>Claude and other Anthropic models</p>
                                <div class="provider-settings ${currentProvider === 'anthropic' ? 'show' : ''}">
                                    <div class="setting-item">
                                        <label for="anthropicApiKey">API Key</label>
                                        <input type="password" id="anthropicApiKey" 
                                            value="${config.get('anthropic.apiKey', '')}"
                                            onchange="updateSetting('anthropic.apiKey', this.value)">
                                    </div>
                                    <div class="setting-item">
                                        <label>Models</label>
                                        <div class="model-list">
                                            <div class="model-item">
                                                <input type="checkbox" id="claude3opus" 
                                                    ${anthropicModel === 'claude-3-opus-20240229' ? 'checked' : ''}
                                                    onchange="updateSetting('anthropic.model', 'claude-3-opus-20240229')">
                                                <label for="claude3opus">
                                                    Claude 3 Opus
                                                    <span class="model-details">Most capable Claude model</span>
                                                </label>
                                            </div>
                                            <div class="model-item">
                                                <input type="checkbox" id="claude3sonnet" 
                                                    ${anthropicModel === 'claude-3-sonnet-20240229' ? 'checked' : ''}
                                                    onchange="updateSetting('anthropic.model', 'claude-3-sonnet-20240229')">
                                                <label for="claude3sonnet">
                                                    Claude 3 Sonnet
                                                    <span class="model-details">Balanced performance and speed</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div class="setting-item">
                                            <label for="anthropicCustomModel">Custom Model</label>
                                            <div class="custom-model-input">
                                                <input type="text" id="anthropicCustomModel" 
                                                    placeholder="Enter custom model name (e.g. claude-3-haiku-20240229)"
                                                    value="${anthropicCustomModel}"
                                                    onchange="updateSetting('anthropic.model', this.value)">
                                                <button onclick="addCustomModel('anthropic', document.getElementById('anthropicCustomModel').value)">
                                                    Add Model
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="setting-group">
                        <h3>Model Parameters</h3>
                        <div class="setting-item">
                            <label for="temperature">Temperature</label>
                            <div class="slider-container">
                                <input type="range" id="temperature" 
                                    min="0" max="1" step="0.1" 
                                    value="${temperature}"
                                    oninput="updateSetting('temperature', this.value); document.getElementById('temperatureValue').textContent = this.value;">
                                <span id="temperatureValue">${temperature}</span>
                            </div>
                            <p class="setting-description">Controls randomness in responses. Higher values make output more creative but less predictable.</p>
                        </div>
                        <div class="setting-item">
                            <label for="maxTokens">Max Tokens</label>
                            <input type="number" id="maxTokens" 
                                value="${maxTokens}" 
                                min="1" max="8192"
                                onchange="updateSetting('maxTokens', this.value)">
                            <p class="setting-description">Maximum number of tokens to generate in responses.</p>
                        </div>
                    </div>
                </div>
                <style>
                    .provider-list {
                        display: flex;
                        flex-direction: column;
                        gap: 16px;
                    }
                    .provider-item {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 6px;
                        padding: 16px;
                        cursor: pointer;
                    }
                    .provider-item.active {
                        border-color: var(--vscode-focusBorder);
                        background-color: var(--vscode-editor-selectionBackground);
                    }
                    .provider-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 8px;
                    }
                    .provider-badge {
                        font-size: 12px;
                        padding: 2px 8px;
                        border-radius: 12px;
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                    }
                    .provider-badge.active {
                        background-color: var(--vscode-statusBarItem-prominentBackground);
                    }
                    .provider-settings {
                        display: none;
                        margin-top: 16px;
                        padding-top: 16px;
                        border-top: 1px solid var(--vscode-panel-border);
                    }
                    .provider-settings.show {
                        display: block;
                    }
                    .model-list {
                        margin: 8px 0;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }
                    .model-item {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .setting-description {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        margin-top: 4px;
                    }
                    .slider-container {
                        display: flex;
                        align-items: center;
                        gap: 16px;
                    }
                    .refresh-button {
                        margin-top: 8px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    }
                    .custom-model-input {
                        display: flex;
                        gap: 8px;
                        margin-top: 4px;
                    }
                    .custom-model-input input {
                        flex: 1;
                    }
                    .custom-model-input button {
                        white-space: nowrap;
                    }
                </style>
                <script>
                    // Sayfa yüklendiğinde Ollama modellerini getir
                    setTimeout(() => {
                        console.log('Refreshing Ollama models...');
                        vscode.postMessage({
                            type: 'refreshOllamaModels'
                        });
                    }, 500);

                    // Provider seçimi için event listener'lar
                    document.querySelectorAll('.provider-item').forEach(item => {
                        item.addEventListener('click', (e) => {
                            if (e.target.tagName === 'INPUT') return; // Input elemanlarını engelleme
                            
                            document.querySelectorAll('.provider-item').forEach(p => {
                                p.classList.remove('active');
                                p.querySelector('.provider-settings').classList.remove('show');
                            });
                            
                            item.classList.add('active');
                            item.querySelector('.provider-settings').classList.add('show');
                        });
                    });
                </script>
            `;
        } catch (error) {
            console.error('Error generating settings content:', error);
            return `
                <div class="error-message">
                    <h3>Error Loading Settings</h3>
                    <p>An error occurred while loading settings. Please try refreshing the view.</p>
                    <pre>${error instanceof Error ? error.message : 'Unknown error'}</pre>
                </div>
            `;
        }
    }

    private _getProviderSpecificSettings(provider: ModelProvider): string {
        const config = vscode.workspace.getConfiguration('smile-ai');
        
        switch (provider) {
            case 'openai':
                const apiKey = config.get('openai.apiKey', '');
                const model = config.get<OpenAIModel>('openai.model', 'gpt-4');
                const customModel = typeof model === 'string' && model.startsWith('gpt-') ? model : '';
                const openaiConfig = config.get('openai') as { model?: string } || {};
                return `
                    <div class="provider-settings">
                        <div class="setting-item">
                            <label for="openaiApiKey">API Key</label>
                            <input type="password" id="openaiApiKey" 
                                value="${apiKey}"
                                onchange="updateSetting('openai.apiKey', this.value)">
                        </div>
                        <div class="setting-item">
                            <label>Models</label>
                            <div class="model-list">
                                <div class="model-item">
                                    <input type="checkbox" id="gpt4" 
                                        ${openaiConfig.model === 'gpt-4' ? 'checked' : ''}
                                        onchange="updateSetting('openai.model', 'gpt-4')">
                                    <label for="gpt4">
                                        GPT-4
                                        <span class="model-details">Latest GPT-4 model</span>
                                    </label>
                                </div>
                                <div class="model-item">
                                    <input type="checkbox" id="gpt35" 
                                        ${openaiConfig.model === 'gpt-3.5-turbo' ? 'checked' : ''}
                                        onchange="updateSetting('openai.model', 'gpt-3.5-turbo')">
                                    <label for="gpt35">
                                        GPT-3.5 Turbo
                                        <span class="model-details">Latest GPT-3.5 model</span>
                                    </label>
                                </div>
                            </div>
                            <div class="setting-item">
                                <label for="openaiCustomModel">Custom Model</label>
                                <div class="custom-model-input">
                                    <input type="text" id="openaiCustomModel" 
                                        placeholder="Enter custom model name (e.g. gpt-4-0125-preview)"
                                        value="${customModel}"
                                        onchange="updateSetting('openai.model', this.value)">
                                    <button onclick="addCustomModel('openai', document.getElementById('openaiCustomModel').value)">
                                        Add Model
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            case 'anthropic':
                const anthropicKey = config.get('anthropic.apiKey', '');
                const anthropicModel = config.get<AnthropicModel>('anthropic.model', 'claude-3-opus-20240229');
                const customAnthropicModel = typeof anthropicModel === 'string' && anthropicModel.startsWith('claude-') ? anthropicModel : '';
                const anthropicConfig = config.get('anthropic') as { model?: string } || {};
                return `
                    <div class="provider-settings">
                        <div class="setting-item">
                            <label for="anthropicApiKey">API Key</label>
                            <input type="password" id="anthropicApiKey" 
                                value="${anthropicKey}"
                                onchange="updateSetting('anthropic.apiKey', this.value)">
                        </div>
                        <div class="setting-item">
                            <label>Models</label>
                            <div class="model-list">
                                <div class="model-item">
                                    <input type="checkbox" id="claude3opus" 
                                        ${anthropicConfig.model === 'claude-3-opus-20240229' ? 'checked' : ''}
                                        onchange="updateSetting('anthropic.model', 'claude-3-opus-20240229')">
                                    <label for="claude3opus">
                                        Claude 3 Opus
                                        <span class="model-details">Most capable Claude model</span>
                                    </label>
                                </div>
                                <div class="model-item">
                                    <input type="checkbox" id="claude3sonnet" 
                                        ${anthropicConfig.model === 'claude-3-sonnet-20240229' ? 'checked' : ''}
                                        onchange="updateSetting('anthropic.model', 'claude-3-sonnet-20240229')">
                                    <label for="claude3sonnet">
                                        Claude 3 Sonnet
                                        <span class="model-details">Balanced performance and speed</span>
                                    </label>
                                </div>
                            </div>
                            <div class="setting-item">
                                <label for="anthropicCustomModel">Custom Model</label>
                                <div class="custom-model-input">
                                    <input type="text" id="anthropicCustomModel" 
                                        placeholder="Enter custom model name (e.g. claude-3-haiku-20240229)"
                                        value="${customAnthropicModel}"
                                        onchange="updateSetting('anthropic.model', this.value)">
                                    <button onclick="addCustomModel('anthropic', document.getElementById('anthropicCustomModel').value)">
                                        Add Model
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            case 'ollama':
                const ollamaEndpoint = config.get('ollama.endpoint', 'http://localhost:11434');
                const ollamaModel = config.get('ollama.model', '');
                return `
                    <div class="provider-settings">
                        <div class="setting-item">
                            <label for="ollamaEndpoint">Endpoint</label>
                            <input type="text" id="ollamaEndpoint" 
                                value="${ollamaEndpoint}"
                                onchange="updateSetting('ollama.endpoint', this.value)">
                        </div>
                        <div class="setting-item">
                            <label>Installed Models</label>
                            <div class="model-list" id="ollamaModelList">
                                <div class="loading-models">Loading installed models...</div>
                            </div>
                            <div class="setting-item">
                                <label for="ollamaCustomModel">Pull New Model</label>
                                <div class="custom-model-input">
                                    <input type="text" id="ollamaCustomModel" 
                                        placeholder="Enter model name (e.g. llama2:latest)"
                                        onchange="updateSetting('ollama.customModel', this.value)">
                                    <button onclick="pullOllamaModel(document.getElementById('ollamaCustomModel').value)">
                                        Pull Model
                                    </button>
                                </div>
                            </div>
                            <button onclick="refreshOllamaModels()" class="refresh-button">
                                <i class="codicon codicon-refresh"></i>
                                Refresh Models
                            </button>
                        </div>
                    </div>
                `;
            default:
                return '';
        }
    }

    private async updateSetting(key: string, value: any) {
        try {   
            console.log(`Updating setting: ${key} = ${value}`);
            const config = vscode.workspace.getConfiguration('smile-ai');
            await config.update(key, value, vscode.ConfigurationTarget.Global);
            
            // Eğer Ollama endpoint'i değiştiyse modelleri yeniden getir
            if (key === 'ollama.endpoint') {
                await this.refreshOllamaModels();
            }
            
            // Ayarları kaydettiğimizi bildirelim
            vscode.window.showInformationMessage(`Ayar güncellendi: ${key}`);
            
            // Eğer model değiştiyse tüm view'ları güncelle
            if (key.endsWith('.model')) {
                await this.updateAllViews();
            }
            
        } catch (error) {
            console.error('Error updating setting:', error);
            vscode.window.showErrorMessage(`Failed to update setting: ${key}`);
        }
    }

    private async updateAllViews() {
        if (this._view) {
            const chatContent = await this.chatViewProvider.getContent();
            const composerContent = await this.composerViewProvider.getContent();
            const settingsContent = this._getSettingsContent();

            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId: 'chat',
                content: chatContent
            });

            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId: 'composer',
                content: composerContent
            });

            await this._view.webview.postMessage({
                type: 'updateTabContent',
                tabId: 'settings',
                content: settingsContent
            });
        }
    }

    private async refreshOllamaModels() {
        try {
            const config = vscode.workspace.getConfiguration('smile-ai');
            const endpoint = config.get('ollama.endpoint', 'http://localhost:11434');
            
            console.log('Fetching Ollama models from:', endpoint);
            
            const response = await fetch(`${endpoint}/api/tags`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json() as { models: Array<{ name: string, details: any }> };
            const models = data.models || [];
            
            console.log('Fetched models:', models);
            
            if (this._view) {
                await this._view.webview.postMessage({
                    type: 'ollamaModelsLoaded',
                    models: models.map(model => ({
                        name: model.name,
                        details: model.details || {}
                    }))
                });

                // Mevcut seçili modeli güncelle
                const currentModel = config.get('ollama.model');
                if (!currentModel && models.length > 0) {
                    await this.updateSetting('ollama.model', models[0].name);
                }

                // Settings içeriğini yeniden yükle
                const settingsContent = this._getSettingsContent();
                await this._view.webview.postMessage({
                    type: 'updateTabContent',
                    tabId: 'settings',
                    content: settingsContent
                });
            }
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
            vscode.window.showErrorMessage('Ollama modellerini getirirken hata oluştu. Endpoint\'i kontrol edin.');
        }
    }

    private async _handleMessage(message: any) {
        console.log('MainViewProvider: Received message:', message);

        switch (message.type) {
            case 'switchTab':
                console.log('MainViewProvider: Switching to tab:', message.tab);
                await this._loadTabContent(message.tab);
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
    }

    private async _loadTabContent(tabId: string) {
        console.log('MainViewProvider: Loading content for tab:', tabId);
        
        try {
            let content = '';
            
            switch (tabId) {
                case 'chat':
                    content = await this._getChatContent();
                    break;
                case 'composer':
                    content = await this._getComposerContent();
                    break;
                case 'suggestions':
                    content = await this._getSuggestionsContent();
                    break;
                case 'rules':
                    content = await this._getRulesContent();
                    break;
                case 'settings':
                    content = await this._getSettingsContent();
                    break;
                default:
                    console.error('MainViewProvider: Unknown tab:', tabId);
                    return;
            }

            if (this._view) {
                console.log('MainViewProvider: Sending tab content update');
                this._view.webview.postMessage({
                    type: 'updateTabContent',
                    tabId,
                    content
                });
            }
        } catch (error) {
            console.error('MainViewProvider: Error loading tab content:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'showError',
                    error: 'Failed to load tab content. Please try again.'
                });
            }
        }
    }

    private async _getChatContent(): Promise<string> {
        return `
            <div id="chatMessages" class="chat-messages"></div>
            <div class="chat-input-container">
                <textarea id="chatInput" placeholder="Type your message..."></textarea>
                <button id="sendMessage">
                    <i class="codicon codicon-send"></i>
                </button>
            </div>
            <div id="loading" class="loading" style="display: none;">
                Processing your request...
            </div>
        `;
    }

    private async _getComposerContent(): Promise<string> {
        return `
            <div id="composerContent" class="composer-content"></div>
            <div class="composer-input-container">
                <textarea id="composerInput" placeholder="Type your message..."></textarea>
                <button id="sendComposerMessage">
                    <i class="codicon codicon-send"></i>
                </button>
            </div>
            <div id="loading" class="loading" style="display: none;">
                Processing your request...
            </div>
        `;
    }

    private async _getSuggestionsContent(): Promise<string> {
        return `
            <div id="suggestionsContent" class="suggestions-content"></div>
            <div class="suggestions-input-container">
                <textarea id="suggestionsInput" placeholder="Type your message..."></textarea>
                <button id="sendSuggestionsMessage">
                    <i class="codicon codicon-send"></i>
                </button>
            </div>
            <div id="loading" class="loading" style="display: none;">
                Processing your request...
            </div>
        `;
    }

    private async _getRulesContent(): Promise<string> {
        return `
            <div id="rulesContent" class="rules-content"></div>
            <div class="rules-input-container">
                <textarea id="rulesInput" placeholder="Type your message..."></textarea>
                <button id="sendRulesMessage">
                    <i class="codicon codicon-send"></i>
                </button>
            </div>
            <div id="loading" class="loading" style="display: none;">
                Processing your request...
            </div>
        `;
    }
}