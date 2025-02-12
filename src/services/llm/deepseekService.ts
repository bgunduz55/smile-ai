import * as vscode from 'vscode';
import { OpenAI } from 'openai';
import { IAIService, AIModelConfig } from '../../domain/interfaces/IAIService';
import { Message } from '../../domain/entities/Message';
import { SettingsService } from '../settingsService';
import { RateLimiterService } from '../rateLimiterService';
import { ErrorHandlingService, APIError } from '../errorHandlingService';
import { v4 as uuidv4 } from 'uuid';
import { BaseLLMService } from './llmService';
import { LLMService } from './llmService';

export class DeepseekService implements LLMService {
    private client: OpenAI;
    private currentModel: string = 'deepseek-coder-33b-instruct';

    constructor(
        private readonly settingsService: SettingsService,
        private readonly rateLimiterService: RateLimiterService,
        private readonly errorHandlingService: ErrorHandlingService
    ) {
        const apiKey = this.settingsService.getConfiguration<string>('deepseek.apiKey', '');
        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://api.deepseek.com/v1'
        });
    }

    public async getAvailableModels(): Promise<string[]> {
        try {
            const models = await this.client.models.list();
            return models.data
                .filter(model => model.id.startsWith('deepseek'))
                .map(model => model.id);
        } catch (error) {
            await this.errorHandlingService.handleError(error);
            return [];
        }
    }

    public async setModel(model: string): Promise<void> {
        this.currentModel = model;
    }

    public async processTask(task: string): Promise<string> {
        await this.rateLimiterService.checkRateLimit(task.length);
        
        try {
            const completion = await this.client.chat.completions.create({
                model: this.currentModel,
                messages: [{ role: 'user', content: task }],
                temperature: 0.7,
                max_tokens: 2000
            });

            return completion.choices[0]?.message?.content || '';
        } catch (error) {
            await this.errorHandlingService.handleError(error);
            throw error;
        }
    }

    public dispose(): void {
        // Clean up resources if needed
    }

    private estimateTokens(text: string): number {
        // Deepseek için yaklaşık token hesaplama
        // Ortalama olarak her 4 karaktere 1 token
        return Math.ceil(text.length / 4);
    }

    public async generateResponse(prompt: string): Promise<string> {
        try {
            await this.rateLimiterService.checkRateLimit(prompt.length);

            const settings = this.settingsService.getSettings();
            const modelSettings = settings.models.deepseek;
            const apiKey = settings.apiKeys.deepseek;

            if (!apiKey) {
                throw new Error('Deepseek API key not found');
            }

            const config: AIModelConfig = {
                model: modelSettings.model,
                temperature: modelSettings.temperature,
                maxTokens: modelSettings.maxTokens,
                topP: modelSettings.topP,
                frequencyPenalty: modelSettings.frequencyPenalty,
                presencePenalty: modelSettings.presencePenalty,
                provider: 'deepseek'
            };

            const response = await this.makeRequest(prompt, config);
            await this.rateLimiterService.incrementCounters(response.length);

            return response;
        } catch (error) {
            await this.errorHandlingService.handleError(error);
            throw error;
        }
    }

    public async streamResponse<T>(prompt: string, onUpdate: (chunk: string) => void): Promise<T> {
        try {
            await this.rateLimiterService.checkRateLimit(prompt.length);

            const settings = this.settingsService.getSettings();
            const modelSettings = settings.models.deepseek;
            const apiKey = settings.apiKeys.deepseek;

            if (!apiKey) {
                throw new Error('Deepseek API key not found');
            }

            const config: AIModelConfig = {
                model: modelSettings.model,
                temperature: modelSettings.temperature,
                maxTokens: modelSettings.maxTokens,
                topP: modelSettings.topP,
                frequencyPenalty: modelSettings.frequencyPenalty,
                presencePenalty: modelSettings.presencePenalty,
                provider: 'deepseek'
            };

            let fullResponse = '';
            const response = await this.makeStreamingRequest(prompt, config, (chunk: string) => {
                fullResponse += chunk;
                onUpdate(chunk);
            });

            await this.rateLimiterService.incrementCounters(fullResponse.length);

            return response as T;
        } catch (error) {
            await this.errorHandlingService.handleError(error);
            throw error;
        }
    }

    private async makeRequest(prompt: string, config: AIModelConfig): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: config.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: config.temperature,
            max_tokens: config.maxTokens,
            top_p: config.topP,
            frequency_penalty: config.frequencyPenalty,
            presence_penalty: config.presencePenalty
        });

        return response.choices[0]?.message?.content || '';
    }

    private async makeStreamingRequest(
        prompt: string,
        config: AIModelConfig,
        onChunk: (chunk: string) => void
    ): Promise<string> {
        const stream = await this.client.chat.completions.create({
            model: config.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: config.temperature,
            max_tokens: config.maxTokens,
            top_p: config.topP,
            frequency_penalty: config.frequencyPenalty,
            presence_penalty: config.presencePenalty,
            stream: true
        });

        let fullResponse = '';
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                fullResponse += content;
                onChunk(content);
            }
        }

        return fullResponse;
    }

    async validateConfig(config: AIModelConfig): Promise<boolean> {
        const models = await this.getAvailableModels();
        return models.includes(config.model);
    }

    public async updateApiKey(apiKey: string): Promise<void> {
        await this.settingsService.setApiKey('deepseek', apiKey);
        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://api.deepseek.com/v1'
        });
    }

    public async updateEndpoint(endpoint: string): Promise<void> {
        await this.settingsService.updateProviderSettings('deepseek', { endpoint });
        this.client = new OpenAI({
            baseURL: endpoint,
            apiKey: this.settingsService.getConfiguration<string>('deepseek.apiKey', ''),
            timeout: this.settingsService.getErrorHandlingSettings().timeout,
            maxRetries: 0 // Kendi retry mekanizmamızı kullanacağız
        });
    }
} 