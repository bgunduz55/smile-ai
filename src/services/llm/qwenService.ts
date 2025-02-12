import * as vscode from 'vscode';
import { BaseLLMService } from './llmService';
import { SettingsService } from '../settingsService';
import { RateLimiterService } from '../rateLimiterService';
import { ErrorHandlingService } from '../errorHandlingService';
import { OpenAI } from 'openai';

export class QwenService extends BaseLLMService {
    private client: OpenAI;
    private currentModel: string;

    constructor(
        settingsService: SettingsService,
        rateLimiter: RateLimiterService,
        errorHandler: ErrorHandlingService
    ) {
        super(settingsService, rateLimiter, errorHandler);
        const settings = settingsService.getSettings();
        const endpoint = settings.providers.qwen.endpoint || 'https://dashscope.aliyuncs.com/api/v1';
        const apiKey = settings.apiKeys.qwen;
        
        if (!apiKey) {
            throw new Error('Qwen API key not found in settings');
        }

        this.client = new OpenAI({
            baseURL: endpoint,
            apiKey
        });

        this.currentModel = settings.models.qwen.model;
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
        return [
            'qwen2.5-turbo',
            'qwen2.5-pro',
            'qwen1.5-72b',
            'qwen1.5-14b'
        ];
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