import axios from 'axios';
import * as vscode from 'vscode';

/**
 * Interface for the AI provider configuration.
 */
export interface AIProvider {
    name: string;
    modelName: string;
    apiEndpoint: string;
    // Add other provider-specific settings if needed
}

/**
 * Interface for the AI engine configuration.
 */
export interface AIConfig {
    provider: AIProvider;
    maxTokens: number;
    temperature: number;
    embeddingModelName?: string; 
}

/**
 * Interface for the response from the AI engine.
 */
export interface AIResponse {
    message: string;
    finishReason?: string;
    codeChanges?: any;  // Add codeChanges property
    usage?: { 
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
}

/**
 * Interface for AI request parameters
 */
export interface AIRequest {
    messages: AIMessage[];
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    context?: {
        mode?: string;
        selectedText?: string;
        filePath?: string;
        prompt?: string;
        currentFile?: string;
        [key: string]: any;
    };
}

// Interface for messages in conversation history (if needed)
export interface AIMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: number;  // Add optional timestamp
}

export class AIEngine {
    private config: AIConfig;
    private conversationHistory: AIMessage[] = [];

    constructor(config: AIConfig) {
        this.config = config;
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
        messages.push(...this.conversationHistory);

        // Add current request messages
        messages.push(...request.messages);

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
            const providerName = this.config.provider.name;
            const endpoint = this.config.provider.apiEndpoint;
            const modelName = this.config.provider.modelName;
            let userMessage = `Failed to get response from ${providerName}.`;

            if (error.response) {
                // The request was made and the server responded with a status code
                // that falls out of the range of 2xx
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
                // The request was made but no response was received
                // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                // http.ClientRequest in node.js
                userMessage = `Could not connect to ${providerName} at ${endpoint}.`;
                userMessage += `\nPlease ensure the ${providerName} service is running and the API endpoint in settings is correct.`;
            } else {
                // Something happened in setting up the request that triggered an Error
                userMessage = `Failed to communicate with ${providerName}: ${error.message}.`;
                userMessage += `\nThis might be a configuration issue or an unexpected error.`;
            }
            // Re-throw a new error with the user-friendly message
            throw new Error(userMessage);
        }
    }

    private updateContext(request: AIRequest, response: AIResponse): void {
        // Add user messages to context
        this.conversationHistory.push(...request.messages);

        // Add assistant response to context
        this.conversationHistory.push({
            role: 'assistant',
            content: response.message,
            timestamp: Date.now()
        });

        // Maintain context size (keep last N messages)
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

    public updateConfig(config: Partial<AIConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Generates embeddings for the given text using the configured embedding model.
     * 
     * @param text The text (e.g., code snippet) to generate embeddings for.
     * @returns A promise that resolves to an array of numbers representing the embedding vector.
     * @throws An error if the provider does not support embeddings or if the API call fails.
     */
    public async generateEmbeddings(text: string): Promise<number[]> {
        const { provider } = this.config;
        // Ensure the provider has an embedding model configured (add this to AIConfig/settings later)
        const embeddingModelName = this.config.embeddingModelName || provider.modelName; // Fallback for now
        const endpoint = provider.apiEndpoint; // Assuming embedding endpoint is relative to main endpoint

        if (provider.name !== 'ollama') {
            // TODO: Add support for other providers if they have embedding endpoints
            throw new Error(`Embeddings are currently only supported for Ollama provider, not ${provider.name}.`);
        }

        const embeddingEndpoint = `${endpoint}/api/embeddings`;
        const requestBody = {
            model: embeddingModelName,
            prompt: text
        };

        console.log(`Generating embeddings using ${embeddingModelName} at ${embeddingEndpoint}`);

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
            // Use similar detailed error handling as callAIProvider
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
} 