import * as vscode from 'vscode';
import { EventEmitter } from 'vscode';

export type ModelProvider = 'ollama' | 'llamacpp' | 'openai' | 'anthropic' | 'lmstudio' | 'localai' | 'deepseek' | 'qwen';
export type OpenAIModel = 'gpt-4' | 'gpt-3.5-turbo' | string;
export type AnthropicModel = 'claude-3-opus-20240229' | 'claude-3-sonnet-20240229' | 'claude-2.1' | string;

export interface ModelSettings {
    provider: ModelProvider;
    model: string;
    temperature: number;
    maxTokens: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stopTokens?: string[];
    systemPrompt?: string;
}

export interface ProviderSettings {
    endpoint?: string;
    model?: string;
    models?: string[];
    activeModels?: string[];
    temperature?: number;
}

export class SettingsService {
    private static instance: SettingsService;
    private readonly _configuration: vscode.WorkspaceConfiguration;
    private readonly _onSettingsChanged: vscode.EventEmitter<void>;
    readonly onSettingsChanged: vscode.Event<void>;
    private readonly configPrefix = 'smile-ai';
    private readonly workspace = vscode.workspace;

    private constructor() {
        this._configuration = this.workspace.getConfiguration(this.configPrefix);
        this._onSettingsChanged = new vscode.EventEmitter<void>();
        this.onSettingsChanged = this._onSettingsChanged.event;

        // Settings değişikliklerini dinle
        this.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('smile-ai')) {
                this._onSettingsChanged.fire();
            }
        });
    }

    static getInstance(): SettingsService {
        if (!SettingsService.instance) {
            SettingsService.instance = new SettingsService();
        }
        return SettingsService.instance;
    }

    getActiveProvider(): ModelProvider {
        return this._configuration.get<ModelProvider>('modelProvider', 'ollama');
    }

    async setActiveProvider(provider: ModelProvider): Promise<void> {
        await this._configuration.update('modelProvider', provider, vscode.ConfigurationTarget.Global);
    }

    getProviderSettings(provider: string): ProviderSettings | undefined {
        return this._configuration.get<ProviderSettings>(provider);
    }

    async updateProviderSettings(provider: ModelProvider | string, settings: any): Promise<void> {
        if (typeof settings === 'object') {
            for (const [key, value] of Object.entries(settings)) {
                await this._configuration.update(key, value, vscode.ConfigurationTarget.Global);
            }
        } else {
            const currentSettings = this.getProviderSettings(provider as string);
            await this._configuration.update(
                provider,
                { ...currentSettings, ...settings },
                vscode.ConfigurationTarget.Global
            );
        }
        this._onSettingsChanged.fire();
    }

    async setActiveModel(provider: string, model: string): Promise<void> {
        try {
            // Update the current model
            await this._configuration.update(`${provider}.model`, model, vscode.ConfigurationTarget.Global);

            // Get current active models
            const providerSettings = this.getProviderSettings(provider);
            const activeModels = providerSettings?.activeModels || [];

            // Add to active models if not already present
            if (!activeModels.includes(model)) {
                activeModels.push(model);
                await this._configuration.update(`${provider}.activeModels`, activeModels, vscode.ConfigurationTarget.Global);
            }

            this._onSettingsChanged.fire();
        } catch (error) {
            console.error('Error setting active model:', error);
            throw error;
        }
    }

    async removeActiveModel(provider: string, model: string): Promise<void> {
        try {
            const providerSettings = this.getProviderSettings(provider);
            const activeModels = providerSettings?.activeModels || [];
            const updatedActiveModels = activeModels.filter(m => m !== model);

            await this._configuration.update(`${provider}.activeModels`, updatedActiveModels, vscode.ConfigurationTarget.Global);

            // If the current model is being removed, update it
            if (providerSettings?.model === model) {
                const newModel = updatedActiveModels[0] || '';
                await this._configuration.update(`${provider}.model`, newModel, vscode.ConfigurationTarget.Global);
            }

            this._onSettingsChanged.fire();
        } catch (error) {
            console.error('Error removing active model:', error);
            throw error;
        }
    }

    getModelSettings(): ModelSettings {
        const provider = this.getActiveProvider();
        const providerSettings = this.getProviderSettings(provider);

        return {
            provider,
            model: this._configuration.get(`${provider}.model`, providerSettings?.model || ''),
            temperature: this._configuration.get('temperature', 0.7),
            maxTokens: this._configuration.get('maxTokens', 2048),
            topP: this._configuration.get('topP', 0.9),
            topK: this._configuration.get('topK', 50),
            frequencyPenalty: this._configuration.get('frequencyPenalty', 0),
            presencePenalty: this._configuration.get('presencePenalty', 0),
            stopTokens: this._configuration.get('stopTokens', []),
            systemPrompt: this._configuration.get('systemPrompt', '')
        };
    }

    async updateModelSettings(settings: Partial<ModelSettings>): Promise<void> {
        const provider = settings.provider || this.getActiveProvider();

        if (settings.provider) {
            await this.setActiveProvider(settings.provider);
        }

        for (const [key, value] of Object.entries(settings)) {
            if (key === 'provider') continue;
            if (key === 'model') {
                await this._configuration.update(
                    `${provider}.model`,
                    value,
                    vscode.ConfigurationTarget.Global
                );
            } else {
                await this._configuration.update(
                    key,
                    value,
                    vscode.ConfigurationTarget.Global
                );
            }
        }
    }

    async refreshProviderModels(provider: ModelProvider): Promise<string[]> {
        switch (provider) {
            case 'ollama':
                return this.refreshOllamaModels();
            case 'lmstudio':
                return this.refreshLMStudioModels();
            case 'localai':
                return this.refreshLocalAIModels();
            default:
                return [];
        }
    }

    private async refreshOllamaModels(): Promise<string[]> {
        try {
            const settings = this.getProviderSettings('ollama');
            const endpoint = settings?.endpoint || 'http://localhost:11434';
            
            const response = await fetch(`${endpoint}/api/tags`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json() as { models: Array<{ name: string }> };
            const models = data.models?.map(m => m.name) || [];
            
            await this.updateProviderSettings('ollama', { models });
            return models;
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
            throw error;
        }
    }

    private async refreshLMStudioModels(): Promise<string[]> {
        try {
            const settings = this.getProviderSettings('lmstudio');
            const endpoint = settings?.endpoint || 'http://localhost:1234/v1';
            
            const response = await fetch(`${endpoint}/models`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json() as { data: Array<{ id: string }> };
            const models = data.data?.map(m => m.id) || [];
            
            await this.updateProviderSettings('lmstudio', { models });
            return models;
        } catch (error) {
            console.error('Error fetching LM Studio models:', error);
            throw error;
        }
    }

    private async refreshLocalAIModels(): Promise<string[]> {
        try {
            const settings = this.getProviderSettings('localai');
            const endpoint = settings?.endpoint || 'http://localhost:8080/v1';
            
            const response = await fetch(`${endpoint}/models`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json() as { data: Array<{ id: string }> };
            const models = data.data?.map(m => m.id) || [];
            
            await this.updateProviderSettings('localai', { models });
            return models;
        } catch (error) {
            console.error('Error fetching LocalAI models:', error);
            throw error;
        }
    }

    async addCustomModel(provider: ModelProvider, modelName: string): Promise<void> {
        const settings = this.getProviderSettings(provider);
        const customModels = settings?.models || [];
        
        if (!customModels.includes(modelName)) {
            customModels.push(modelName);
            await this.updateProviderSettings(provider, { models: customModels });
        }
    }

    async removeCustomModel(provider: ModelProvider, modelName: string): Promise<void> {
        const settings = this.getProviderSettings(provider);
        const customModels = settings?.models || [];
        
        const index = customModels.indexOf(modelName);
        if (index > -1) {
            customModels.splice(index, 1);
            await this.updateProviderSettings(provider, { models: customModels });
        }
    }

    public getSettings(): any {
        const config = this.workspace.getConfiguration(this.configPrefix);
        return {
            provider: config.get('provider', 'ollama'),
            ollama: {
                endpoint: config.get('ollama.endpoint', 'http://localhost:11434'),
                model: config.get('ollama.model', ''),
                models: config.get('ollama.models', []),
                activeModels: config.get('ollama.activeModels', [])
            },
            openai: {
                apiKey: config.get('openai.apiKey', ''),
                model: config.get('openai.model', ''),
                activeModels: config.get('openai.activeModels', [])
            },
            anthropic: {
                apiKey: config.get('anthropic.apiKey', ''),
                model: config.get('anthropic.model', ''),
                activeModels: config.get('anthropic.activeModels', [])
            },
            temperature: config.get('temperature', 0.7),
            maxTokens: config.get('maxTokens', 2048)
        };
    }

    getCurrentModel(provider: string): string | undefined {
        const providerSettings = this.getProviderSettings(provider);
        return providerSettings?.model;
    }

    getActiveModels(provider: string): string[] {
        const providerSettings = this.getProviderSettings(provider);
        return providerSettings?.activeModels || [];
    }

    public async updateSettings(settings: any): Promise<void> {
        for (const [key, value] of Object.entries(settings)) {
            await this._configuration.update(key, value, vscode.ConfigurationTarget.Global);
        }
        this._onSettingsChanged.fire();
    }
} 