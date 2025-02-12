import { ModelProvider } from '../../models/settings';
import { IAIService } from '../../domain/interfaces/IAIService';
import { SettingsService } from '../settingsService';
import { RateLimiterService } from '../rateLimiterService';
import { ErrorHandlingService } from '../errorHandlingService';
import { AnthropicService } from './anthropicService';
import { OpenAIService } from './openaiService';
import { OllamaService } from './ollamaService';
import { LMStudioService } from './lmStudioService';
import { LocalAIService } from './localAIService';
import { DeepseekService } from './deepseekService';
import { QwenService } from './qwenService';

export type AIProvider = ModelProvider;

export class AIServiceFactory {
    private static instance: AIServiceFactory;
    private currentProvider: ModelProvider;
    private services: Map<ModelProvider, IAIService>;

    private constructor(
        private readonly settingsService: SettingsService,
        private readonly rateLimiterService: RateLimiterService,
        private readonly errorHandlingService: ErrorHandlingService
    ) {
        this.services = new Map();
        this.currentProvider = this.settingsService.getSettings().defaultProvider;
    }

    public static getInstance(
        settingsService: SettingsService,
        rateLimiterService: RateLimiterService,
        errorHandlingService: ErrorHandlingService
    ): AIServiceFactory {
        if (!AIServiceFactory.instance) {
            AIServiceFactory.instance = new AIServiceFactory(
                settingsService,
                rateLimiterService,
                errorHandlingService
            );
        }
        return AIServiceFactory.instance;
    }

    public async getService(provider: ModelProvider): Promise<IAIService> {
        if (this.services.has(provider)) {
            return this.services.get(provider)!;
        }

        const service = await this.createService(provider);
        this.services.set(provider, service);
        return service;
    }

    public async createService(provider: ModelProvider): Promise<IAIService> {
        const settings = this.settingsService.getSettings();

        let service: IAIService;

        switch (provider) {
            case 'openai':
                service = new OpenAIService(settings);
                break;
            case 'anthropic':
                service = new AnthropicService(
                    this.settingsService,
                    this.rateLimiterService,
                    this.errorHandlingService
                );
                break;
            case 'lmstudio':
                service = new LMStudioService(
                    this.settingsService,
                    this.rateLimiterService,
                    this.errorHandlingService
                );
                break;
            case 'localai':
                service = new LocalAIService(
                    this.settingsService,
                    this.rateLimiterService,
                    this.errorHandlingService
                );
                break;
            case 'deepseek':
                service = new DeepseekService(
                    this.settingsService,
                    this.rateLimiterService,
                    this.errorHandlingService
                );
                break;
            case 'qwen':
                service = new QwenService(
                    this.settingsService,
                    this.rateLimiterService,
                    this.errorHandlingService
                );
                break;
            case 'ollama':
                service = new OllamaService(
                    this.settingsService,
                    this.rateLimiterService,
                    this.errorHandlingService
                );
                break;
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }

        this.currentProvider = provider;
        return service;
    }

    public async getDefaultService(): Promise<IAIService> {
        const settings = this.settingsService.getSettings();
        const defaultProvider = settings.defaultProvider;
        return this.createService(defaultProvider);
    }

    public getCurrentProvider(): ModelProvider {
        return this.currentProvider;
    }

    public async validateProvider(provider: ModelProvider): Promise<boolean> {
        const settings = this.settingsService.getSettings();
        const providerSettings = settings.providers[provider];
        
        if (!providerSettings) {
            return false;
        }

        if (providerSettings.requiresApiKey) {
            const apiKey = settings.apiKeys[provider];
            if (!apiKey) {
                return false;
            }
        }

        return true;
    }

    public async getAvailableProviders(): Promise<ModelProvider[]> {
        const settings = this.settingsService.getSettings();
        return Object.keys(settings.providers) as ModelProvider[];
    }
} 