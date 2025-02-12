import * as vscode from 'vscode';
import OpenAI from 'openai';
import { IAIService, AIModelConfig } from '../../domain/interfaces/IAIService';
import { Message } from '../../domain/entities/Message';
import { SettingsService } from '../settingsService';
import { RateLimiterService } from '../rateLimiterService';
import { ErrorHandlingService, APIError } from '../errorHandlingService';
import { v4 as uuidv4 } from 'uuid';
import { BaseLLMService } from './llmService';

interface LocalAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

export class LocalAIService extends BaseLLMService {
    private endpoint: string;
    private currentModel: string = 'local-model';

    constructor(
        settingsService: SettingsService,
        rateLimiter: RateLimiterService,
        errorHandler: ErrorHandlingService
    ) {
        super(settingsService, rateLimiter, errorHandler);
        this.endpoint = this.settingsService.getConfiguration<string>('localai.endpoint', 'http://localhost:8080/v1');
    }

    public async getAvailableModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.endpoint}/models`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json() as { data: Array<{ id: string }> };
            return data.data.map(model => model.id);
        } catch (error) {
            this.errorHandler.handleError(error, 'Failed to fetch LocalAI models');
            return [];
        }
    }

    public async setModel(model: string): Promise<void> {
        this.currentModel = model;
    }

    public async processTask(task: string): Promise<string> {
        await this.rateLimiter.checkRateLimit();
        
        try {
            const response = await fetch(`${this.endpoint}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.currentModel,
                    messages: [{ role: 'user', content: task }],
                    temperature: 0.7,
                    max_tokens: 2000
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json() as LocalAIResponse;
            return data.choices[0]?.message?.content || '';
        } catch (error) {
            this.errorHandler.handleError(error, 'Failed to process LocalAI task');
            throw error;
        }
    }

    public dispose(): void {
        // Clean up resources if needed
    }
} 