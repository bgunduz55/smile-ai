import * as vscode from 'vscode';
import { SettingsService, ModelProvider } from '../services/settingsService';

export class SettingsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.settingsView';

    private settingsService: SettingsService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {
        this.settingsService = SettingsService.getInstance();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Settings</title>
            </head>
            <body>
                <div id="settings-container">
                    <h2>Settings</h2>
                    <div class="settings-group">
                        <!-- Settings content will be dynamically populated -->
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    setWebview(webviewView: vscode.WebviewView) {
        // Store webview reference if needed in the future
    }

    public async getContent(): Promise<string> {
        const settings = this.settingsService.getSettings();
        const currentProvider = settings.provider || 'ollama';

        let providerContent = '';
        switch (currentProvider) {
            case 'ollama':
                providerContent = await this.getOllamaSettingsHtml(settings.ollama || {}, settings.ollama?.activeModels || []);
                break;
            case 'openai':
                providerContent = this.getOpenAISettingsHtml(settings.openai || {}, settings.openai?.activeModels || []);
                break;
            case 'anthropic':
                providerContent = this.getAnthropicSettingsHtml(settings.anthropic || {}, settings.anthropic?.activeModels || []);
                break;
        }

        return `
            <div class="settings-container">
                <div class="setting-group">
                    <h3>AI Sağlayıcıları</h3>
                    <div class="provider-list">
                        <div class="provider-item ${currentProvider === 'ollama' ? 'active' : ''}" 
                             onclick="updateSetting('provider', 'ollama')">
                            <div class="provider-header">
                                <h4>Ollama</h4>
                                <span class="provider-badge ${currentProvider === 'ollama' ? 'active' : ''}">
                                    ${currentProvider === 'ollama' ? 'Aktif' : 'Pasif'}
                                </span>
                            </div>
                            <p>Yerel AI modelleri (Ollama)</p>
                            <div class="provider-settings ${currentProvider === 'ollama' ? 'show' : ''}">
                                ${providerContent}
                            </div>
                        </div>

                        <div class="provider-item ${currentProvider === 'openai' ? 'active' : ''}"
                             onclick="updateSetting('provider', 'openai')">
                            <div class="provider-header">
                                <h4>OpenAI</h4>
                                <span class="provider-badge ${currentProvider === 'openai' ? 'active' : ''}">
                                    ${currentProvider === 'openai' ? 'Aktif' : 'Pasif'}
                                </span>
                            </div>
                            <p>GPT-4 ve diğer OpenAI modelleri</p>
                            <div class="provider-settings ${currentProvider === 'openai' ? 'show' : ''}">
                                ${providerContent}
                            </div>
                        </div>

                        <div class="provider-item ${currentProvider === 'anthropic' ? 'active' : ''}"
                             onclick="updateSetting('provider', 'anthropic')">
                            <div class="provider-header">
                                <h4>Anthropic</h4>
                                <span class="provider-badge ${currentProvider === 'anthropic' ? 'active' : ''}">
                                    ${currentProvider === 'anthropic' ? 'Aktif' : 'Pasif'}
                                </span>
                            </div>
                            <p>Claude ve diğer Anthropic modelleri</p>
                            <div class="provider-settings ${currentProvider === 'anthropic' ? 'show' : ''}">
                                ${providerContent}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="setting-group">
                    <h3>Model Parametreleri</h3>
                    ${this.getModelParametersHtml(settings)}
                </div>
            </div>
        `;
    }

    private async getProviderCards(): Promise<string> {
        const activeProvider = this.settingsService.getActiveProvider();
        const providers: ModelProvider[] = ['ollama', 'openai', 'anthropic', 'lmstudio', 'localai', 'deepseek', 'qwen'];
        
        const cards = await Promise.all(providers.map(async provider => {
            const settings = this.settingsService.getProviderSettings(provider);
            const isActive = provider === activeProvider;
            
            return `
                <div class="provider-item ${isActive ? 'active' : ''}" data-provider="${provider}">
                    <div class="provider-header">
                        <h4>${this.getProviderDisplayName(provider)}</h4>
                        <span class="provider-badge ${isActive ? 'active' : ''}">
                            ${isActive ? 'Aktif' : 'Pasif'}
                        </span>
                    </div>
                    <p>${this.getProviderDescription(provider)}</p>
                    <div class="provider-settings ${isActive ? 'show' : ''}">
                        ${await this.getProviderSettingsHtml(provider)}
                    </div>
                </div>
            `;
        }));
        
        return cards.join('\\n');
    }

    private getProviderDisplayName(provider: ModelProvider): string {
        const displayNames: Record<ModelProvider, string> = {
            ollama: 'Ollama',
            llamacpp: 'LlamaCpp',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            lmstudio: 'LM Studio',
            localai: 'LocalAI',
            deepseek: 'Deepseek',
            qwen: 'Qwen'
        };
        return displayNames[provider];
    }

    private getProviderDescription(provider: ModelProvider): string {
        const descriptions: Record<ModelProvider, string> = {
            ollama: 'Yerel AI modelleri',
            llamacpp: 'LlamaCpp modelleri',
            openai: 'GPT-4 ve diğer OpenAI modelleri',
            anthropic: 'Claude ve diğer Anthropic modelleri',
            lmstudio: 'LM Studio modelleri',
            localai: 'LocalAI modelleri',
            deepseek: 'Deepseek modelleri',
            qwen: 'Qwen modelleri'
        };
        return descriptions[provider];
    }

    private async getProviderSettingsHtml(provider: ModelProvider): Promise<string> {
        const settings = this.settingsService.getProviderSettings(provider);
        const activeModels = settings.activeModels || [];
        
        switch (provider) {
            case 'ollama':
                return this.getOllamaSettingsHtml(settings, activeModels);
            case 'openai':
                return this.getOpenAISettingsHtml(settings, activeModels);
            case 'anthropic':
                return this.getAnthropicSettingsHtml(settings, activeModels);
            case 'lmstudio':
                return this.getLMStudioSettingsHtml(settings, activeModels);
            case 'localai':
                return this.getLocalAISettingsHtml(settings, activeModels);
            case 'deepseek':
                return this.getDeepseekSettingsHtml(settings, activeModels);
            case 'qwen':
                return this.getQwenSettingsHtml(settings, activeModels);
            default:
                return '';
        }
    }

    private async getOllamaSettingsHtml(settings: any, activeModels: string[]): Promise<string> {
        const endpoint = settings.endpoint || 'http://localhost:11434';
        let models: string[] = settings.models || [];

        try {
            const response = await fetch(`${endpoint}/api/tags`);
            if (response.ok) {
                const data = await response.json() as { models: Array<{ name: string }> };
                models = data.models.map(m => m.name);
                await this.settingsService.updateProviderSettings('ollama', { models });
            }
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
        }

        return `
            <div class="setting-item">
                <label for="ollamaEndpoint">Endpoint</label>
                <input type="text" id="ollamaEndpoint" 
                    value="${endpoint}"
                    data-setting="ollama.endpoint">
            </div>
            <div class="setting-item">
                <label>Kullanılabilir Modeller</label>
                <div class="model-list" id="ollamaModelList">
                    ${models.length ? models.map((model: string) => `
                        <div class="model-item">
                            <input type="checkbox" name="ollamaModel" id="${model}" 
                                value="${model}"
                                ${activeModels.includes(model) ? 'checked' : ''}
                                data-setting="ollama.activeModels"
                                onchange="updateActiveModels('ollama', '${model}', this.checked)">
                            <label for="${model}">
                                ${model}
                            </label>
                        </div>
                    `).join('\n') : '<div class="loading-models">Modeller yükleniyor...</div>'}
                </div>
            </div>
        `;
    }

    private getOpenAISettingsHtml(settings: any, activeModels: string[]): string {
        const apiKey = settings.apiKey || '';
        const models = ['gpt-4', 'gpt-3.5-turbo'];

        return `
            <div class="setting-item">
                <label for="openaiApiKey">API Key</label>
                <input type="password" id="openaiApiKey" 
                    value="${apiKey}"
                    data-setting="openai.apiKey">
            </div>
            <div class="setting-item">
                <label>Kullanılabilir Modeller</label>
                <div class="model-list">
                    ${models.map(model => `
                        <div class="model-item">
                            <input type="checkbox" name="openaiModel" id="${model}" 
                                value="${model}"
                                ${activeModels.includes(model) ? 'checked' : ''}
                                data-setting="openai.activeModels"
                                onchange="updateActiveModels('openai', '${model}', this.checked)">
                            <label for="${model}">
                                ${model}
                            </label>
                        </div>
                    `).join('\n')}
                </div>
            </div>
        `;
    }

    private getAnthropicSettingsHtml(settings: any, activeModels: string[]): string {
        const apiKey = settings.apiKey || '';
        const models = ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-2.1'];

        return `
            <div class="setting-item">
                <label for="anthropicApiKey">API Key</label>
                <input type="password" id="anthropicApiKey" 
                    value="${apiKey}"
                    data-setting="anthropic.apiKey">
            </div>
            <div class="setting-item">
                <label>Kullanılabilir Modeller</label>
                <div class="model-list">
                    ${models.map(model => `
                        <div class="model-item">
                            <input type="checkbox" name="anthropicModel" id="${model}" 
                                value="${model}"
                                ${activeModels.includes(model) ? 'checked' : ''}
                                data-setting="anthropic.activeModels"
                                onchange="updateActiveModels('anthropic', '${model}', this.checked)">
                            <label for="${model}">
                                ${model}
                            </label>
                        </div>
                    `).join('\n')}
                </div>
            </div>
        `;
    }

    private getLMStudioSettingsHtml(settings: any, activeModels: string[]): string {
        return `
            <div class="setting-item">
                <label for="lmstudioEndpoint">Endpoint</label>
                <input type="text" id="lmstudioEndpoint" 
                    value="${settings.endpoint || 'http://localhost:1234/v1'}"
                    onchange="updateSetting('lmstudio.endpoint', this.value)">
            </div>
            <div class="setting-item">
                <label>Yüklü Modeller</label>
                <div class="model-list" id="lmstudioModelList">
                    ${this.getModelListHtml(settings.models || [], settings.model, activeModels)}
                </div>
                <button onclick="refreshLMStudioModels()" class="refresh-button">
                    <i class="codicon codicon-refresh"></i>
                    Modelleri Yenile
                </button>
            </div>
        `;
    }

    private getLocalAISettingsHtml(settings: any, activeModels: string[]): string {
        return `
            <div class="setting-item">
                <label for="localaiEndpoint">Endpoint</label>
                <input type="text" id="localaiEndpoint" 
                    value="${settings.endpoint || 'http://localhost:8080/v1'}"
                    onchange="updateSetting('localai.endpoint', this.value)">
            </div>
            <div class="setting-item">
                <label>Yüklü Modeller</label>
                <div class="model-list" id="localaiModelList">
                    ${this.getModelListHtml(settings.models || [], settings.model, activeModels)}
                </div>
                <button onclick="refreshLocalAIModels()" class="refresh-button">
                    <i class="codicon codicon-refresh"></i>
                    Modelleri Yenile
                </button>
            </div>
        `;
    }

    private getDeepseekSettingsHtml(settings: any, activeModels: string[]): string {
        return `
            <div class="setting-item">
                <label for="deepseekApiKey">API Key</label>
                <input type="password" id="deepseekApiKey" 
                    value="${settings.apiKey || ''}"
                    onchange="updateSetting('deepseek.apiKey', this.value)">
            </div>
            <div class="setting-item">
                <label>Modeller</label>
                <div class="model-list">
                    <div class="model-item">
                        <input type="radio" name="deepseekModel" id="deepseek33b" 
                            value="deepseek-coder-33b-instruct"
                            ${settings.model === 'deepseek-coder-33b-instruct' ? 'checked' : ''}
                            onchange="updateSetting('deepseek.model', this.value)">
                        <label for="deepseek33b">
                            Deepseek Coder 33B
                            <span class="model-details">En yetenekli Deepseek modeli</span>
                        </label>
                    </div>
                    <div class="model-item">
                        <input type="radio" name="deepseekModel" id="deepseek67b" 
                            value="deepseek-coder-6.7b-instruct"
                            ${settings.model === 'deepseek-coder-6.7b-instruct' ? 'checked' : ''}
                            onchange="updateSetting('deepseek.model', this.value)">
                        <label for="deepseek67b">
                            Deepseek Coder 6.7B
                            <span class="model-details">Dengeli performans</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }

    private getQwenSettingsHtml(settings: any, activeModels: string[]): string {
        return `
            <div class="setting-item">
                <label for="qwenApiKey">API Key</label>
                <input type="password" id="qwenApiKey" 
                    value="${settings.apiKey || ''}"
                    onchange="updateSetting('qwen.apiKey', this.value)">
            </div>
            <div class="setting-item">
                <label>Modeller</label>
                <div class="model-list">
                    <div class="model-item">
                        <input type="radio" name="qwenModel" id="qwen25turbo" 
                            value="qwen2.5-turbo"
                            ${settings.model === 'qwen2.5-turbo' ? 'checked' : ''}
                            onchange="updateSetting('qwen.model', this.value)">
                        <label for="qwen25turbo">
                            Qwen 2.5 Turbo
                            <span class="model-details">En son Qwen modeli</span>
                        </label>
                    </div>
                    <div class="model-item">
                        <input type="radio" name="qwenModel" id="qwen25pro" 
                            value="qwen2.5-pro"
                            ${settings.model === 'qwen2.5-pro' ? 'checked' : ''}
                            onchange="updateSetting('qwen.model', this.value)">
                        <label for="qwen25pro">
                            Qwen 2.5 Pro
                            <span class="model-details">Profesyonel kullanım için</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }

    private getModelListHtml(models: string[], selectedModel: string, activeModels: string[]): string {
        if (!models.length) {
            return '<div class="loading-models">Modeller yükleniyor...</div>';
        }

        return models.map(model => `
            <div class="model-item">
                <input type="checkbox" name="model" id="${model}" 
                    value="${model}"
                    ${model === selectedModel ? 'checked' : ''}
                    ${activeModels.includes(model) ? 'checked' : ''}
                    onchange="updateSetting('model', this.value); updateActiveModels('${model}', '${model}', this.checked)">
                <label for="${model}">
                    ${model}
                </label>
            </div>
        `).join('\\n');
    }

    private getModelParametersHtml(settings: any): string {
        return `
            <div class="setting-item">
                <label for="temperature">Sıcaklık</label>
                <div class="slider-container">
                    <input type="range" id="temperature" 
                        min="0" max="1" step="0.1" 
                        value="${settings.temperature}"
                        oninput="updateSetting('temperature', this.value); document.getElementById('temperatureValue').textContent = this.value;">
                    <span id="temperatureValue">${settings.temperature}</span>
                </div>
                <p class="setting-description">Yanıtlardaki rastgeleliği kontrol eder. Yüksek değerler çıktıyı daha yaratıcı ama daha az tahmin edilebilir yapar.</p>
            </div>
            <div class="setting-item">
                <label for="maxTokens">Maksimum Token</label>
                <input type="number" id="maxTokens" 
                    value="${settings.maxTokens}" 
                    min="1" max="8192"
                    onchange="updateSetting('maxTokens', this.value)">
                <p class="setting-description">Yanıtlarda üretilecek maksimum token sayısı.</p>
            </div>
            <div class="setting-item">
                <label for="topP">Top P</label>
                <div class="slider-container">
                    <input type="range" id="topP" 
                        min="0" max="1" step="0.1" 
                        value="${settings.topP}"
                        oninput="updateSetting('topP', this.value); document.getElementById('topPValue').textContent = this.value;">
                    <span id="topPValue">${settings.topP}</span>
                </div>
                <p class="setting-description">Nucleus sampling için olasılık eşiği.</p>
            </div>
            <div class="setting-item">
                <label for="frequencyPenalty">Frekans Cezası</label>
                <div class="slider-container">
                    <input type="range" id="frequencyPenalty" 
                        min="-2" max="2" step="0.1" 
                        value="${settings.frequencyPenalty}"
                        oninput="updateSetting('frequencyPenalty', this.value); document.getElementById('frequencyPenaltyValue').textContent = this.value;">
                    <span id="frequencyPenaltyValue">${settings.frequencyPenalty}</span>
                </div>
                <p class="setting-description">Kelime tekrarını azaltmak için uygulanan ceza.</p>
            </div>
            <div class="setting-item">
                <label for="presencePenalty">Varlık Cezası</label>
                <div class="slider-container">
                    <input type="range" id="presencePenalty" 
                        min="-2" max="2" step="0.1" 
                        value="${settings.presencePenalty}"
                        oninput="updateSetting('presencePenalty', this.value); document.getElementById('presencePenaltyValue').textContent = this.value;">
                    <span id="presencePenaltyValue">${settings.presencePenalty}</span>
                </div>
                <p class="setting-description">Yeni konuları teşvik etmek için uygulanan ceza.</p>
            </div>
        `;
    }
} 