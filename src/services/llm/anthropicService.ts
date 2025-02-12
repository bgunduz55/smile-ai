import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { IAIService, AIModelConfig } from '../../domain/interfaces/IAIService';
import { Message } from '../../domain/entities/Message';
import { SettingsService } from '../settingsService';
import { RateLimiterService } from '../rateLimiterService';
import { ErrorHandlingService, APIError } from '../errorHandlingService';
import { v4 as uuidv4 } from 'uuid';
import { BaseLLMService } from './llmService';
import { ExtensionSettings } from '../../models/settings';

export class AnthropicService extends BaseLLMService {
    private client: Anthropic;
    private currentModel: string;
    protected readonly settingsService: SettingsService;

    constructor(
        settingsService: SettingsService,
        rateLimiter: RateLimiterService,
        errorHandler: ErrorHandlingService
    ) {
        super(settingsService, rateLimiter, errorHandler);
        this.settingsService = settingsService;
        const settings = settingsService.getSettings();
        const apiKey = settings.apiKeys['anthropic'];
        if (!apiKey) {
            throw new Error('Anthropic API key not found in settings');
        }

        this.client = new Anthropic({ apiKey });
        this.currentModel = settings.models['anthropic'].model;
    }

    public async generateResponse(prompt: string): Promise<string> {
        try {
            await this.rateLimiter.checkRateLimit(prompt.length);

            const response = await this.client.messages.create({
                model: this.currentModel,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1000
            });

            const content = response.content.find(c => c.type === 'text')?.text || '';
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

            const stream = await this.client.messages.create({
                model: this.currentModel,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1000,
                stream: true
            });

            let totalLength = 0;
            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    const content = chunk.delta.text;
                    if (content) {
                        totalLength += content.length;
                        onUpdate(content);
                    }
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
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
            'claude-2.1',
            'claude-2.0',
            'claude-instant-1.2'
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

    private estimateTokens(text: string): number {
        // Claude'un token hesaplama yaklaşımı:
        // Ortalama olarak her 4 karaktere 1 token
        return Math.ceil(text.length / 4);
    }

    public async updateApiKey(apiKey: string): Promise<void> {
        await this.settingsService.setApiKey('anthropic', apiKey);
        this.client = new Anthropic({ apiKey });
    }
} 