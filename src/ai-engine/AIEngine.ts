import axios from 'axios';
import { AIMessage, AIRequest, AIResponse } from './types';
import { CodebaseIndex } from '../indexing/CodebaseIndex';
import { IndexedFile } from '../indexing/CodebaseIndexer';

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
        try {
            // First get the response from the AI
            const response = await this.sendRequest(message, options, 'agent');
            
            // Extract file creation commands from the response
            await this.executeAgentActions(response);
            
            return response;
        } catch (error) {
            console.error('Error in processAgentMessage:', error);
            return `I encountered an error while trying to process your request in agent mode: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    public async processAskMessage(message: string, options: ProcessOptions): Promise<string> {
        // Ask mode processing - focused on answering questions about code
        return await this.sendRequest(message, options, 'ask');
    }

    private async sendRequest(message: string, options: ProcessOptions, mode: 'chat' | 'agent' | 'ask'): Promise<string> {
        try {
            console.log(`Sending ${mode} request to ${this.config.provider.name} at ${this.config.provider.apiEndpoint}`);
            
            // Check if user is asking about the codebase
            const isCodebaseQuery = message.toLowerCase().includes('codebase') || 
                                  message.startsWith('@') || 
                                  message.includes('code base') || 
                                  message.includes('kod taban');
            
            // Prepare relevant codebase context if needed
            let codebaseContext = '';
            if (isCodebaseQuery && options.codebaseIndex) {
                console.log("Detected codebase query, preparing codebase context");
                codebaseContext = this.prepareCodebaseContext(message, options.codebaseIndex);
            }
            
            // Check if we're using Ollama and use the correct endpoint
            let endpoint = this.config.provider.apiEndpoint;
            
            if (this.config.provider.name === 'ollama') {
                endpoint = `${this.config.provider.apiEndpoint}/api/generate`;
            } else if (this.config.provider.name === 'lmstudio') {
                endpoint = `${this.config.provider.apiEndpoint}/v1/chat/completions`;
            }
            
            // Construct system prompt with codebase context if available
            let systemPrompt = this.getSystemPrompt(mode);
            if (codebaseContext) {
                systemPrompt += `\n\nHere is information about the codebase:\n${codebaseContext}`;
            }
            
            // Construct the request body with options
            const requestBody = this.config.provider.name === 'ollama' ? {
                model: this.config.provider.modelName,
                prompt: `${systemPrompt}\n\nUser: ${message}\n\nAssistant:`,
                stream: false,
                options: options.options || {},
            } : {
                model: this.config.provider.modelName,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
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
            const timeoutId = setTimeout(() => controller.abort(), 90000); // Increased timeout to 90 seconds
            
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
                console.log('Received response:', data); // Log the response for debugging
                
                // Process response based on provider
                let content = '';
                if (this.config.provider.name === 'ollama') {
                    content = data.response || data.message?.content || 'No response content received';
                    // Clean up any <think> tags that might be in the response
                    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                } else {
                    content = data.choices?.[0]?.message?.content || 'No response content received';
                }

                // Log the final content
                console.log('Processed content:', content);
                return content;
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
        console.log("Generating embeddings for text", text.length > 50 ? text.substring(0, 50) + "..." : text);
        try {
            // For now, generate a simple dummy embedding
            // In a real application, you would use a proper embedding model
            // This is just to enable the codebase indexing to function without requiring external embeddings models
            
            console.log("Using dummy embeddings for testing purposes");
            
            // Create a random embedding vector of length 1536 (typical for many embedding models)
            const embeddingLength = 1536;
            const embedding = new Array(embeddingLength).fill(0).map(() => Math.random() * 2 - 1);
            
            // Normalize the embedding to unit length to mimic real embeddings
            const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
            const normalizedEmbedding = embedding.map(val => val / magnitude);
            
            return normalizedEmbedding;
        } catch (error) {
            console.error("Error generating embeddings:", error);
            // Return a default embedding in case of error
            return new Array(1536).fill(0);
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

    private prepareCodebaseContext(_query: string, codebaseIndex: CodebaseIndex): string {
        if (!codebaseIndex) {
            return '';
        }
        
        try {
            // Extract project name functionality planned but not implemented yet
            
            // Get relevant files for the query
            const files = codebaseIndex.getAllDocuments();
            if (!files || files.length === 0) {
                return "Codebase is indexed but no files were found.";
            }
            
            // Prepare an overview of the codebase structure
            let result = `Found ${files.length} files in the codebase.\n\n`;
            
            // Group files by directory for better structure understanding
            const filesByDir = new Map<string, string[]>();
            files.forEach((file: IndexedFile) => {
                const filePath = file.path;
                const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1) || '/';
                if (!filesByDir.has(dir)) {
                    filesByDir.set(dir, []);
                }
                filesByDir.get(dir)?.push(filePath);
            });
            
            // Add directory structure to the context
            result += "Directory structure:\n";
            filesByDir.forEach((files, dir) => {
                result += `- ${dir}: ${files.length} files\n`;
            });
            
            // Add high-level description of key files
            result += "\nKey files:\n";
            
            // Find interesting files (like README, index, etc.)
            const keyFiles = files.filter((file: IndexedFile) => 
                file.path.toLowerCase().includes('readme') || 
                file.path.toLowerCase().includes('index') ||
                file.path.toLowerCase().includes('overview') ||
                file.path.toLowerCase().includes('config') ||
                file.path.toLowerCase().includes('main')
            );
            
            // Add snippets from key files
            keyFiles.forEach((file: IndexedFile) => {
                const preview = file.content.substring(0, 300) + (file.content.length > 300 ? '...' : '');
                result += `\n## ${file.path}\n${preview}\n`;
            });
            
            // Add list of all file types in the codebase
            const fileExtensions = new Set<string>();
            files.forEach((file: IndexedFile) => {
                const ext = file.path.split('.').pop() || '';
                if (ext) fileExtensions.add(ext);
            });
            
            result += `\nFile types: ${Array.from(fileExtensions).join(', ')}`;
            
            return result;
        } catch (error) {
            console.error("Error preparing codebase context:", error);
            return "Error accessing codebase information.";
        }
    }

    /**
     * Extracts and executes actions from the agent's response
     * Currently supports markdown file creation when content is provided in code blocks
     */
    private async executeAgentActions(response: string): Promise<void> {
        // Import vscode dynamically to avoid issues
        const vscode = require('vscode');
        
        // Extract file names and content from markdown code blocks
        const fileCreationRegex = /```markdown\s*#.*?```|```md\s*#.*?```|`([^`]+\.md)`|I'll create a file named `([^`]+\.md)`/gs;
        const matches = [...response.matchAll(fileCreationRegex)];
        
        if (matches.length === 0) {
            console.log('No file creation commands found in response');
            return;
        }
        
        // Look for markdown content in code blocks
        const markdownContentRegex = /```markdown\s*([\s\S]*?)```|```md\s*([\s\S]*?)```/gs;
        const contentMatches = [...response.matchAll(markdownContentRegex)];
        
        if (contentMatches.length === 0) {
            console.log('No markdown content found in response');
            return;
        }
        
        // Extract potential file name from text
        let fileName = '';
        const fileNameMatches = response.match(/`([^`]+\.md)`|I'll create a file named `([^`]+\.md)`|file named `([^`]+\.md)`/);
        if (fileNameMatches) {
            fileName = fileNameMatches[1] || fileNameMatches[2] || fileNameMatches[3] || '';
        }
        
        if (!fileName) {
            console.log('Could not extract file name from response');
            return;
        }
        
        // Get the content from the first markdown block
        const content = contentMatches[0][1] || contentMatches[0][2] || '';
        if (!content) {
            console.log('No content found in markdown block');
            return;
        }
        
        // Create the file in the workspace
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                console.error('No workspace folder found');
                return;
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const filePath = vscode.Uri.file(`${workspacePath}/${fileName}`);
            
            console.log(`Creating file: ${filePath.fsPath}`);
            console.log(`With content: ${content.substring(0, 100)}...`);
            
            await vscode.workspace.fs.writeFile(filePath, Buffer.from(content, 'utf8'));
            console.log(`Successfully created file: ${filePath.fsPath}`);
            
            // Show the file in the editor
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            console.error(`Failed to create file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 