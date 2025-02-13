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
            let endpoint = '';
            let requestBody = {};

            if (provider.name === 'ollama') {
                endpoint = `${provider.apiEndpoint}/api/chat`;
                requestBody = {
                    model: provider.modelName,
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    stream: false
                };
            } else if (provider.name === 'lmstudio') {
                endpoint = `${provider.apiEndpoint}/v1/chat/completions`;
                requestBody = {
                    model: provider.modelName,
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    max_tokens: maxTokens,
                    temperature: temperature,
                    stream: false
                };
            } else {
                throw new Error(`Unsupported provider: ${provider.name}`);
            }

            const response = await axios.post(endpoint, requestBody, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (provider.name === 'ollama') {
                return {
                    message: response.data.message.content,
                    codeChanges: response.data.code_changes
                };
            } else if (provider.name === 'lmstudio') {
                return {
                    message: response.data.choices[0].message.content,
                    codeChanges: response.data.choices[0].code_changes
                };
            } else {
                throw new Error(`Unsupported provider: ${provider.name}`);
            }
        } catch (error: any) {
            console.error('Error calling AI provider:', error);
            if (error.response) {
                throw new Error(`AI provider error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.request) {
                throw new Error('Failed to connect to AI provider. Please check if the service is running.');
            } else {
                throw new Error(`Failed to communicate with AI provider: ${error.message}`);
            }
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