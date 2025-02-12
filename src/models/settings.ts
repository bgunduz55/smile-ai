/**
 * Model provider types supported by the extension
 */
export type ModelProvider = 'openai' | 'anthropic' | 'deepseek' | 'qwen' | 'ollama' | 'lmstudio' | 'localai';

/**
 * OpenAI model types
 */
export type OpenAIModel = 'gpt-4-turbo' | 'gpt-3.5-turbo' | 'gpt-4o' | 'gpt-4o-mini' | string;

/**
 * Anthropic model types
 */
export type AnthropicModel = 'claude-3-opus' | 'claude-3-sonnet' | 'claude-3.5-sonnet' | string;

/**
 * Interface for model specific settings
 */
export interface ModelSettings {
    model: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
}

/**
 * Interface for provider specific settings
 */
export interface ProviderSettings {
    requiresApiKey?: boolean;
    isLocal?: boolean;
    endpoint?: string;
    models: string[];
    modelMetadata?: {
        [key: string]: {
            name: string;
            details: any;
            lastUpdated: string;
        };
    };
}

/**
 * Interface for theme settings
 */
export interface ThemeSettings {
    darkMode: boolean;
    fontSize: number;
    fontFamily: string;
    customCSS?: string;
}

/**
 * Interface for shortcut settings
 */
export interface ShortcutSettings {
    toggleChat: string;
    toggleComposer: string;
    toggleSettings: string;
    clearChat: string;
}

/**
 * Interface for rate limit settings
 */
export interface RateLimitSettings {
    enabled: boolean;
    maxRequestsPerMinute: number;
    maxTokensPerMinute: number;
    timeWindow: number;
}

/**
 * Interface for error handling settings
 */
export interface ErrorHandlingSettings {
    retryAttempts: number;
    retryDelay: number;
    timeout: number;
}

/**
 * Interface for security settings
 */
export interface SecuritySettings {
    encryptApiKeys: boolean;
    useLocalStorage: boolean;
    allowThirdPartyProviders: boolean;
}

/**
 * Interface for feature settings
 */
export interface FeatureSettings {
    enableAutoComplete: boolean;
    enableCodeAnalysis: boolean;
    enableDocGeneration: boolean;
    enableTestGeneration: boolean;
    enableRefactoring: boolean;
    enableBugFix: boolean;
}

/**
 * Interface for rule settings
 */
export interface RuleSettings {
    rulesPath: string;
    enabledRules: string[];
    customRules: {
        name: string;
        path: string;
        description: string;
    }[];
    overrides: Record<string, any>;
}

/**
 * Main settings interface for the extension
 */
export interface ExtensionSettings {
    providers: Record<ModelProvider, ProviderSettings>;
    defaultProvider: ModelProvider;
    apiKeys: Record<string, string>;
    models: Record<ModelProvider, ModelSettings>;
    rateLimits: RateLimitSettings;
    errorHandling: ErrorHandlingSettings;
    theme: ThemeSettings;
    shortcuts: ShortcutSettings;
    features: FeatureSettings;
    security: SecuritySettings;
    modelProvider: ModelProvider;
    rules: RuleSettings;
} 