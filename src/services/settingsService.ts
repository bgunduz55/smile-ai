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
    apiKey?: string;
    defaultModel?: string;
    models?: string[];
    customModels?: string[];
}

export class SettingsService {
    private static instance: SettingsService;
    private _onSettingsChanged = new EventEmitter<void>();
    readonly onSettingsChanged = this._onSettingsChanged.event;
    private readonly configPrefix = 'smile-ai';
    private readonly workspace = vscode.workspace;

    private constructor() {
        // Settings değişikliklerini dinle
        vscode.workspace.onDidChangeConfiguration(e => {
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
        const config = this.workspace.getConfiguration(this.configPrefix);
        return config.get<ModelProvider>('modelProvider', 'ollama');
    }

    async setActiveProvider(provider: ModelProvider): Promise<void> {
        const config = this.workspace.getConfiguration(this.configPrefix);
        await config.update('modelProvider', provider, vscode.ConfigurationTarget.Global);
    }

    getProviderSettings(provider: ModelProvider): ProviderSettings {
        const config = this.workspace.getConfiguration(this.configPrefix);
        return config.get<ProviderSettings>(`${provider}`, {});
    }

    async updateProviderSettings(provider: ModelProvider | string, settings: any): Promise<void> {
        const config = this.workspace.getConfiguration(this.configPrefix);
        if (typeof settings === 'object') {
            for (const [key, value] of Object.entries(settings)) {
                await config.update(`${provider}.${key}`, value, vscode.ConfigurationTarget.Global);
            }
        } else {
            const currentSettings = this.getProviderSettings(provider as ModelProvider);
            await config.update(
                provider,
                { ...currentSettings, ...settings },
                vscode.ConfigurationTarget.Global
            );
        }
        this._onSettingsChanged.fire();
    }

    getModelSettings(): ModelSettings {
        const config = this.workspace.getConfiguration(this.configPrefix);
        const provider = this.getActiveProvider();
        const providerSettings = this.getProviderSettings(provider);

        return {
            provider,
            model: config.get(`${provider}.model`, providerSettings.defaultModel || ''),
            temperature: config.get('temperature', 0.7),
            maxTokens: config.get('maxTokens', 2048),
            topP: config.get('topP', 0.9),
            topK: config.get('topK', 50),
            frequencyPenalty: config.get('frequencyPenalty', 0),
            presencePenalty: config.get('presencePenalty', 0),
            stopTokens: config.get('stopTokens', []),
            systemPrompt: config.get('systemPrompt', '')
        };
    }

    async updateModelSettings(settings: Partial<ModelSettings>): Promise<void> {
        const config = this.workspace.getConfiguration(this.configPrefix);
        const provider = settings.provider || this.getActiveProvider();

        if (settings.provider) {
            await this.setActiveProvider(settings.provider);
        }

        for (const [key, value] of Object.entries(settings)) {
            if (key === 'provider') continue;
            if (key === 'model') {
                await config.update(
                    `${provider}.model`,
                    value,
                    vscode.ConfigurationTarget.Global
                );
            } else {
                await config.update(
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
            const endpoint = settings.endpoint || 'http://localhost:11434';
            
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
            const endpoint = settings.endpoint || 'http://localhost:1234/v1';
            
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
            const endpoint = settings.endpoint || 'http://localhost:8080/v1';
            
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
        const customModels = settings.customModels || [];
        
        if (!customModels.includes(modelName)) {
            customModels.push(modelName);
            await this.updateProviderSettings(provider, { customModels });
        }
    }

    async removeCustomModel(provider: ModelProvider, modelName: string): Promise<void> {
        const settings = this.getProviderSettings(provider);
        const customModels = settings.customModels || [];
        
        const index = customModels.indexOf(modelName);
        if (index > -1) {
            customModels.splice(index, 1);
            await this.updateProviderSettings(provider, { customModels });
        }
    }

    public getSettings(): any {
        const config = this.workspace.getConfiguration(this.configPrefix);
        return {
            provider: config.get('provider', 'ollama'),
            ollama: {
                endpoint: config.get('ollama.endpoint', 'http://localhost:11434'),
                model: config.get('ollama.model', ''),
                models: config.get('ollama.models', [])
            },
            openai: {
                apiKey: config.get('openai.apiKey', ''),
                model: config.get('openai.model', '')
            },
            anthropic: {
                apiKey: config.get('anthropic.apiKey', ''),
                model: config.get('anthropic.model', '')
            },
            temperature: config.get('temperature', 0.7),
            maxTokens: config.get('maxTokens', 2048)
        };
    }
} 