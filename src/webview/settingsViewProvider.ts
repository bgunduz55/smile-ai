import * as vscode from 'vscode';
import { SettingsService, ModelProvider } from '../services/settingsService';

export class SettingsViewProvider {
    private _view?: vscode.WebviewView;
    private settingsService: SettingsService;

    constructor() {
        this.settingsService = SettingsService.getInstance();
    }

    setWebview(webviewView: vscode.WebviewView) {
        this._view = webviewView;
    }

    public async getContent(): Promise<string> {
        const settings = this.settingsService.getSettings();
        const currentProvider = settings.provider || 'ollama';

        let providerContent = '';
        switch (currentProvider) {
            case 'ollama':
                providerContent = await this.getOllamaSettingsHtml(settings.ollama || {});
                break;
            case 'openai':
                providerContent = this.getOpenAISettingsHtml(settings.openai || {});
                break;
            case 'anthropic':
                providerContent = this.getAnthropicSettingsHtml(settings.anthropic || {});
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
        
        switch (provider) {
            case 'ollama':
                return this.getOllamaSettingsHtml(settings);
            case 'openai':
                return this.getOpenAISettingsHtml(settings);
            case 'anthropic':
                return this.getAnthropicSettingsHtml(settings);
            case 'lmstudio':
                return this.getLMStudioSettingsHtml(settings);
            case 'localai':
                return this.getLocalAISettingsHtml(settings);
            case 'deepseek':
                return this.getDeepseekSettingsHtml(settings);
            case 'qwen':
                return this.getQwenSettingsHtml(settings);
            default:
                return '';
        }
    }

    private async getOllamaSettingsHtml(settings: any): Promise<string> {
        const currentModel = settings.model || '';
        const endpoint = settings.endpoint || 'http://localhost:11434';
        let models: string[] = [];

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
                    onchange="updateSetting('ollama.endpoint', this.value)">
            </div>
            <div class="setting-item">
                <label>Yüklü Modeller</label>
                <div class="model-list" id="ollamaModelList">
                    ${models.length ? models.map((model: string) => `
                        <div class="model-item">
                            <input type="radio" name="ollamaModel" id="${model}" 
                                value="${model}"
                                ${model === currentModel ? 'checked' : ''}
                                onchange="updateSetting('ollama.model', this.value)">
                            <label for="${model}">
                                ${model}
                            </label>
                        </div>
                    `).join('\n') : '<div class="loading-models">Modeller yükleniyor...</div>'}
                </div>
                <div class="setting-item">
                    <label for="ollamaCustomModel">Yeni Model Çek</label>
                    <div class="custom-model-input">
                        <input type="text" id="ollamaCustomModel" 
                            placeholder="Model adı (örn. llama2:latest)">
                        <button onclick="pullOllamaModel(document.getElementById('ollamaCustomModel').value)">
                            Model Çek
                        </button>
                    </div>
                </div>
                <button onclick="refreshOllamaModels()" class="refresh-button">
                    <i class="codicon codicon-refresh"></i>
                    Modelleri Yenile
                </button>
            </div>
        `;
    }

    private getOpenAISettingsHtml(settings: any): string {
        return `
            <div class="setting-item">
                <label for="openaiApiKey">API Key</label>
                <input type="password" id="openaiApiKey" 
                    value="${settings.apiKey || ''}"
                    onchange="updateSetting('openai.apiKey', this.value)">
            </div>
            <div class="setting-item">
                <label>Modeller</label>
                <div class="model-list">
                    <div class="model-item">
                        <input type="radio" name="openaiModel" id="gpt4" 
                            value="gpt-4"
                            ${settings.model === 'gpt-4' ? 'checked' : ''}
                            onchange="updateSetting('openai.model', this.value)">
                        <label for="gpt4">
                            GPT-4
                            <span class="model-details">En son GPT-4 modeli</span>
                        </label>
                    </div>
                    <div class="model-item">
                        <input type="radio" name="openaiModel" id="gpt35" 
                            value="gpt-3.5-turbo"
                            ${settings.model === 'gpt-3.5-turbo' ? 'checked' : ''}
                            onchange="updateSetting('openai.model', this.value)">
                        <label for="gpt35">
                            GPT-3.5 Turbo
                            <span class="model-details">En son GPT-3.5 modeli</span>
                        </label>
                    </div>
                </div>
                <div class="setting-item">
                    <label for="openaiCustomModel">Özel Model</label>
                    <div class="custom-model-input">
                        <input type="text" id="openaiCustomModel" 
                            placeholder="Özel model adı (örn. gpt-4-0125-preview)"
                            value="${settings.customModel || ''}"
                            onchange="updateSetting('openai.model', this.value)">
                    </div>
                </div>
            </div>
        `;
    }

    private getAnthropicSettingsHtml(settings: any): string {
        return `
            <div class="setting-item">
                <label for="anthropicApiKey">API Key</label>
                <input type="password" id="anthropicApiKey" 
                    value="${settings.apiKey || ''}"
                    onchange="updateSetting('anthropic.apiKey', this.value)">
            </div>
            <div class="setting-item">
                <label>Modeller</label>
                <div class="model-list">
                    <div class="model-item">
                        <input type="radio" name="anthropicModel" id="claude3opus" 
                            value="claude-3-opus-20240229"
                            ${settings.model === 'claude-3-opus-20240229' ? 'checked' : ''}
                            onchange="updateSetting('anthropic.model', this.value)">
                        <label for="claude3opus">
                            Claude 3 Opus
                            <span class="model-details">En yetenekli Claude modeli</span>
                        </label>
                    </div>
                    <div class="model-item">
                        <input type="radio" name="anthropicModel" id="claude3sonnet" 
                            value="claude-3-sonnet-20240229"
                            ${settings.model === 'claude-3-sonnet-20240229' ? 'checked' : ''}
                            onchange="updateSetting('anthropic.model', this.value)">
                        <label for="claude3sonnet">
                            Claude 3 Sonnet
                            <span class="model-details">Dengeli performans ve hız</span>
                        </label>
                    </div>
                </div>
                <div class="setting-item">
                    <label for="anthropicCustomModel">Özel Model</label>
                    <div class="custom-model-input">
                        <input type="text" id="anthropicCustomModel" 
                            placeholder="Özel model adı (örn. claude-3-haiku-20240229)"
                            value="${settings.customModel || ''}"
                            onchange="updateSetting('anthropic.model', this.value)">
                    </div>
                </div>
            </div>
        `;
    }

    private getLMStudioSettingsHtml(settings: any): string {
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
                    ${this.getModelListHtml(settings.models || [], settings.model)}
                </div>
                <button onclick="refreshLMStudioModels()" class="refresh-button">
                    <i class="codicon codicon-refresh"></i>
                    Modelleri Yenile
                </button>
            </div>
        `;
    }

    private getLocalAISettingsHtml(settings: any): string {
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
                    ${this.getModelListHtml(settings.models || [], settings.model)}
                </div>
                <button onclick="refreshLocalAIModels()" class="refresh-button">
                    <i class="codicon codicon-refresh"></i>
                    Modelleri Yenile
                </button>
            </div>
        `;
    }

    private getDeepseekSettingsHtml(settings: any): string {
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

    private getQwenSettingsHtml(settings: any): string {
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

    private getModelListHtml(models: string[], selectedModel: string): string {
        if (!models.length) {
            return '<div class="loading-models">Modeller yükleniyor...</div>';
        }

        return models.map(model => `
            <div class="model-item">
                <input type="radio" name="model" id="${model}" 
                    value="${model}"
                    ${model === selectedModel ? 'checked' : ''}
                    onchange="updateSetting('model', this.value)">
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