import axios from 'axios';
import { AIMessage, AIRequest, AIResponse } from './types';
import { CodebaseIndex } from '../indexing/CodebaseIndex';
import { IndexedFile } from '../indexing/CodebaseIndexer';
import { FileOperationManager } from '../utils/FileOperationManager';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Message } from '../types/chat';
import { RAGService } from '../indexing/RAGService';

export interface AIEngineConfig {
    provider: {
        name: string;
        modelName: string;
        apiEndpoint: string;
    };
    maxTokens?: number;
    temperature?: number;
    embeddingModelName?: string;
    enableRAG?: boolean;
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
    contextHistory?: Array<{ role: string; content: string; timestamp: number; }>;
}

// Action interface for file operations
interface Action {
    type: 'add' | 'update' | 'delete';
    filePath: string;
    content?: string;
    original?: string;
}

export class AIEngine {
    private config: AIEngineConfig;
    private conversationHistory: AIMessage[] = [];
    private ragService: RAGService | null = null;
    private codebaseIndex: CodebaseIndex | null = null;

    constructor(config: AIEngineConfig) {
        this.config = config;
    }

    // Initialize RAG service with a codebase index
    public initRAG(codebaseIndex: CodebaseIndex): void {
        this.codebaseIndex = codebaseIndex;
        this.ragService = RAGService.getInstance(this, codebaseIndex);
        // Set RAG enabled based on config
        if (this.ragService && this.config.enableRAG !== undefined) {
            this.ragService.setEnabled(this.config.enableRAG);
        }
        
        console.log(`Initialized RAG service with ${this.codebaseIndex ? 'codebase index' : 'no index'}`);
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
            await this.executeAgentActions(response, message, options.contextHistory);
            
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
            
            // Prepare relevant codebase context using RAG if available
            let codebaseContext = '';
            if (isCodebaseQuery) {
                if (this.ragService && this.ragService.isEnabled()) {
                    console.log("Using RAG service to prepare context");
                    const enhancedContext = await this.ragService.enhanceQueryWithContext(message);
                    codebaseContext = enhancedContext.relevantContext;
                } else if (options.codebaseIndex) {
                    console.log("Using traditional codebase context method");
                    codebaseContext = this.prepareCodebaseContext(message, options.codebaseIndex);
                }
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

            // Include conversation history if provided
            let contextualHistory = '';
            if (options.contextHistory && options.contextHistory.length > 0) {
                contextualHistory = "\n\nHere is some context from previous messages:\n";
                options.contextHistory.forEach(msg => {
                    contextualHistory += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
                });
                contextualHistory += "\nPlease consider the above context when responding to the current request.";
            }
            
            if (contextualHistory) {
                systemPrompt += contextualHistory;
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
                    
                    IMPORTANT INSTRUCTIONS FOR FILE CREATION:
                    - When asked to create a file, ALWAYS provide the full file content inside a code block
                    - Format file creation as: \`\`\`language\npath/to/file.ext\ncode content here\n\`\`\`
                    - Do not just describe what would be in the file; ACTUALLY create it
                    - If the user says a previous file creation attempt failed, create the file again with the complete content
                    - When translating or updating files, include the full new content, not just the changes
                    - Remember to create proper directory structure in paths
                    - When a user mentions "dosya" (Turkish for "file"), treat it as a file creation request
                    
                    When responding to follow-up requests:
                    - If the user indicates you didn't complete a task correctly, apologize and immediately fix the issue
                    - Maintain context from previous messages to understand ongoing requests
                    - Be proactive and take initiative when helping the user
                    - If unsure about what exactly to create, ask clarifying questions first, then provide a complete solution`;
            
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
        
        // Update RAG service settings if enableRAG has changed
        if (this.ragService && newConfig.enableRAG !== undefined) {
            this.ragService.setEnabled(newConfig.enableRAG);
        }
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
    private async executeAgentActions(response: string, originalRequest?: string, contextHistory?: Array<{ role: string; content: string; timestamp: number; }>): Promise<void> {
        try {
            console.log('Executing agent actions');
            const fileOperationManager = FileOperationManager.getInstance();
            
            // Extract actions from the response using our extractActions method
            if (originalRequest) {
                const actions = await this.extractActions(response, originalRequest, contextHistory?.map(ctx => ({
                    role: ctx.role,
                    content: ctx.content,
                    timestamp: ctx.timestamp
                })) as Message[]);
                
                // Process each extracted action
                for (const action of actions) {
                    if (action.type === 'add') {
                        if (action.content) {
                            // Get the absolute path
                            let absolutePath = action.filePath;
                            if (!path.isAbsolute(action.filePath)) {
                                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                                    absolutePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, action.filePath);
                                }
                            }
                            
                            const description = `Create new file ${path.basename(action.filePath)} from extracted action`;
                            const operation = await fileOperationManager.createAddOperation(absolutePath, action.content, description);
                            await fileOperationManager.acceptOperation(operation.id);
                        }
                    } else if (action.type === 'update') {
                        if (action.content && action.original) {
                            // Get the absolute path
                            let absolutePath = action.filePath;
                            if (!path.isAbsolute(action.filePath)) {
                                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                                    absolutePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, action.filePath);
                                }
                            }
                            
                            const description = `Update file ${path.basename(action.filePath)} from extracted action`;
                            const operation = await fileOperationManager.createUpdateOperation(absolutePath, action.original, action.content, description);
                            await fileOperationManager.acceptOperation(operation.id);
                        }
                    }
                }
            }
            
            // Continue with the existing file action detection logic
            // Extract file creation/modification commands
            const fileActionRegex = /```(?:file|typescript|javascript|json|yaml|html|css|scss|less|xml|md|markdown|tsx|jsx|python|java|c|cpp|cs|go|rust|php|ruby|swift)?\s+([^\n]+)\n([\s\S]*?)```/g;
            
            let match;
            let actionsFound = false;
            
            // Process each file action in the response
            while ((match = fileActionRegex.exec(response)) !== null) {
                actionsFound = true;
                const filePath = match[1].trim();
                const fileContent = match[2];
                
                // Skip if filePath is empty or doesn't look like a file path
                if (!filePath || filePath.includes('```') || filePath.includes('|')) {
                    continue;
                }
                
                // Get the absolute path
                let absolutePath = filePath;
                if (!path.isAbsolute(filePath)) {
                    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                        absolutePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
                    } else {
                        console.warn('No workspace folder found, using relative path');
                    }
                }
                
                // Check if file exists to determine if this is an add or update operation
                const fileExists = fs.existsSync(absolutePath);
                
                if (fileExists) {
                    // Read original content for update operation
                    const originalContent = fs.readFileSync(absolutePath, 'utf8');
                    
                    // Only create an update operation if content actually changed
                    if (originalContent !== fileContent) {
                        const description = `Update file ${path.basename(filePath)} with AI-generated content`;
                        const operation = await fileOperationManager.createUpdateOperation(absolutePath, originalContent, fileContent, description);
                        // Auto-accept the operation
                        await fileOperationManager.acceptOperation(operation.id);
                        actionsFound = true;
                    }
                } else {
                    // This is a new file
                    const description = `Create new file ${path.basename(filePath)} with AI-generated content`;
                    const operation = await fileOperationManager.createAddOperation(absolutePath, fileContent, description);
                    // Auto-accept the operation
                    await fileOperationManager.acceptOperation(operation.id);
                    
                    // Create directories if they don't exist
                    const dirPath = path.dirname(absolutePath);
                    if (!fs.existsSync(dirPath)) {
                        fs.mkdirSync(dirPath, { recursive: true });
                    }
                    actionsFound = true;
                }
            }
            
            // Extract file deletion commands
            const fileDeleteRegex = /Delete file\s*[:"'\s]+([^"'\n]+)[:"'\s]+/gi;
            while ((match = fileDeleteRegex.exec(response)) !== null) {
                actionsFound = true;
                const filePath = match[1].trim();
                
                // Get the absolute path
                let absolutePath = filePath;
                if (!path.isAbsolute(filePath)) {
                    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                        absolutePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
                    }
                }
                
                // Check if file exists before attempting to delete
                if (fs.existsSync(absolutePath)) {
                    const originalContent = fs.readFileSync(absolutePath, 'utf8');
                    const description = `Delete file ${path.basename(filePath)}`;
                    const operation = await fileOperationManager.createDeleteOperation(absolutePath, originalContent, description);
                    // Auto-accept the operation
                    await fileOperationManager.acceptOperation(operation.id);
                }
            }
            
            // Check for additional file operations mentioned in plain text
            const additionalFileRegex = /(?:translate|update|modify|convert|fix)\s+file\s*[:"'\s]+([^"'\n]+)[:"'\s]+/gi;
            
            while ((match = additionalFileRegex.exec(response)) !== null) {
                const filePath = match[1].trim();
                
                // Get the absolute path
                let absolutePath = filePath;
                if (!path.isAbsolute(filePath)) {
                    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                        absolutePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
                    }
                }
                
                // If the file exists and content is provided in the response, create an update operation
                if (fs.existsSync(absolutePath)) {
                    const originalContent = fs.readFileSync(absolutePath, 'utf8');
                    
                    // Extract content that might be associated with this file
                    const fileContentRegex = new RegExp(`(?:content|translation)\\s+for\\s+${path.basename(filePath)}\\s*:\\s*\`\`\`(?:\\w+)?\\s*([\\s\\S]*?)\`\`\``, 'i');
                    const contentMatch = fileContentRegex.exec(response);
                    
                    if (contentMatch && contentMatch[1]) {
                        const newContent = contentMatch[1];
                        if (originalContent !== newContent) {
                            const description = `Update ${path.basename(filePath)} based on translation/modification request`;
                            const operation = await fileOperationManager.createUpdateOperation(absolutePath, originalContent, newContent, description);
                            // Auto-accept the operation
                            await fileOperationManager.acceptOperation(operation.id);
                            actionsFound = true;
                        }
                    }
                }
            }
            
            // If no actions found yet, check for descriptions of files to create from the context
            if (!actionsFound && (originalRequest || (contextHistory && contextHistory.length > 0))) {
                // Look for file creation requests without explicit code blocks
                const fileCreationPatterns = [
                    // Match file path patterns followed by content
                    {regex: /create\s+(?:a|the)\s+file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/i, group: 1},
                    {regex: /generate\s+(?:a|the)\s+file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/i, group: 1},
                    {regex: /new\s+file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/i, group: 1},
                    {regex: /dosya\s+oluştur\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/i, group: 1},
                    {regex: /yeni\s+dosya\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/i, group: 1},
                    // Named files in markdown format 
                    {regex: /\*\*Location:\*\*\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/i, group: 1},
                    {regex: /\*\*File:\*\*\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/i, group: 1}
                ];
                
                let potentialFilePath = '';
                
                // Check the original request first
                if (originalRequest) {
                    for (const pattern of fileCreationPatterns) {
                        const fileMatch = originalRequest.match(pattern.regex);
                        if (fileMatch && fileMatch[pattern.group]) {
                            potentialFilePath = fileMatch[pattern.group];
                            break;
                        }
                    }
                }
                
                // If no file path found in request, check context history
                if (!potentialFilePath && contextHistory) {
                    // Combine all messages to search through
                    const allMessages = contextHistory.map(msg => msg.content).join(" ");
                    for (const pattern of fileCreationPatterns) {
                        const fileMatch = allMessages.match(pattern.regex);
                        if (fileMatch && fileMatch[pattern.group]) {
                            potentialFilePath = fileMatch[pattern.group];
                            break;
                        }
                    }
                }
                
                // Look for potential file content from the current response
                if (potentialFilePath && response.includes('```')) {
                    // Use our new extraction function to get content
                    const fileContent = this.extractFileContentFromResponse(response, potentialFilePath);
                    
                    if (fileContent) {
                        // Get the absolute path
                        let absolutePath = potentialFilePath;
                        if (!path.isAbsolute(potentialFilePath)) {
                            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                                absolutePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, potentialFilePath);
                            }
                        }
                        
                        // Create file operation
                        const fileExists = fs.existsSync(absolutePath);
                        
                        if (fileExists) {
                            const originalContent = fs.readFileSync(absolutePath, 'utf8');
                            if (originalContent !== fileContent) {
                                const description = `Update file ${path.basename(potentialFilePath)} based on context`;
                                const operation = await fileOperationManager.createUpdateOperation(absolutePath, originalContent, fileContent, description);
                                // Auto-accept the operation
                                await fileOperationManager.acceptOperation(operation.id);
                                actionsFound = true;
                            }
                        } else {
                            const description = `Create new file ${path.basename(potentialFilePath)} based on context`;
                            const operation = await fileOperationManager.createAddOperation(absolutePath, fileContent, description);
                            // Auto-accept the operation
                            await fileOperationManager.acceptOperation(operation.id);
                            
                            // Create directories if they don't exist
                            const dirPath = path.dirname(absolutePath);
                            if (!fs.existsSync(dirPath)) {
                                fs.mkdirSync(dirPath, { recursive: true });
                            }
                            actionsFound = true;
                        }
                    }
                }
            }
            
            // Look for explicit file paths mentioned in the response
            if (!actionsFound) {
                const mentionedFilePaths = [];
                
                // Common file extensions to look for
                const fileExtensions = ['.md', '.ts', '.js', '.json', '.html', '.css', '.yml', '.yaml', '.txt', '.jsx', '.tsx'];
                
                // Find all potential file paths in the response
                fileExtensions.forEach(ext => {
                    const filePathRegex = new RegExp(`(?:file(?:name)?|path|location)\\s*[:：]?\\s*["'\\s]*((?:[\\w\\-./]+)+${ext.replace('.', '\\.')})[\\s"',.)]`, 'gi');
                    let filePathMatch;
                    while ((filePathMatch = filePathRegex.exec(response)) !== null) {
                        if (filePathMatch[1] && !filePathMatch[1].includes('```')) {
                            mentionedFilePaths.push(filePathMatch[1].trim());
                        }
                    }
                    
                    // Also look for paths in markdown format
                    const markdownPathRegex = new RegExp(`\\*\\*(?:file|path|location)\\*\\*\\s*[:：]?\\s*["'\\s]*((?:[\\w\\-./]+)+${ext.replace('.', '\\.')})[\\s"',.)]`, 'gi');
                    while ((filePathMatch = markdownPathRegex.exec(response)) !== null) {
                        if (filePathMatch[1] && !filePathMatch[1].includes('```')) {
                            mentionedFilePaths.push(filePathMatch[1].trim());
                        }
                    }
                });
                
                // Look for paths directly within special characters like ` or "
                const quotedPathRegex = /[`"']((?:[\w\-./]+\/)*[\w\-]+\.[\w]+)[`"']/g;
                let quotedPathMatch;
                while ((quotedPathMatch = quotedPathRegex.exec(response)) !== null) {
                    if (quotedPathMatch[1] && !quotedPathMatch[1].includes('```')) {
                        mentionedFilePaths.push(quotedPathMatch[1].trim());
                    }
                }
                
                // Process found file paths
                for (const filePath of new Set(mentionedFilePaths)) { // Use Set to deduplicate
                    const fileContent = this.extractFileContentFromResponse(response, filePath);
                    
                    if (fileContent) {
                        // Get the absolute path
                        let absolutePath = filePath;
                        if (!path.isAbsolute(filePath)) {
                            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                                absolutePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
                            }
                        }
                        
                        // Create file operation
                        const fileExists = fs.existsSync(absolutePath);
                        
                        if (fileExists) {
                            const originalContent = fs.readFileSync(absolutePath, 'utf8');
                            if (originalContent !== fileContent) {
                                const description = `Update file ${path.basename(filePath)} detected in response`;
                                const operation = await fileOperationManager.createUpdateOperation(absolutePath, originalContent, fileContent, description);
                                // Auto-accept the operation
                                await fileOperationManager.acceptOperation(operation.id);
                                actionsFound = true;
                            }
                        } else {
                            const description = `Create new file ${path.basename(filePath)} detected in response`;
                            const operation = await fileOperationManager.createAddOperation(absolutePath, fileContent, description);
                            // Auto-accept the operation
                            await fileOperationManager.acceptOperation(operation.id);
                            
                            // Create directories if they don't exist
                            const dirPath = path.dirname(absolutePath);
                            if (!fs.existsSync(dirPath)) {
                                fs.mkdirSync(dirPath, { recursive: true });
                            }
                            actionsFound = true;
                        }
                    }
                }
            }
            
        } catch (error) {
            console.error('Error executing agent actions:', error);
        }
    }

    private extractFileContentFromResponse(response: string, filePath: string): string | null {
        // Try different patterns to extract file content
        const patterns = [
            // Find content in a code block that might be associated with the file
            new RegExp(`\`\`\`(?:\\w+)?\\s*${path.basename(filePath)}\\s*\\n([\\s\\S]*?)\`\`\``, 'i'),
            // Look for content after "Here's the content for [filename]:" or similar phrases
            new RegExp(`(?:here(?:'s| is) the content(?: for| of)? ${path.basename(filePath)}\\s*[:：]?\\s*\`\`\`(?:\\w+)?\\s*\\n?([\\s\\S]*?)\`\`\``, 'i'),
            // Look for content labeled as the file
            new RegExp(`${path.basename(filePath)}\\s*[:：]\\s*\`\`\`(?:\\w+)?\\s*\\n?([\\s\\S]*?)\`\`\``, 'i'),
            // Extract the first code block if nothing else matches and we're sure this is for a file
            /```(?:\w+)?\s*\n([\s\S]*?)```/
        ];

        for (const pattern of patterns) {
            const match = response.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }

        // If we don't find content in code blocks, look for other indicators
        // For markdown files, maybe the content isn't in a code block
        if (filePath.endsWith('.md') && response.includes('# ')) {
            // Try to extract structured markdown content
            const mdHeadingMatch = response.match(/# [^\n]+(?:\n[\s\S]*?)(?=\n#|$)/);
            if (mdHeadingMatch) {
                return mdHeadingMatch[0];
            }
        }

        return null;
    }

    private async extractActions(response: string, originalRequest: string, contextHistory: Message[] = []): Promise<Action[]> {
        const actions: Action[] = [];
        
        console.log('Extracting actions from response:', response.substring(0, 150) + '...');
        
        // First check for explicit file paths mentioned in the response
        const fileOperationRegexes = [
            /создать файл[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // Russian: create file
            /создать[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // Russian: create
            /criar arquivo[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // Portuguese: create file
            /criar[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // Portuguese: create
            /créer un fichier[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // French: create file 
            /créer[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // French: create
            /erstellen[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // German: create
            /crear archivo[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // Spanish: create file
            /crear[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // Spanish: create
            /dosya oluştur[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // Turkish: create file
            /oluştur[`'"]?([\w\-\./]+\.\w+)[`'"]?/g, // Turkish: create
            /create\s+(?:a|the)?\s*(?:new)?\s*file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
            /create\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
            /add\s+(?:a|the)?\s*(?:new)?\s*file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
            /add\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
            /save\s+(?:to)?\s*[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
            /generate\s+(?:a|the)?\s*file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
            /write\s+(?:a|the)?\s*file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
            /new\s+file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
        ];
        
        // Also check for file paths in markdown code blocks
        const markdownFilePathRegex = /```\s*(?:title=)?[`'"]?([\w\-\./]+\.\w+)[`'"]?/g;
        
        // Function to check for file paths with a specific regex
        const checkForFilePaths = (regex: RegExp, text: string): string[] => {
            const filePaths: string[] = [];
            let match;
            while ((match = regex.exec(text)) !== null) {
                if (match[1] && !filePaths.includes(match[1])) {
                    console.log(`Detected file path: ${match[1]} with regex: ${regex}`);
                    filePaths.push(match[1]);
                }
            }
            return filePaths;
        };
        
        // Check for file paths in the response with each regex
        const potentialFilePaths: string[] = [];
        
        // Check with regular regexes
        fileOperationRegexes.forEach(regex => {
            potentialFilePaths.push(...checkForFilePaths(regex, response));
        });
        
        // Also check for markdown code blocks
        potentialFilePaths.push(...checkForFilePaths(markdownFilePathRegex, response));
        
        console.log('Potential file paths found:', potentialFilePaths);
        
        // For each potential file path, extract content and create an action
        for (const potentialFilePath of potentialFilePaths) {
            const fileContent = this.extractFileContentFromResponse(response, potentialFilePath);
            if (fileContent) {
                const workspace = vscode.workspace.workspaceFolders?.[0];
                if (workspace) {
                    // Resolve absolute path
                    let absolutePath: string;
                    if (path.isAbsolute(potentialFilePath)) {
                        absolutePath = potentialFilePath;
                    } else {
                        absolutePath = path.join(workspace.uri.fsPath, potentialFilePath);
                    }
                    
                    // Get POSIX-style path for display
                    const posixPath = absolutePath.split(path.sep).join(path.posix.sep);
                    console.log(`Processing file operation for path: ${posixPath}`);
                    
                    // Check if file exists
                    const fileExists = fs.existsSync(absolutePath);
                    console.log(`File exists: ${fileExists}`);
                    
                    if (fileExists) {
                        // Update operation
                        const currentContent = fs.readFileSync(absolutePath, 'utf8');
                        if (currentContent !== fileContent) {
                            console.log(`Creating UPDATE operation for: ${posixPath}`);
                            actions.push({
                                type: 'update',
                                filePath: posixPath,
                                content: fileContent,
                                original: currentContent
                            });
                        } else {
                            console.log(`File content unchanged, skipping operation for: ${posixPath}`);
                        }
                    } else {
                        // Add operation
                        console.log(`Creating ADD operation for: ${posixPath}`);
                        actions.push({
                            type: 'add',
                            filePath: posixPath,
                            content: fileContent
                        });
                    }
                }
            }
        }
        
        // If no actions were found from the explicit file paths, check for descriptions of files to create from the context
        if (actions.length === 0) {
            console.log('No explicit file paths found, checking context for file creation requests');
            
            // Combined context from original request and context history
            const fullContext = originalRequest + '\n' + 
                contextHistory.map(msg => msg.content).join('\n') + '\n' + 
                response;
                
            // More comprehensive regexes to catch file creation requests
            const contextFilePathRegexes = [
                // English patterns
                /create\s+(?:a|the)\s+file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
                /generate\s+(?:a|the)\s+file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
                /new\s+file\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
                // File name in quotes or markdown backticks
                /[`'"]+([\w\-\./]+\.\w+)[`'"]+/g,
                // File name in markdown code span
                /`([\w\-\./]+\.\w+)`/g,
                // File name at the beginning of a markdown code block
                /```\s*(?:title=)?[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
                // Turkish patterns
                /dosya\s+oluştur\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g,
                /yeni\s+dosya\s+[`'"]?([\w\-\./]+\.\w+)[`'"]?/g
            ];
            
            for (const regex of contextFilePathRegexes) {
                const contextFilePaths = checkForFilePaths(regex, fullContext);
                
                for (const filePath of contextFilePaths) {
                    // Skip paths we've already processed
                    if (potentialFilePaths.includes(filePath)) {
                        continue;
                    }
                    
                    console.log(`Found context file path: ${filePath}`);
                    const fileContent = this.extractFileContentFromResponse(response, filePath);
                    
                    if (fileContent) {
                        const workspace = vscode.workspace.workspaceFolders?.[0];
                        if (workspace) {
                            // Resolve absolute path
                            let absolutePath: string;
                            if (path.isAbsolute(filePath)) {
                                absolutePath = filePath;
                            } else {
                                absolutePath = path.join(workspace.uri.fsPath, filePath);
                            }
                            
                            // Get POSIX-style path for display
                            const posixPath = absolutePath.split(path.sep).join(path.posix.sep);
                            console.log(`Processing context file operation for path: ${posixPath}`);
                            
                            // Check if file exists
                            const fileExists = fs.existsSync(absolutePath);
                            console.log(`File exists: ${fileExists}`);
                            
                            if (fileExists) {
                                // Update operation
                                const currentContent = fs.readFileSync(absolutePath, 'utf8');
                                if (currentContent !== fileContent) {
                                    console.log(`Creating UPDATE operation for context file: ${posixPath}`);
                                    actions.push({
                                        type: 'update',
                                        filePath: posixPath,
                                        content: fileContent,
                                        original: currentContent
                                    });
                                } else {
                                    console.log(`Context file content unchanged, skipping operation for: ${posixPath}`);
                                }
                            } else {
                                // Add operation
                                console.log(`Creating ADD operation for context file: ${posixPath}`);
                                actions.push({
                                    type: 'add',
                                    filePath: posixPath,
                                    content: fileContent
                                });
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`Total actions extracted: ${actions.length}`);
        return actions;
    }
} 