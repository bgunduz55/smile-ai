import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import {
    ExtensionSettings,
    ModelProvider,
    ModelSettings,
    ProviderSettings,
    ThemeSettings,
    ShortcutSettings,
    RateLimitSettings,
    ErrorHandlingSettings,
    SecuritySettings,
    FeatureSettings
} from '../models/settings';

export class SettingsService {
    private static instance: SettingsService;
    private readonly configurationSection = 'smile-ai';
    private settings: ExtensionSettings;
    private readonly onSettingsChangedEmitter = new EventEmitter();

    constructor() {
        this.settings = this.loadSettings();
        this.watchSettings();
    }

    public static getInstance(): SettingsService {
        if (!SettingsService.instance) {
            SettingsService.instance = new SettingsService();
        }
        return SettingsService.instance;
    }

    private getDefaultSettings(): ExtensionSettings {
        return {
            providers: {
                openai: {
                    requiresApiKey: true,
                    models: ['gpt-4', 'gpt-3.5-turbo']
                },
                anthropic: {
                    requiresApiKey: true,
                    models: ['claude-3-opus', 'claude-3-sonnet']
                },
                deepseek: {
                    requiresApiKey: true,
                    models: ['deepseek-coder', 'deepseek-chat']
                },
                qwen: {
                    requiresApiKey: true,
                    models: ['qwen-72b', 'qwen-14b']
                },
                ollama: {
                    isLocal: true,
                    endpoint: 'http://localhost:11434',
                    models: ['codellama', 'llama2']
                },
                lmstudio: {
                    isLocal: true,
                    endpoint: 'http://localhost:1234',
                    models: ['local-model']
                },
                localai: {
                    isLocal: true,
                    endpoint: 'http://localhost:8080',
                    models: ['local-model']
                }
            },
            defaultProvider: 'openai',
            apiKeys: {},
            models: {
                openai: {
                    model: 'gpt-4',
                    temperature: 0.7,
                    maxTokens: 2048,
                    topP: 1,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                },
                anthropic: {
                    model: 'claude-3-opus',
                    temperature: 0.7,
                    maxTokens: 2048,
                    topP: 1,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                },
                deepseek: {
                    model: 'deepseek-coder',
                    temperature: 0.7,
                    maxTokens: 2048,
                    topP: 1,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                },
                qwen: {
                    model: 'qwen-72b',
                    temperature: 0.7,
                    maxTokens: 2048,
                    topP: 1,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                },
                ollama: {
                    model: 'codellama',
                    temperature: 0.7,
                    maxTokens: 2048,
                    topP: 1,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                },
                lmstudio: {
                    model: 'local-model',
                    temperature: 0.7,
                    maxTokens: 2048,
                    topP: 1,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                },
                localai: {
                    model: 'local-model',
                    temperature: 0.7,
                    maxTokens: 2048,
                    topP: 1,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                }
            },
            rateLimits: {
                enabled: true,
                maxRequestsPerMinute: 60,
                maxTokensPerMinute: 100000,
                timeWindow: 60000
            },
            errorHandling: {
                retryAttempts: 3,
                retryDelay: 1000,
                timeout: 30000
            },
            theme: {
                darkMode: true,
                fontSize: 14,
                fontFamily: 'Consolas, monospace'
            },
            shortcuts: {
                toggleChat: 'ctrl+shift+c',
                toggleComposer: 'ctrl+shift+x',
                toggleSettings: 'ctrl+shift+,',
                clearChat: 'ctrl+shift+l'
            },
            features: {
                enableAutoComplete: true,
                enableCodeAnalysis: true,
                enableDocGeneration: true,
                enableTestGeneration: true,
                enableRefactoring: true,
                enableBugFix: true
            },
            security: {
                encryptApiKeys: true,
                useLocalStorage: false,
                allowThirdPartyProviders: false
            },
            modelProvider: 'openai',
            rules: {
                rulesPath: '.smile',
                enabledRules: [
                    'code-style',
                    'naming',
                    'testing',
                    'documentation',
                    'git',
                    'architecture',
                    'security',
                    'performance'
                ],
                customRules: [],
                overrides: {}
            }
        };
    }

    public loadSettings(): ExtensionSettings {
        const config = vscode.workspace.getConfiguration(this.configurationSection);
        const defaultSettings = this.getDefaultSettings();
        
        return {
            providers: config.get('providers') || defaultSettings.providers,
            defaultProvider: config.get('defaultProvider') || defaultSettings.defaultProvider,
            apiKeys: config.get('apiKeys') || defaultSettings.apiKeys,
            models: config.get('models') || defaultSettings.models,
            rateLimits: {
                enabled: config.get('rateLimits.enabled') ?? defaultSettings.rateLimits.enabled,
                maxRequestsPerMinute: config.get('rateLimits.maxRequestsPerMinute') ?? defaultSettings.rateLimits.maxRequestsPerMinute,
                maxTokensPerMinute: config.get('rateLimits.maxTokensPerMinute') ?? defaultSettings.rateLimits.maxTokensPerMinute,
                timeWindow: config.get('rateLimits.timeWindow') ?? defaultSettings.rateLimits.timeWindow
            },
            errorHandling: {
                retryAttempts: config.get('errorHandling.retryAttempts') ?? defaultSettings.errorHandling.retryAttempts,
                retryDelay: config.get('errorHandling.retryDelay') ?? defaultSettings.errorHandling.retryDelay,
                timeout: config.get('errorHandling.timeout') ?? defaultSettings.errorHandling.timeout
            },
            theme: config.get('theme') || defaultSettings.theme,
            shortcuts: config.get('shortcuts') || defaultSettings.shortcuts,
            features: config.get('features') || defaultSettings.features,
            security: config.get('security') || defaultSettings.security,
            modelProvider: config.get('modelProvider') || defaultSettings.modelProvider,
            rules: config.get('rules') || defaultSettings.rules
        };
    }

    private watchSettings(): void {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(this.configurationSection)) {
                this.settings = this.loadSettings();
                this.onSettingsChangedEmitter.emit('settingsChanged', this.settings);
            }
        });
    }

    public onSettingsChanged(listener: (settings: ExtensionSettings) => void): void {
        this.onSettingsChangedEmitter.on('settingsChanged', listener);
    }

    public getSettings(): ExtensionSettings {
        return this.settings;
    }

    public async updateSettings(settings: Partial<ExtensionSettings>): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.configurationSection);

        for (const [key, value] of Object.entries(settings)) {
            await config.update(key, value, vscode.ConfigurationTarget.Global);
        }

        this.settings = this.loadSettings();
    }

    public getConfiguration<T>(key: string, defaultValue: T): T {
        return vscode.workspace.getConfiguration(this.configurationSection).get<T>(key, defaultValue);
    }

    public getModelProvider(): ModelProvider {
        return this.settings.modelProvider;
    }

    public async setModelProvider(provider: ModelProvider): Promise<void> {
        await this.updateSettings({ modelProvider: provider });
    }

    public getProviderSettings(provider: ModelProvider): ProviderSettings {
        return this.settings.providers[provider] || {};
    }

    public async updateProviderSettings(provider: ModelProvider, settings: Partial<ProviderSettings>): Promise<void> {
        const providers = { ...this.settings.providers };
        providers[provider] = { ...providers[provider], ...settings };
        await this.updateSettings({ providers });
    }

    public getModelSettings(): ModelSettings {
        return this.settings.models[this.settings.modelProvider];
    }

    public async updateModelSettings(settings: Partial<ModelSettings>): Promise<void> {
        const models = { ...this.settings.models };
        models[this.settings.modelProvider] = { ...models[this.settings.modelProvider], ...settings };
        await this.updateSettings({ models });
    }

    public getThemeSettings(): ThemeSettings {
        return this.settings.theme;
    }

    public async updateThemeSettings(settings: Partial<ThemeSettings>): Promise<void> {
        await this.updateSettings({ theme: { ...this.settings.theme, ...settings } });
    }

    public getShortcutSettings(): ShortcutSettings {
        return this.settings.shortcuts;
    }

    public async updateShortcutSettings(settings: Partial<ShortcutSettings>): Promise<void> {
        await this.updateSettings({ shortcuts: { ...this.settings.shortcuts, ...settings } });
    }

    public getRateLimitSettings(): RateLimitSettings {
        return this.settings.rateLimits;
    }

    public async updateRateLimitSettings(settings: Partial<RateLimitSettings>): Promise<void> {
        await this.updateSettings({ rateLimits: { ...this.settings.rateLimits, ...settings } });
    }

    public getErrorHandlingSettings(): ErrorHandlingSettings {
        return this.settings.errorHandling;
    }

    public async updateErrorHandlingSettings(settings: Partial<ErrorHandlingSettings>): Promise<void> {
        await this.updateSettings({ errorHandling: { ...this.settings.errorHandling, ...settings } });
    }

    public getSecuritySettings(): SecuritySettings {
        return this.settings.security;
    }

    public async updateSecuritySettings(settings: Partial<SecuritySettings>): Promise<void> {
        await this.updateSettings({ security: { ...this.settings.security, ...settings } });
    }

    public getFeatureSettings(): FeatureSettings {
        return this.settings.features;
    }

    public async updateFeatureSettings(settings: Partial<FeatureSettings>): Promise<void> {
        await this.updateSettings({ features: { ...this.settings.features, ...settings } });
    }

    public async setApiKey(provider: ModelProvider, apiKey: string): Promise<void> {
        const apiKeys = { ...this.settings.apiKeys };
        apiKeys[provider] = apiKey;
        await this.updateSettings({ apiKeys });
    }

    public async refreshProviderModels(provider: ModelProvider): Promise<void> {
        // Implementation will be added later
    }
} 