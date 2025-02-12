import OpenAI from 'openai';
import { ExtensionSettings } from '../../models/settings';
import { LLMService } from './llmService';

export class OpenAIService implements LLMService {
    private client: OpenAI;
    private currentModel: string;

    constructor(settings: ExtensionSettings) {
        const apiKey = settings.apiKeys['openai'];
        if (!apiKey) {
            throw new Error('OpenAI API key not found in settings');
        }

        this.client = new OpenAI({ apiKey });
        this.currentModel = settings.models['openai'].model;
    }

    public async generateResponse(prompt: string): Promise<string> {
        try {
            const response = await this.client.chat.completions.create({
                model: this.currentModel,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 1000
            });

            return response.choices[0]?.message?.content || '';
        } catch (error) {
            console.error('Error generating response:', error);
            throw error;
        }
    }

    public async streamResponse<T>(prompt: string, onUpdate: (chunk: string) => void): Promise<T> {
        try {
            const stream = await this.client.chat.completions.create({
                model: this.currentModel,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 1000,
                stream: true
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    onUpdate(content);
                }
            }

            return {} as T;
        } catch (error) {
            console.error('Error streaming response:', error);
            throw error;
        }
    }

    public async getAvailableModels(): Promise<string[]> {
        try {
            const models = await this.client.models.list();
            return models.data
                .filter(model => model.id.startsWith('gpt'))
                .map(model => model.id);
        } catch (error) {
            console.error('Error fetching models:', error);
            throw error;
        }
    }

    public async setModel(model: string): Promise<void> {
        this.currentModel = model;
    }

    public async processTask(task: string): Promise<string> {
        try {
            const response = await this.client.chat.completions.create({
                model: this.currentModel,
                messages: [{ role: 'user', content: task }],
                temperature: 0.3,
                max_tokens: 2000
            });

            return response.choices[0]?.message?.content || '';
        } catch (error) {
            console.error('Error processing task:', error);
            throw error;
        }
    }

    public dispose(): void {
        // Clean up resources if needed
    }
} 