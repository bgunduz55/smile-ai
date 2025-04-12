import axios from 'axios';
import { AIMessage, AIRequest, AIResponse } from './types';
import { CodebaseIndex } from '../indexing/CodebaseIndex';
import * as vscode from 'vscode';

export interface AIEngineConfig {
    provider: {
        name: string;
        modelName: string;
        apiEndpoint: string;
    };
    maxTokens?: number;
    temperature?: number;
    embeddingModelName?: string;
}

export interface ProcessMessageOptions {
    context?: any;
    attachments?: Array<{type: 'file' | 'folder', path: string}>;
    options?: {
        includeImports?: boolean;
        includeTips?: boolean;
        includeTests?: boolean;
    };
    codebaseIndex?: CodebaseIndex;
}

export interface ProcessOptions {
    options?: any;
    codebaseIndex?: any;
}

export class AIEngine {
    private config: AIEngineConfig;
    private conversationHistory: AIMessage[] = [];

    constructor(config: AIEngineConfig) {
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

    public async processMessage(message: string, options: ProcessOptions): Promise<string> {
        try {
            // Pass options to sendRequest
            return await this.sendRequest(message, options, 'chat');
        } catch (error) {
            console.error('Error in processMessage:', error);
            // Provide a fallback response so the chat UI at least works
            return `I received your message: "${message}"\n\nHowever, I couldn't connect to the AI provider. Please make sure Ollama is running at ${this.config.provider.apiEndpoint} and the model ${this.config.provider.modelName} is available.`;
        }
    }

    public async processAgentMessage(message: string, options: ProcessOptions): Promise<string> {
        // Agent mode processing - more autonomous and can take actions
        return await this.sendRequest(message, options, 'agent');
    }

    public async processAskMessage(message: string, options: ProcessOptions): Promise<string> {
        // Ask mode processing - focused on answering questions about code
        return await this.sendRequest(message, options, 'ask');
    }

    private async sendRequest(message: string, options: ProcessOptions, mode: 'chat' | 'agent' | 'ask'): Promise<string> {
        try {
            console.log(`Sending ${mode} request to ${this.config.provider.name} at ${this.config.provider.apiEndpoint}`);
            
            // Check if we're using Ollama and use the correct endpoint
            let endpoint = this.config.provider.apiEndpoint;
            
            if (this.config.provider.name === 'ollama') {
                endpoint = `${this.config.provider.apiEndpoint}/api/chat`;
            } else if (this.config.provider.name === 'lmstudio') {
                endpoint = `${this.config.provider.apiEndpoint}/v1/chat/completions`;
            }
            
            // Construct the request body with options
            const requestBody = {
                model: this.config.provider.modelName,
                messages: [
                    {
                        role: 'system',
                        content: this.getSystemPrompt(mode)
                    },
                    {
                        role: 'user',
                        content: message
                    }
                ],
                max_tokens: this.config.maxTokens || 2048,
                temperature: this.config.temperature || 0.7,
                options: options.options || {},
                codebaseIndex: options.codebaseIndex || null
            };

            console.log('Request body:', JSON.stringify(requestBody));

            // Try to make API request with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            try {
                // Make the API request
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`API request failed: ${response.statusText}`);
                }

                const data = await response.json();
                
                // Process response based on provider
                if (this.config.provider.name === 'ollama') {
                    return data.message?.content || 'No response content received';
                } else {
                    return data.choices?.[0]?.message?.content || 'No response content received';
                }
            } catch (fetchError) {
                console.error('Fetch error:', fetchError);
                // Provide a fallback response
                return `I received your request in ${mode} mode, but I couldn't connect to the AI provider.\n\nPlease make sure ${this.config.provider.name} is running at ${this.config.provider.apiEndpoint} with the model "${this.config.provider.modelName}" available.`;
            } finally {
                clearTimeout(timeoutId);
            }
        } catch (error) {
            console.error('Error in sendRequest:', error);
            
            // Always return a helpful response instead of throwing
            return `I received your message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"\n\nHowever, there was an error processing your request. ${error instanceof Error ? error.message : 'Please try again later.'}`;
        }
    }

    private getSystemPrompt(mode: 'chat' | 'agent' | 'ask'): string {
        switch (mode) {
            case 'agent':
                return `You are an AI coding agent that can autonomously perform tasks. You can:
                - Analyze code and suggest improvements
                - Create new files and implement features
                - Debug issues and fix problems
                - Refactor code following best practices
                Please be proactive and take initiative when helping the user.`;
            
            case 'ask':
                return `You are an AI assistant focused on answering questions about code. You:
                - Provide clear and concise explanations
                - Use code examples when relevant
                - Explain concepts in depth when needed
                - Reference documentation and best practices
                Focus on helping users understand their code better.`;
            
            default:
                return `You are an AI coding assistant that helps with programming tasks. You can:
                - Write and modify code
                - Answer questions
                - Provide suggestions
                - Help with debugging
                Aim to be helpful while following the user's lead.`;
        }
    }

    public updateConfig(newConfig: Partial<AIEngineConfig>) {
        this.config = { ...this.config, ...newConfig };
    }

    public getConfig(): AIEngineConfig {
        return this.config;
    }

    public clearContext(): void {
        this.conversationHistory = [];
    }

    public getContext(): AIMessage[] {
        return this.conversationHistory;
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

    public async generateEmbeddings(text: string): Promise<number[]> {
        const { provider } = this.config;
        const embeddingModelName = this.config.embeddingModelName || provider.modelName;
        const endpoint = provider.apiEndpoint;

        // Skip embeddings if the indexing.generateEmbeddings setting is false
        const config = vscode.workspace.getConfiguration('smile-ai');
        const generateEmbeddings = config.get<boolean>('indexing.generateEmbeddings');
        if (!generateEmbeddings) {
            console.log('Embeddings generation is disabled in settings, skipping.');
            return [];
        }

        if (provider.name !== 'ollama') {
            console.warn(`Embeddings are currently only supported for Ollama provider, not ${provider.name}. Continuing without embeddings.`);
            return [];
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
                console.warn('Invalid response format received from embedding endpoint. Continuing without embeddings.');
                return [];
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
                    // Log the error but don't throw - let the extension continue without embeddings
                    console.warn(userMessage + ' Continuing without embeddings.');
                    return [];
                } else {
                    userMessage += `\nPlease check your Ollama setup and model name.`;
                }
            } else if (error.request) {
                userMessage = `Could not connect to ${providerName} at ${endpoint} for embeddings.`;
                userMessage += `\nPlease ensure the ${providerName} service is running.`;
                console.warn(userMessage + ' Continuing without embeddings.');
                return [];
            } else {
                userMessage = `Failed to communicate with ${providerName} for embeddings: ${error.message}.`;
            }
            
            // For critical errors, still throw
            if (error.message.includes('critical')) {
                throw new Error(userMessage);
            }
            
            // Otherwise log and continue without embeddings
            console.warn(userMessage + ' Continuing without embeddings.');
            return [];
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