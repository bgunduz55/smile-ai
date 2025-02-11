import * as vscode from 'vscode';
import { ChatViewProvider } from './chatViewProvider';
import { ComposerViewProvider } from './composerViewProvider';
import { SuggestionViewProvider } from './suggestionViewProvider';
import { RulesViewProvider } from './rulesViewProvider';
import { SettingsViewProvider } from './settingsViewProvider';

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
    private settingsViewProvider: SettingsViewProvider;
    private currentTab: string = 'chat';

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {
        console.log('MainViewProvider: Constructor called');
        this.chatViewProvider = new ChatViewProvider(_extensionUri);
        this.composerViewProvider = new ComposerViewProvider(_extensionUri);
        this.suggestionViewProvider = new SuggestionViewProvider(_extensionUri);
        this.rulesViewProvider = new RulesViewProvider(_extensionUri);
        this.settingsViewProvider = new SettingsViewProvider(_extensionUri);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
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
        this.settingsViewProvider.setWebview(webviewView);

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
                    case 'pullOllamaModel':
                        console.log('MainViewProvider: Pulling Ollama model:', message.model);
                        await this.pullOllamaModel(message.model);
                        break;
                    case 'addCustomModel':
                        console.log('MainViewProvider: Adding custom model:', message.provider, message.model);
                        await this.addCustomModel(message.provider, message.model);
                        break;
                    case 'sendMessage':
                        console.log('MainViewProvider: Sending message:', message.message);
                        await this.chatViewProvider.handleMessage(message);
                        break;
                    case 'composerOperation':
                        await this.composerViewProvider.handleOperation(message.operation);
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

            // Get current model settings
            const config = vscode.workspace.getConfiguration('smile-ai');
            const currentProvider = config.get<ModelProvider>('aiProvider', 'ollama');
            const currentModel = config.get(`${currentProvider}.model`, '');

            console.log('MainViewProvider: Loading chat content');
            const chatContent = `
                <div class="chat-container">
                    <div class="header">
                        <div class="model-selector">
                            <label>Active Model:</label>
                            <div class="active-model">
                                <span class="provider-badge">${currentProvider}</span>
                                <span class="model-name">${currentModel || 'Model not selected'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="messages" id="chatMessages">
                        <div class="chat-welcome">
                            <h3>Start a Chat</h3>
                            <p>Your AI assistant is ready to help.</p>
                            <div class="model-info">
                                <p>Currently using:</p>
                                <div class="active-model">
                                    <span class="provider-badge">${currentProvider}</span>
                                    <span class="model-name">${currentModel || 'No model selected'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="input-container">
                        <textarea class="message-input" placeholder="Type your message..."></textarea>
                        <button class="send-button" ${!currentModel ? 'disabled' : ''}>
                            <i class="codicon codicon-send"></i>
                            Send
                        </button>
                    </div>
                </div>
            `;
            await this._view.webview.postMessage({
                type: 'updateContent',
                content: chatContent
            });

            console.log('MainViewProvider: Loading composer content');
            const composerContent = `
                <div class="composer-container">
                    <div class="header">
                        <div class="model-selector">
                            <label>Active Model:</label>
                            <div class="active-model">
                                <span class="provider-badge">${currentProvider}</span>
                                <span class="model-name">${currentModel || 'Model not selected'}</span>
                            </div>
                            <select class="model-select" onchange="updateSetting('${currentProvider}.model', this.value)">
                                ${await this.getModelOptionsForProvider(currentProvider)}
                            </select>
                        </div>
                    </div>
                    <div class="messages"></div>
                    <div class="input-container">
                        <textarea class="message-input" placeholder="Enter text to enhance..."></textarea>
                        <button class="send-button">
                            <i class="codicon codicon-send"></i>
                        </button>
                    </div>
                </div>
            `;
            await this._view.webview.postMessage({
                type: 'updateContent',
                content: composerContent
            });

            // Load settings content
            console.log('MainViewProvider: Loading settings content');
            const settingsContent = await this._getSettingsContent();
            await this._view.webview.postMessage({
                type: 'updateContent',
                content: settingsContent
            });

            // Switch to initial tab
            console.log('MainViewProvider: Switching to initial tab');
            await this.switchTab('chat');

            // Load models for chat and composer views
            await this.refreshOllamaModels();
        } catch (error) {
            console.error('MainViewProvider: Error loading initial content:', error);
            vscode.window.showErrorMessage('Failed to load initial content: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    private async getModelOptionsForProvider(provider: ModelProvider): Promise<string> {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const currentModel = config.get(`${provider}.model`, '') as string;

        switch (provider) {
            case 'ollama':
                const ollamaModels = config.get<string[]>('ollama.models', []);
                return ollamaModels.map(model => `
                    <option value="${model}" ${model === currentModel ? 'selected' : ''}>
                        ${model}
                    </option>
                `).join('');

            case 'openai':
                const openaiModels = ['gpt-4', 'gpt-3.5-turbo'] as const;
                return openaiModels.map(model => `
                    <option value="${model}" ${model === currentModel ? 'selected' : ''}>
                        ${model === 'gpt-4' ? 'GPT-4' : 'GPT-3.5 Turbo'}
                    </option>
                `).join('');

            case 'anthropic':
                const anthropicModels = ['claude-3-opus-20240229', 'claude-3-sonnet-20240229'] as const;
                return anthropicModels.map(model => `
                    <option value="${model}" ${model === currentModel ? 'selected' : ''}>
                        ${model.includes('opus') ? 'Claude 3 Opus' : 'Claude 3 Sonnet'}
                    </option>
                `).join('');

            default:
                return '<option value="">No models available</option>';
        }
    }

    private _getSettingsContent(): string {
        try {
            const config = vscode.workspace.getConfiguration('smile-ai');
            const currentProvider = config.get<ModelProvider>('aiProvider', 'ollama');
            const temperature = config.get('temperature', 0.7);
            const maxTokens = config.get('maxTokens', 2048);
            const currentModel = config.get(`${currentProvider}.model`, '');

            return `
                <div class="settings-container">
                    <div class="setting-group">
                        <h3>AI Providers</h3>
                        <div class="provider-list" id="providerList">
                            <div class="provider-item ${currentProvider === 'ollama' ? 'active' : ''}" 
                                 data-provider="ollama">
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
                                            data-setting="ollama.endpoint">
                                    </div>
                                    <div class="setting-item">
                                        <label>Available Models</label>
                                        <div class="model-list" id="ollamaModelList">
                                            <div class="loading-models">Loading installed models...</div>
                                        </div>
                                        <div class="setting-item">
                                            <label for="ollamaCustomModel">Pull New Model</label>
                                            <div class="custom-model-input">
                                                <input type="text" id="ollamaCustomModel" 
                                                    placeholder="Enter model name (e.g. llama2:latest)"
                                                    data-setting="ollama.customModel">
                                                <button class="pull-model-button">
                                                    <i class="codicon codicon-cloud-download"></i>
                                                    Pull
                                                </button>
                                            </div>
                                        </div>
                                        <button class="refresh-button">
                                            <i class="codicon codicon-refresh"></i>
                                            Refresh Models
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div class="provider-item ${currentProvider === 'openai' ? 'active' : ''}"
                                 data-provider="openai">
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
                                            data-setting="openai.apiKey">
                                    </div>
                                </div>
                            </div>

                            <div class="provider-item ${currentProvider === 'anthropic' ? 'active' : ''}"
                                 data-provider="anthropic">
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
                                            data-setting="anthropic.apiKey">
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
                                    data-setting="temperature">
                                <span id="temperatureValue">${temperature}</span>
                            </div>
                            <p class="setting-description">Controls randomness in responses. Higher values make output more creative but less predictable.</p>
                        </div>
                        <div class="setting-item">
                            <label for="maxTokens">Max Tokens</label>
                            <input type="number" id="maxTokens" 
                                value="${maxTokens}" 
                                min="1" max="8192"
                                data-setting="maxTokens">
                            <p class="setting-description">Maximum number of tokens to generate in responses.</p>
                        </div>
                    </div>
                </div>
            </div>`;
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
                    content = await this.settingsViewProvider.getContent();
                    break;
                default:
                    console.error('MainViewProvider: Unknown tab:', tabId);
                    return;
            }

            console.log(`MainViewProvider: Content length: ${content.length}`);
            await this._view.webview.postMessage({
                type: 'updateContent',
                content: content
            });
            console.log('MainViewProvider: Tab content updated');

        } catch (error) {
            console.error(`MainViewProvider: Error switching to tab ${tabId}:`, error);
            vscode.window.showErrorMessage(`Failed to load ${tabId} content: ` + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const mainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'main.js'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'main.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'codicon.css'));
        const codiconsFontUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'codicon.ttf'));

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};">
            <link href="${codiconsUri}" rel="stylesheet" />
            <link href="${styleMainUri}" rel="stylesheet">
            <style>
                @font-face {
                    font-family: "codicon";
                    src: url("${codiconsFontUri}") format("truetype");
                }
            </style>
            <title>Smile AI</title>
        </head>
        <body>
            <div class="container">
                <!-- Tab navigation -->
                <nav class="tabs">
                    <div class="tab-button active" data-tab="chat">
                        <i class="codicon codicon-comment-discussion"></i>
                        <span>Chat</span>
                    </div>
                    <div class="tab-button" data-tab="composer">
                        <i class="codicon codicon-edit"></i>
                        <span>Composer</span>
                    </div>
                    <div class="tab-button" data-tab="suggestions">
                        <i class="codicon codicon-lightbulb"></i>
                        <span>Suggestions</span>
                    </div>
                    <div class="tab-button" data-tab="rules">
                        <i class="codicon codicon-book"></i>
                        <span>Rules</span>
                    </div>
                    <div class="tab-button" data-tab="settings">
                        <i class="codicon codicon-settings-gear"></i>
                        <span>Settings</span>
                    </div>
                </nav>
                
                <!-- Content area -->
                <main class="content-area" id="contentArea">
                    <!-- Content will be dynamically loaded here -->
                    ${this.getContentByTabId()}
                </main>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
            </script>
            <script src="${mainUri}"></script>
        </body>
        </html>`;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private getContentByTabId(): string {
        switch (this.currentTab) {
            case 'chat':
                return '' + this.chatViewProvider.getContent();
            case 'composer':
                return '' + this.composerViewProvider.getContent();
            case 'suggestions':
                return '' + this.suggestionViewProvider.getContent();
            case 'rules':
                return '' + this.rulesViewProvider.getContent();
            case 'settings':
                return '' + this.settingsViewProvider.getContent();
            default:
                return '';
        }
    }

    private async updateSetting(key: string, value: any) {
        try {
            console.log(`MainViewProvider: Updating setting: ${key} = ${value}`);
            const config = vscode.workspace.getConfiguration('smile-ai');
            await config.update(key, value, vscode.ConfigurationTarget.Global);
            
            // If endpoint changed, refresh models
            if (key === 'ollama.endpoint') {
                await this.refreshOllamaModels();
            }
            
            // If provider changed, update model options
            if (key === 'aiProvider') {
                const chatContent = await this.chatViewProvider.getContent();
                const composerContent = await this.composerViewProvider.getContent();
                await this._view?.webview.postMessage({
                    type: 'updateContent',
                    content: chatContent
                });
                await this._view?.webview.postMessage({
                    type: 'updateContent',
                    content: composerContent
                });
            }
            
            // Show notification
            vscode.window.showInformationMessage(`Setting updated: ${key}`);
            
            // If model changed, update all views
            if (key.endsWith('.model')) {
                await this.updateAllViews();
            }
            
        } catch (error) {
            console.error('MainViewProvider: Error updating setting:', error);
            vscode.window.showErrorMessage(`Failed to update setting: ${key}`);
        }
    }

    private async updateAllViews() {
        if (this._view) {
            const chatContent = await this.chatViewProvider.getContent();
            const composerContent = await this.composerViewProvider.getContent();
            const settingsContent = await this._getSettingsContent();

            await this._view.webview.postMessage({
                type: 'updateContent',
                content: chatContent
            });

            await this._view.webview.postMessage({
                type: 'updateContent',
                content: composerContent
            });

            await this._view.webview.postMessage({
                type: 'updateContent',
                content: settingsContent
            });
        }
    }

    private async refreshOllamaModels() {
        try {
            const config = vscode.workspace.getConfiguration('smile-ai');
            const endpoint = config.get('ollama.endpoint', 'http://localhost:11434');
            const currentModel = config.get('ollama.model', '');
            
            console.log('MainViewProvider: Fetching Ollama models from:', endpoint);
            
            const response = await fetch(`${endpoint}/api/tags`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json() as { models: Array<{ name: string }> };
            const models = data.models.map(m => m.name);
            
            console.log('MainViewProvider: Fetched models:', models);

            // Save models to configuration
            await config.update('ollama.models', models, vscode.ConfigurationTarget.Global);
            
            if (this._view) {
                // Generate model list HTML
                const modelListHtml = models.map(model => `
                    <div class="model-item" data-model="${model}">
                        <input type="checkbox" 
                               class="model-checkbox"
                               id="model-${model}" 
                               value="${model}"
                               ${model === currentModel ? 'checked' : ''}>
                        <label for="model-${model}">
                            ${model}
                        </label>
                    </div>
                `).join('');

                // Update the webview
                await this._view.webview.postMessage({
                    type: 'ollamaModelsLoaded',
                    content: modelListHtml
                });

                // If no model is selected and models exist, select the first one
                if (!currentModel && models.length > 0) {
                    await this.updateSetting('ollama.model', models[0]);
                }

                // Update all views
                await this.updateAllViews();
            }
        } catch (error) {
            console.error('MainViewProvider: Error fetching Ollama models:', error);
            if (this._view) {
                await this._view.webview.postMessage({
                    type: 'ollamaModelsLoaded',
                    error: 'Failed to load models. Please check the endpoint.'
                });
            }
            vscode.window.showErrorMessage('Failed to load Ollama models. Please check the endpoint.');
        }
    }

    private async pullOllamaModel(modelName: string) {
        try {
            const config = vscode.workspace.getConfiguration('smile-ai');
            const endpoint = config.get('ollama.endpoint', 'http://localhost:11434');
            
            console.log('MainViewProvider: Pulling Ollama model:', modelName);
            
            const response = await fetch(`${endpoint}/api/pull`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: modelName })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            vscode.window.showInformationMessage(`Model çekiliyor: ${modelName}`);
            
            // Modeller listesini yenile
            await this.refreshOllamaModels();
            
        } catch (error) {
            console.error('MainViewProvider: Error pulling Ollama model:', error);
            vscode.window.showErrorMessage(`Model çekilirken hata oluştu: ${modelName}`);
        }
    }

    private async addCustomModel(provider: string, modelName: string) {
        try {
            console.log('MainViewProvider: Adding custom model:', provider, modelName);
            const config = vscode.workspace.getConfiguration('smile-ai');
            const customModels = config.get(`${provider}.customModels`, []) as string[];
            
            if (!customModels.includes(modelName)) {
                customModels.push(modelName);
                await config.update(`${provider}.customModels`, customModels, vscode.ConfigurationTarget.Global);
                
                // Settings içeriğini yenile
                if (this._view) {
                    const settingsContent = await this.settingsViewProvider.getContent();
                    await this._view.webview.postMessage({
                        type: 'updateContent',
                        content: settingsContent
                    });
                }
                
                vscode.window.showInformationMessage(`Custom model added: ${modelName}`);
            }
        } catch (error) {
            console.error('MainViewProvider: Error adding custom model:', error);
            vscode.window.showErrorMessage(`Error adding custom model: ${modelName}`);
        }
    }
}