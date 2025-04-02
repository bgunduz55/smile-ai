import axios from 'axios';
import * as vscode from 'vscode';
import { AIConfig, AIMessage, AIRequest, AIResponse } from './types';

export class AIEngine {
    private config: AIConfig;
    private conversationHistory: AIMessage[] = [];

    constructor(config: AIConfig) {
        this.config = config;
    }

    public async testConnection(): Promise<boolean> {
        try {
            const response = await fetch(this.config.provider.apiEndpoint + '/api/health', {
                method: 'GET'
            });
            return response.ok;
        } catch (error) {
            console.error('Model bağlantı hatası:', error);
            return false;
        }
    }

    public async sendRequest(request: AIRequest): Promise<AIResponse> {
        try {
            if (!this.config.provider.apiEndpoint) {
                throw new Error('API endpoint yapılandırılmamış');
            }

            const response = await fetch(this.config.provider.apiEndpoint + '/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.config.provider.modelName,
                    messages: request.messages,
                    max_tokens: this.config.maxTokens,
                    temperature: this.config.temperature
                })
            });

            if (!response.ok) {
                throw new Error(`AI model yanıt hatası: ${response.statusText}`);
            }

            const data = await response.json() as { message: string };
            return {
                message: data.message
            };
        } catch (error) {
            if (error instanceof Error) {
                console.error('AI isteği hatası:', error);
                vscode.window.showErrorMessage(`AI isteği başarısız: ${error.message}`);
            }
            throw error;
        }
    }

    public updateConfig(newConfig: Partial<AIConfig>) {
        this.config = { ...this.config, ...newConfig };
    }

    public getConfig(): AIConfig {
        return this.config;
    }

    public async generateResponse(request: AIRequest): Promise<AIResponse> {
        try {
            const messages = request.messages;
            const response = await this.callAIProvider(messages);
            this.updateContext(request, response);
            return response;
        } catch (error) {
            console.error('Error generating response:', error);
            throw new Error('Failed to generate response');
        }
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
                    message: response.data.message.content
                };
            } else if (provider.name === 'lmstudio') {
                return {
                    message: response.data.choices[0].message.content
                };
            } else {
                throw new Error(`Unsupported provider: ${provider.name}`);
            }
        } catch (error: any) {
            console.error('Error calling AI provider:', error);
            const providerName = this.config.provider.name;
            const endpoint = this.config.provider.apiEndpoint;
            const modelName = this.config.provider.modelName;
            let userMessage = `Failed to get response from ${providerName}.`;

            if (error.response) {
                const status = error.response.status;
                const dataError = error.response.data?.error;
                userMessage = `Error from ${providerName} (Status ${status}): ${dataError || error.response.statusText}.`;
                if (status === 404 && dataError?.includes('model')) {
                     userMessage += `\nPlease ensure model '${modelName}' is available at ${endpoint}.`;
                } else if (status === 500) {
                    userMessage += `\nThere might be an issue with the ${providerName} server itself.`;
                } else {
                    userMessage += `\nPlease check your configuration for ${providerName}.`;
                }
            } else if (error.request) {
                userMessage = `Could not connect to ${providerName} at ${endpoint}.`;
                userMessage += `\nPlease ensure the ${providerName} service is running and the API endpoint in settings is correct.`;
            } else {
                userMessage = `Failed to communicate with ${providerName}: ${error.message}.`;
                userMessage += `\nThis might be a configuration issue or an unexpected error.`;
            }
            throw new Error(userMessage);
        }
    }

    private updateContext(request: AIRequest, response: AIResponse): void {
        this.conversationHistory.push(...request.messages);

        this.conversationHistory.push({
            role: 'assistant',
            content: response.message,
            timestamp: Date.now()
        });

        const maxContextMessages = 10;
        if (this.conversationHistory.length > maxContextMessages) {
            this.conversationHistory = this.conversationHistory.slice(-maxContextMessages);
        }
    }

    public clearContext(): void {
        this.conversationHistory = [];
    }

    public getContext(): AIMessage[] {
        return this.conversationHistory;
    }

    public async generateEmbeddings(text: string): Promise<number[]> {
        const { provider } = this.config;
        const embeddingModelName = this.config.embeddingModelName || provider.modelName;
        const endpoint = provider.apiEndpoint;

        if (provider.name !== 'ollama') {
            throw new Error(`Embeddings are currently only supported for Ollama provider, not ${provider.name}.`);
        }

        const embeddingEndpoint = `${endpoint}/api/embeddings`;
        const requestBody = {
            model: embeddingModelName,
            prompt: text
        };

        try {
            const response = await axios.post(embeddingEndpoint, requestBody, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data?.embedding && Array.isArray(response.data.embedding)) {
                return response.data.embedding;
            } else {
                throw new Error('Invalid response format received from embedding endpoint.');
            }
        } catch (error: any) {
            console.error('Error generating embeddings:', error);
            const providerName = provider.name;
            let userMessage = `Failed to generate embeddings from ${providerName}.`;

            if (error.response) {
                const status = error.response.status;
                const dataError = error.response.data?.error;
                userMessage = `Error from ${providerName} embedding endpoint (Status ${status}): ${dataError || error.response.statusText}.`;
                if (status === 404) {
                     userMessage += `\nPlease ensure embedding model '${embeddingModelName}' is available/pulled in Ollama at ${endpoint}.`;
                } else {
                    userMessage += `\nPlease check your Ollama setup and model name.`;
                }
            } else if (error.request) {
                userMessage = `Could not connect to ${providerName} at ${endpoint} for embeddings.`;
                userMessage += `\nPlease ensure the ${providerName} service is running.`;
            } else {
                userMessage = `Failed to communicate with ${providerName} for embeddings: ${error.message}.`;
            }
            throw new Error(userMessage);
        }
    }

    public async generateEmbedding(text: string): Promise<number[]> {
        const { provider } = this.config;
        if (!provider.name || !provider.apiEndpoint) {
            throw new Error('AI provider configuration is incomplete');
        }

        try {
            const response = await axios.post(`${provider.apiEndpoint}/embeddings`, {
                model: this.config.embeddingModelName || provider.modelName,
                input: text
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            return response.data.data[0].embedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
            throw new Error('Failed to generate embedding');
        }
    }
} 