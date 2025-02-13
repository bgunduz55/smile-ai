import axios from 'axios';
import * as vscode from 'vscode';
import {
    AIConfig,
    AIRequest,
    AIResponse,
    AIContext,
    AIMessage
} from './types';

export class AIEngine {
    private config: AIConfig;
    private context: AIContext;

    constructor(config: AIConfig) {
        this.config = config;
        this.context = { messages: [] };
    }

    public async chat(message: string): Promise<AIResponse> {
        try {
            const response = await axios.post(
                `${this.config.provider.apiEndpoint}/api/chat`,
                {
                    model: this.config.provider.modelName,
                    messages: [{ role: 'user', content: message }],
                    max_tokens: this.config.maxTokens,
                    temperature: this.config.temperature
                }
            );

            return {
                message: response.data.choices[0].message.content,
                codeChanges: response.data.choices[0].code_changes
            };
        } catch (error: any) {
            console.error('AI Engine Error:', error);
            throw new Error(`AI Engine Error: ${error.message}`);
        }
    }

    public async generateResponse(request: AIRequest): Promise<AIResponse> {
        try {
            const messages = this.prepareMessages(request);
            const response = await this.callAIProvider(messages);
            this.updateContext(request, response);
            return response;
        } catch (error) {
            console.error('Error generating response:', error);
            throw new Error('Failed to generate response');
        }
    }

    private prepareMessages(request: AIRequest): AIMessage[] {
        const messages: AIMessage[] = [];

        // Add system prompt if provided
        if (request.systemPrompt) {
            messages.push({
                role: 'system',
                content: request.systemPrompt,
                timestamp: Date.now()
            });
        }

        // Add context messages
        messages.push(...this.context.messages);

        // Add current request
        messages.push({
            role: 'user',
            content: request.prompt,
            timestamp: Date.now()
        });

        return messages;
    }

    private async callAIProvider(messages: AIMessage[]): Promise<AIResponse> {
        const { provider, maxTokens, temperature } = this.config;

        try {
            const response = await axios.post(provider.apiEndpoint + '/api/generate', {
                model: provider.modelName,
                messages: messages.map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                max_tokens: maxTokens,
                temperature: temperature
            });

            return {
                message: response.data.choices[0].message.content,
                codeChanges: response.data.choices[0].code_changes
            };
        } catch (error) {
            console.error('Error calling AI provider:', error);
            throw new Error('Failed to communicate with AI provider');
        }
    }

    private updateContext(request: AIRequest, response: AIResponse): void {
        // Add user message to context
        this.context.messages.push({
            role: 'user',
            content: request.prompt,
            timestamp: Date.now()
        });

        // Add assistant response to context
        this.context.messages.push({
            role: 'assistant',
            content: response.message,
            timestamp: Date.now()
        });

        // Maintain context size (keep last N messages)
        const maxContextMessages = 10;
        if (this.context.messages.length > maxContextMessages) {
            this.context.messages = this.context.messages.slice(-maxContextMessages);
        }
    }

    public clearContext(): void {
        this.context = { messages: [] };
    }

    public getContext(): AIContext {
        return this.context;
    }

    public updateConfig(config: Partial<AIConfig>): void {
        this.config = { ...this.config, ...config };
    }
} 