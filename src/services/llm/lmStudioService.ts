import * as vscode from 'vscode';
import { BaseLLMService } from './llmService';
import { SettingsService } from '../settingsService';
import { RateLimiterService } from '../rateLimiterService';
import { ErrorHandlingService } from '../errorHandlingService';
import { OpenAI } from 'openai';

export class LMStudioService extends BaseLLMService {
    private client: OpenAI;
    private currentModel: string;

    constructor(
        settingsService: SettingsService,
        rateLimiter: RateLimiterService,
        errorHandler: ErrorHandlingService
    ) {
        super(settingsService, rateLimiter, errorHandler);
        const settings = settingsService.getSettings();
        const endpoint = settings.providers.lmstudio.endpoint || 'http://localhost:1234/v1';
        
        this.client = new OpenAI({
            baseURL: endpoint,
            apiKey: 'not-needed'
        });

        this.currentModel = settings.models.lmstudio.model;
    }

    public async generateResponse(prompt: string): Promise<string> {
        try {
            await this.rateLimiter.checkRateLimit(prompt.length);

            const response = await this.client.chat.completions.create({
                model: this.currentModel,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 1000
            });

            const content = response.choices[0]?.message?.content || '';
            await this.rateLimiter.incrementCounters(content.length);
            return content;
        } catch (error) {
            await this.errorHandler.handleError(error);
            throw error;
        }
    }

    public async streamResponse<T>(prompt: string, onUpdate: (chunk: string) => void): Promise<T> {
        try {
            await this.rateLimiter.checkRateLimit(prompt.length);

            const stream = await this.client.chat.completions.create({
                model: this.currentModel,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 1000,
                stream: true
            });

            let totalLength = 0;
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    totalLength += content.length;
                    onUpdate(content);
                }
            }

            await this.rateLimiter.incrementCounters(totalLength);
            return {} as T;
        } catch (error) {
            await this.errorHandler.handleError(error);
            throw error;
        }
    }

    public async getAvailableModels(): Promise<string[]> {
        try {
            const models = await this.client.models.list();
            return models.data.map(model => model.id);
        } catch (error) {
            console.error('Error fetching models:', error);
            return ['default-model'];
        }
    }

    public async setModel(model: string): Promise<void> {
        this.currentModel = model;
    }

    public async processTask(task: string): Promise<string> {
        return this.generateResponse(task);
    }

    public dispose(): void {
        // Clean up resources if needed
    }
} 