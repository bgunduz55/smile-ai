import axios from 'axios';
import { AIMessage, AIRequest, AIResponse } from './types';
import { CodebaseIndex } from '../indexing/CodebaseIndex';
import { IndexedFile } from '../indexing/CodebaseIndexer';
import { FileOperationManager } from '../utils/FileOperationManager';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RAGService } from '../indexing/RAGService';
import { ResponseCache } from './ResponseCache';
import { AIProvider } from '../mcp/interfaces';
import { SmileAIExtension } from '../extension';
import { Task, TaskResult } from '../agent/types';

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
        stream?: boolean;
        onChunk?: (chunk: string) => void;
    };
    codebaseIndex?: CodebaseIndex;
}

export interface ProcessOptions {
    options?: any;
    codebaseIndex?: any;
    contextHistory?: Array<{ role: string; content: string; timestamp: number; }>;
}

export class AIEngine implements AIProvider {
    private config: AIEngineConfig;
    private conversationHistory: AIMessage[] = [];
    private ragService: RAGService | null = null;
    private codebaseIndex: CodebaseIndex | null = null;
    private responseCache: ResponseCache;
    private streamingEnabled: boolean = true;
    private responseChunkSize: number = 200;

    constructor(config: AIEngineConfig) {
        this.config = config;
        this.responseCache = ResponseCache.getInstance();
        this.updatePerformanceSettings();
        
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('smile-ai.performance')) {
                this.updatePerformanceSettings();
            }
        });
    }

    private updatePerformanceSettings(): void {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const perfConfig = config.get<any>('performance', {});
        
        this.streamingEnabled = perfConfig.enableStreamingResponses !== false;
        this.responseChunkSize = perfConfig.responseChunkSize || 200;
        
        console.log(`AI Engine performance settings: streaming=${this.streamingEnabled}, chunkSize=${this.responseChunkSize}`);
    }

    public initRAG(codebaseIndex: CodebaseIndex): void {
        this.codebaseIndex = codebaseIndex;
        this.ragService = RAGService.getInstance(this, codebaseIndex);
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

    public async processMessage(text: string, options: ProcessOptions): Promise<string> {
        try {
            // İlk olarak MCP provider'ı kontrol edelim
            console.log('🔎 [processMessage] başlatılıyor - MCP provider kontrolü yapılacak');
            const mcpProvider = this.getMCPProvider();
            
            console.log('🔎 [processMessage] MCP provider:', 
                        mcpProvider ? `Bulundu (${mcpProvider.constructor.name})` : 'Bulunamadı');
            
            if (mcpProvider && mcpProvider.constructor && mcpProvider.constructor.name !== 'AIEngine') {
                console.log('🌟 [processMessage] External MCP provider for chat request bulundu');
                
                try {
                    console.log('📤 [processMessage] MCP provider\'a sorgu gönderiliyor:', text.substring(0, 30));
                    // MCP provider'a gönder
                    const result = await mcpProvider.queryLLM(text, options?.options || {});
                    
                    console.log('📥 [processMessage] MCP\'den yanıt alındı:', 
                                result ? `${typeof result.message === 'string' ? 'Başarılı' : 'Geçersiz format'}` : 'Undefined');
                    
                    if (result && typeof result.message === 'string') {
                        console.log('✅ [processMessage] MCP provider\'dan başarılı yanıt alındı');
                        console.log('📋 [processMessage] Yanıt önizlemesi:', result.message.substring(0, 30) + '...');
                        return result.message;
                    } else {
                        console.log('⚠️ [processMessage] MCP provider yanıtı geçersiz, yerel motora dönülüyor');
                    }
                } catch (mcpError) {
                    console.error('❌ [processMessage] MCP provider kullanırken hata:', mcpError);
                    console.log('⚠️ [processMessage] Bu istek için yerel motora geçiliyor');
                }
            } else {
                console.log('⚠️ [processMessage] Kullanılabilir MCP provider bulunamadı, yerel motor kullanılacak');
            }
            
            // MCP provider yoksa veya hata verdiyse lokale devam et
            console.log('🔄 [processMessage] Yerel motor ile işleme devam ediliyor');
            
            const hasAttachments = options?.options?.attachments?.length > 0;
            
            let queryEmbedding: number[] | null = null;
            
            if (!hasAttachments) {
                try {
                    queryEmbedding = await this.generateEmbeddings(text);
                    
                    if (queryEmbedding) {
                        const cachedResponse = this.responseCache.findSimilarResponse(
                            text, 
                            queryEmbedding, 
                            'chat'
                        );
                        
                        if (cachedResponse) {
                            console.log('Found cached response, returning immediately');
                            return cachedResponse;
                        }
                    }
                } catch (error) {
                    console.warn('Error generating embedding for cache check:', error);
                }
            }
            
            console.log('Processing message with attachments:', hasAttachments);
            
            const shouldStream = this.streamingEnabled && options?.options?.stream === true;
            const onChunk = options?.options?.onChunk;
            
            let response;
            if (shouldStream && onChunk) {
                response = await this.sendStreamingRequest(text, options, 'chat', onChunk);
            } else {
                response = await this.sendRequestInternal(text, options, 'chat');
            }
            
            await this.processFileOperations(response);
            
            if (queryEmbedding && !hasAttachments) {
                this.responseCache.addResponse(text, queryEmbedding, response, 'chat');
            }
            
            return response;
        } catch (error) {
            console.error('Error in processMessage:', error);
            return `I encountered an error while processing your request: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    public async processAgentMessage(message: string, options: ProcessOptions): Promise<string> {
        try {
            const response = await this.sendRequestInternal(message, options, 'agent');
            
            await this.processFileOperations(response);
            
            return response;
        } catch (error) {
            console.error('Error in processAgentMessage:', error);
            return `I encountered an error while trying to process your request in agent mode: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    public async processAskMessage(message: string, options: ProcessOptions): Promise<string> {
        return await this.sendRequestInternal(message, options, 'ask');
    }

    public async sendRequest(request: AIRequest): Promise<AIResponse> {
        try {
            // Process request and generate response
            const messages = request.messages;
            const response = await this.callAIProvider(messages);
            this.updateContext(request, response);
            return response;
        } catch (error) {
            console.error('Error in sendRequest:', error);
            return {
                message: `Error processing request: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    private async sendRequestInternal(message: string, options: ProcessOptions, mode: 'chat' | 'agent' | 'ask'): Promise<string> {
        try {
            console.log(`Sending ${mode} request to ${this.config.provider.name} at ${this.config.provider.apiEndpoint}`);
            
            let enhancedMessage = message;
            
            const containsFileContent = message.includes('```') && 
                                      (message.includes('### File:') || 
                                       message.includes('# ') || 
                                       message.includes('## '));
            
            const hasAttachments = options?.options?.attachments?.length > 0;
            if (hasAttachments && !containsFileContent) {
                const attachmentsWithContent = options?.options?.attachments?.filter((a: any) => a.type === 'file' && a.content) || [];
                
                if (attachmentsWithContent.length > 0) {
                    console.log(`Enhancing message with ${attachmentsWithContent.length} file attachments`);
                    enhancedMessage += "\n\n";
                    
                    attachmentsWithContent.forEach((attachment: any) => {
                        const fileName = attachment.name || attachment.path.split(/[\/\\]/).pop() || 'file';
                        console.log(`Adding content for ${fileName} to message`);
                        enhancedMessage += `### File: ${fileName}\n\`\`\`\n${attachment.content}\n\`\`\`\n\n`;
                    });
                    
                    const isTranslationRequest = this.isTranslationRequest(message);
                    
                    if (isTranslationRequest) {
                        enhancedMessage += "\nPlease translate the content of these files and return the full translated content in code blocks with the original file names. Your response will be used to update the original files.";
                    }
                    
                    console.log("Final message preparation complete");
                }
            }
            
            const isCodebaseQuery = message.toLowerCase().includes('codebase') || 
                                  message.startsWith('@') || 
                                  message.includes('code base') || 
                                  message.includes('kod taban');
            
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
            
            let endpoint = this.config.provider.apiEndpoint;
            
            if (this.config.provider.name === 'ollama') {
                endpoint = `${this.config.provider.apiEndpoint}/api/generate`;
            } else if (this.config.provider.name === 'lmstudio') {
                endpoint = `${this.config.provider.apiEndpoint}/v1/chat/completions`;
            }
            
            let systemPrompt = this.getSystemPrompt(mode);
            if (codebaseContext) {
                systemPrompt += `\n\nHere is information about the codebase:\n${codebaseContext}`;
            }

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
            
            const cleanOptions = options.options || {};
            
            if (enhancedMessage !== message) {
                console.log('Message already enhanced with attachments, clearing attachments in request body');
                if (cleanOptions.attachments) {
                    delete cleanOptions.attachments;
                }
            }
            
            const requestBody = this.config.provider.name === 'ollama' ? {
                model: this.config.provider.modelName,
                prompt: `${systemPrompt}\n\nUser: ${enhancedMessage}\n\nAssistant:`,
                stream: false,
                options: cleanOptions,
            } : {
                model: this.config.provider.modelName,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: enhancedMessage
                    }
                ],
                max_tokens: this.config.maxTokens || 2048,
                temperature: this.config.temperature || 0.7,
                options: cleanOptions,
                codebaseIndex: options.codebaseIndex || null
            };

            console.log('Request body:', JSON.stringify(requestBody));

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 180000);
            
            try {
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
                    throw new Error(`API request failed: ${response.statusText} (${response.status})`);
                }

                const data = await response.json();
                console.log('Received response:', data);
                
                let content = '';
                if (this.config.provider.name === 'ollama') {
                    content = data.response || data.message?.content || 'No response content received';
                    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                } else {
                    content = data.choices?.[0]?.message?.content || 'No response content received';
                }

                console.log('Processed content:', content);
                return content;
            } catch (fetchError: unknown) {
                console.error('Fetch error:', fetchError);
                
                if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                    return `I couldn't get a response from the AI provider within the time limit. The request timed out after 3 minutes.\n\nPlease check that ${this.config.provider.name} is running correctly at ${this.config.provider.apiEndpoint} with the model "${this.config.provider.modelName}" and try again with a simpler request.`;
                }
                
                return `I received your request in ${mode} mode, but I couldn't connect to the AI provider.\n\nPlease make sure ${this.config.provider.name} is running at ${this.config.provider.apiEndpoint} with the model "${this.config.provider.modelName}" available.`;
            } finally {
                clearTimeout(timeoutId);
            }
        } catch (error) {
            console.error('Error in sendRequest:', error);
            
            return `I received your message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"\n\nHowever, there was an error processing your request. ${error instanceof Error ? error.message : 'Please try again later.'}`;
        }
    }

    private getSystemPrompt(mode: 'chat' | 'agent' | 'ask'): string {
        const isTranslationMode = mode === 'chat' && this.detectTranslationRequest();
        
        if (isTranslationMode) {
            return `You are an AI assistant specialized in translation tasks. When translating files:
                - Preserve all code functionality and structure
                - Translate only comments, strings, text content, and documentation
                - Do not change variable names, function names, or code logic
                - Return the complete translated content for each file inside a code block
                - Format each file as: \`\`\`filetype\npath/to/file.ext\ncomplete translated content\n\`\`\`
                - Do NOT include the original content alongside the translation
                - Keep the same file format and indentation as the original`;
        }
        
        switch (mode) {
            case 'agent':
                return `You are an AI coding agent that can autonomously perform tasks in the VSCode workspace. You can:
                    - Analyze code and suggest improvements
                    - Create new files and implement features
                    - Debug issues and fix problems
                    - Refactor code following best practices
                    
                    IMPORTANT FILE OPERATION INSTRUCTIONS:
                    
                    1. FILE CREATION:
                    - When asked to create a file, format it as:
                      \`\`\`[language]\n[path/to/file.ext]\n[complete code content]\n\`\`\`
                    - Example:
                      \`\`\`typescript\nsrc/utils/formatter.ts\nexport function format() {...}\n\`\`\`
                    - You can use any of these formats:
                      - With language specifier: \`\`\`typescript\npath/to/file.ts\ncontent\n\`\`\`
                      - With file path as first line: \`\`\`\npath/to/file.ts\ncontent\n\`\`\`
                      - Alternative format: \`\`\`file\nfilename: path/to/file.ts\n\ncontent\n\`\`\`
                    
                    2. FILE UPDATES:
                    - For file updates, provide the FULL new content, not just changes
                    - Always indicate clearly what changes you've made to the file
                    - Show understanding of the existing code structure
                    - Preserve imports, module structure, and formatting conventions
                    
                    3. CONTEXT AWARENESS:
                    - First analyze the codebase structure and understand existing patterns
                    - Follow existing code style, naming conventions, and design patterns
                    - For new files, check related files to maintain consistency
                    - Understand project architecture before making changes
                    - Use existing dependencies rather than introducing new ones
                    
                    4. RELIABILITY BEST PRACTICES:
                    - Provide complete implementations, not just stubs or examples
                    - Include robust error handling in your code
                    - Include imports needed for your code to work
                    - Make sure generated code is properly indented and formatted
                    - When updating files, make sure your changes won't break existing functionality
                    - Think through edge cases and handle them appropriately
                    
                    5. CLEAR COMMUNICATION:
                    - Clearly explain what files you're creating/modifying and why
                    - Describe the purpose and functionality of added code
                    - If you're uncertain about something, describe alternatives
                    - When working on complex tasks, describe your approach first
                    
                    GENERAL PRINCIPLES:
                    - Be proactive and thorough in your implementations
                    - If a previous file creation failed, try an alternative format
                    - Maintain context from previous messages in ongoing conversations
                    - When unclear about requirements, ask clarifying questions first
                    - If asked to implement a feature, provide a complete implementation
                    - Follow clean code principles and project conventions`;
            
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

    private detectTranslationRequest(): boolean {
        if (this.conversationHistory.length > 0) {
            const recentMessages = this.conversationHistory.slice(-3);
            
            for (const message of recentMessages) {
                if (message.role === 'user' && this.isTranslationRequest(message.content)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    public updateConfig(newConfig: Partial<AIEngineConfig>) {
        this.config = { ...this.config, ...newConfig };
        
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
        const mcpProvider = this.getMCPProvider();
        if (mcpProvider && mcpProvider.constructor && mcpProvider.constructor.name !== 'AIEngine') {
            try {
                const response = await mcpProvider.chat(messages);
                return response;
            } catch (error) {
                console.warn('Error using MCP provider, falling back to local:', error);
            }
        }
        
        try {
            const { provider, maxTokens, temperature } = this.config;
            
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

    private updateContext(request: AIRequest, response: AIResponse | string): void {
        this.conversationHistory.push(...request.messages);

        const responseContent = typeof response === 'string' ? response : response.message;

        this.conversationHistory.push({
            role: 'assistant',
            content: responseContent,
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
            console.log("Using dummy embeddings for testing purposes");
            
            const embeddingLength = 1536;
            const embedding = new Array(embeddingLength).fill(0).map(() => Math.random() * 2 - 1);
            
            const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
            const normalizedEmbedding = embedding.map(val => val / magnitude);
            
            return normalizedEmbedding;
        } catch (error) {
            console.error("Error generating embeddings:", error);
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
            const files = codebaseIndex.getAllDocuments();
            if (!files || files.length === 0) {
                return "Codebase is indexed but no files were found.";
            }
            
            let result = `Found ${files.length} files in the codebase.\n\n`;
            
            const filesByDir = new Map<string, string[]>();
            files.forEach((file: IndexedFile) => {
                const filePath = file.path;
                const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1) || '/';
                if (!filesByDir.has(dir)) {
                    filesByDir.set(dir, []);
                }
                filesByDir.get(dir)?.push(filePath);
            });
            
            result += "Directory structure:\n";
            filesByDir.forEach((files, dir) => {
                result += `- ${dir}: ${files.length} files\n`;
            });
            
            result += "\nKey files:\n";
            
            const keyFiles = files.filter((file: IndexedFile) => 
                file.path.toLowerCase().includes('readme') || 
                file.path.toLowerCase().includes('index') ||
                file.path.toLowerCase().includes('overview') ||
                file.path.toLowerCase().includes('config') ||
                file.path.toLowerCase().includes('main')
            );
            
            keyFiles.forEach((file: IndexedFile) => {
                const preview = file.content.substring(0, 300) + (file.content.length > 300 ? '...' : '');
                result += `\n## ${file.path}\n${preview}\n`;
            });
            
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

    private async extractAndProcessFileContent(response: string): Promise<void> {
        try {
            console.log('Extracting file content from response');
            console.log('Response preview:', response.substring(0, 200) + '...');
            
            const fileOperationManager = FileOperationManager.getInstance();
            
            // Enhanced regex patterns to handle more formats including those used by newer AI models
            const fileBlockRegexes = [
                // Original patterns
                /```(?:file|[\w-]+)?\s*(?:title=)?[`'"]?([\w\-\./\\]+\.\w+)[`'"]?\s*\n([\s\S]*?)```/g,
                /### File: ([\w\-\./\\]+\.\w+)\s*```(?:[\w-]+)?\s*\n([\s\S]*?)```/g,
                /```(?:markdown|md)?\s*\n### File: ([\w\-\./\\]+\.\w+)\s*\n\n([\s\S]*?)```/g,
                /```markdown\n### File: ([\w\-\./\\]+\.\w+)\s*\n([\s\S]*?)```/g,
                /```markdown\n### File: ([\w\-\./\\]+\.\w+)\n\n([\s\S]*?)```/g,
                /File: ([\w\-\./\\]+\.\w+)[\s\n]+([\s\S]*?)(?=```|$)/g,
                
                // New patterns for more robust detection
                /```([\w-]*)\n([\w\-\./\\]+\.\w+)\n([\s\S]*?)```/g, // Format used by Claude and GPT models
                /```\s*([a-zA-Z0-9_\-\.\/\\]+\.[a-zA-Z0-9]+)\s*\n([\s\S]*?)```/g, // File path directly in code fence
                /```[\w-]+\s*path=["|']?([\w\-\./\\]+\.\w+)["|']?\s*\n([\s\S]*?)```/g, // Path attribute format
                /Create file[:\s]*([\w\-\./\\]+\.\w+)[\s\n]+```(?:[\w-]+)?\s*\n([\s\S]*?)```/gi, // Create file instruction
                /```[\w-]*\s*\[\[file:([\w\-\./\\]+\.\w+)\]\]\s*\n([\s\S]*?)```/g, // Cursor-style file notation
                /<file[\s]+path=["|']([\w\-\./\\]+\.\w+)["|'][\s]*>\n([\s\S]*?)<\/file>/g, // XML-like tag format
                /```file\n(?:filename|path): ([\w\-\./\\]+\.\w+)\n\n([\s\S]*?)```/g, // Filename/path declaration format
                /\bFile\b[:\s]+"([\w\-\./\\]+\.\w+)"[\s\n]+([\s\S]*?)(?=(?:```|$))/g // "File: filename" with quotes
            ];
            
            // Parse file operations from the response
            interface ExtractedFileOperation {
                type: 'add' | 'update';
                filePath: string;
                absolutePath: string;
                fileContent: string;
                exists: boolean;
                originalContent?: string;
            }
            
            // Track all file operations to handle multi-file operations better
            const extractedOperations: ExtractedFileOperation[] = [];
            
            let filesFound = false;
            let regexIndex = 0;
            
            for (const regex of fileBlockRegexes) {
                console.log(`Trying regex pattern ${regexIndex+1}`);
                let match;
                
                while ((match = regex.exec(response)) !== null) {
                    filesFound = true;
                    const filePath = match[1].trim();
                    const fileContent = match[regex === fileBlockRegexes[6] ? 3 : 2]; // Special case for the pattern with language in group 1
                    
                    console.log(`Match found with regex ${regexIndex+1}:`);
                    console.log(`- File path: ${filePath}`);
                    console.log(`- Content length: ${fileContent?.length || 0} characters`);
                    
                    if (!filePath || !fileContent) {
                        console.log('Skipping due to missing path or content');
                        continue;
                    }
                    
                    console.log(`Found file content for: ${filePath}`);
                    
                    let absolutePath = filePath;
                    if (!path.isAbsolute(filePath)) {
                        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                            absolutePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
                            console.log(`Resolved absolute path: ${absolutePath}`);
                        } else {
                            console.warn('No workspace folder found, using relative path');
                        }
                    }
                    
                    const fileExists = fs.existsSync(absolutePath);
                    console.log(`File exists: ${fileExists}`);
                    
                    if (fileExists) {
                        const originalContent = fs.readFileSync(absolutePath, 'utf8');
                        extractedOperations.push({
                            type: 'update',
                            filePath,
                            absolutePath,
                            fileContent,
                            exists: true,
                            originalContent
                        });
                    } else {
                        extractedOperations.push({
                            type: 'add',
                            filePath,
                            absolutePath,
                            fileContent,
                            exists: false
                        });
                    }
                }
                
                regexIndex++;
            }
            
            if (!filesFound) {
                console.log('No file content blocks found in the AI response');
                return;
            }
            
            // Extract task/feature description from the AI response
            let operationDescription = "AI-generated file operations";
            
            // Try to extract a description from the first paragraph of the response
            const firstParagraphMatch = response.match(/^([^\n]+)/);
            if (firstParagraphMatch && firstParagraphMatch[1].length > 10 && firstParagraphMatch[1].length < 100) {
                operationDescription = firstParagraphMatch[1];
            }
            
            // Create file operations group based on the extracted operations
            if (extractedOperations.length > 0) {
                const operationsList = extractedOperations.map(op => {
                    if (op.type === 'add') {
                        return {
                            type: 'add' as const,
                            filePath: op.absolutePath,
                            content: op.fileContent
                        };
                    } else {
                        return {
                            type: 'update' as const,
                            filePath: op.absolutePath,
                            content: op.fileContent,
                            originalContent: op.originalContent
                        };
                    }
                });
                
                try {
                    if (extractedOperations.length === 1) {
                        // For single file operations, process directly
                        const op = extractedOperations[0];
                        
                        if (op.type === 'add') {
                            const description = `Create new file ${path.basename(op.filePath)} with AI-generated content`;
                            const operation = await fileOperationManager.createAddOperation(op.absolutePath, op.fileContent, description);
                            await fileOperationManager.acceptOperation(operation.id);
                            console.log(`New file ${op.filePath} created with content`);
                        } else if (op.type === 'update' && op.originalContent !== undefined) {
                            // Only update if content is different
                            if (op.originalContent !== op.fileContent) {
                                const description = `Update file ${path.basename(op.filePath)} with AI-generated content`;
                                const operation = await fileOperationManager.createUpdateOperation(
                                    op.absolutePath, 
                                    op.originalContent, 
                                    op.fileContent, 
                                    description
                                );
                                await fileOperationManager.acceptOperation(operation.id);
                                console.log(`File ${op.filePath} updated with new content`);
                            } else {
                                console.log(`File content unchanged, no update needed for ${op.filePath}`);
                            }
                        }
                    } else {
                        // For multiple files, create an operation group
                        const group = await fileOperationManager.createOperationGroup(
                            operationsList,
                            operationDescription
                        );
                        
                        // Show a summary of the changes
                        const message = `${group.operations.length} file operations proposed by AI. Would you like to apply all changes?`;
                        const result = await vscode.window.showInformationMessage(
                            message,
                            { modal: false },
                            'Apply All', 
                            'Review Each', 
                            'Cancel'
                        );
                        
                        if (result === 'Apply All') {
                            await fileOperationManager.acceptGroup(group.id);
                            console.log(`Applied all operations in group ${group.id}`);
                        } else if (result === 'Review Each') {
                            for (const operation of group.operations) {
                                const filePath = operation.filePath;
                                const operationType = operation.type === 'add' ? 'Create' : 'Update';
                                const message = `${operationType} file ${path.basename(filePath)}?`;
                                
                                const review = await vscode.window.showInformationMessage(
                                    message,
                                    { modal: false },
                                    'Apply', 
                                    'Skip'
                                );
                                
                                if (review === 'Apply') {
                                    await fileOperationManager.acceptOperation(operation.id);
                                    console.log(`Applied operation: ${operation.id}`);
                                } else {
                                    await fileOperationManager.rejectOperation(operation.id);
                                    console.log(`Skipped operation: ${operation.id}`);
                                }
                            }
                        } else {
                            await fileOperationManager.rejectGroup(group.id);
                            console.log('All operations cancelled');
                        }
                    }
                } catch (error) {
                    console.error('Error processing file operations:', error);
                    vscode.window.showErrorMessage(`Error processing file operations: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        } catch (error) {
            console.error('Error extracting file content:', error);
            vscode.window.showErrorMessage(`Error processing file operations: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private isTranslationRequest(message: string): boolean {
        const normalizedMessage = message.toLowerCase();
        
        const translationPatterns = [
            'translate', 'translation', 'çevir', 'çeviri', 'türkçe', 
            'übersetz', 'traducir', 'tradui', 'tradução', 'traduzione',
            'convert to', 'tercüme et', 'in another language', 'localiz',
            'güncelleyelim'
        ];
        
        const isTranslation = translationPatterns.some(pattern => normalizedMessage.includes(pattern));
        
        console.log(`Checking if message is a translation request: ${isTranslation}`, 
                   isTranslation ? `Matched pattern in: ${normalizedMessage.substring(0, 50)}...` : '');
        
        return isTranslation;
    }

    private async sendStreamingRequest(
        message: string, 
        options: ProcessOptions, 
        mode: 'chat' | 'agent' | 'ask',
        onChunk: (chunk: string) => void
    ): Promise<string> {
        let enhancedMessage = message;
        
        const containsFileContent = message.includes('```') && 
                                  (message.includes('### File:') || 
                                   message.includes('# ') || 
                                   message.includes('## '));
            
        const hasAttachments = options?.options?.attachments?.length > 0;
        if (hasAttachments && !containsFileContent) {
            const attachmentsWithContent = options?.options?.attachments?.filter((a: any) => a.type === 'file' && a.content) || [];
            
            if (attachmentsWithContent.length > 0) {
                enhancedMessage += "\n\n";
                
                attachmentsWithContent.forEach((attachment: any) => {
                    const fileName = attachment.name || attachment.path.split(/[\/\\]/).pop() || 'file';
                    enhancedMessage += `### File: ${fileName}\n\`\`\`\n${attachment.content}\n\`\`\`\n\n`;
                });
                
                const isTranslationRequest = this.isTranslationRequest(message);
                
                if (isTranslationRequest) {
                    enhancedMessage += "\nPlease translate the content of these files and return the full translated content in code blocks with the original file names.";
                }
            }
        }
        
        let codebaseContext = '';
        const isCodebaseQuery = message.toLowerCase().includes('codebase') || 
                              message.startsWith('@') || 
                              message.includes('code base');
                              
        if (isCodebaseQuery) {
            if (this.ragService && this.ragService.isEnabled()) {
                const enhancedContext = await this.ragService.enhanceQueryWithContext(message);
                codebaseContext = enhancedContext.relevantContext;
            } else if (options.codebaseIndex) {
                codebaseContext = this.prepareCodebaseContext(message, options.codebaseIndex);
            }
        }
        
        let systemPrompt = this.getSystemPrompt(mode);
        if (codebaseContext) {
            systemPrompt += `\n\nHere is information about the codebase:\n${codebaseContext}`;
        }
        
        let contextualHistory = '';
        if (options.contextHistory && options.contextHistory.length > 0) {
            contextualHistory = "\n\nHere is some context from previous messages:\n";
            options.contextHistory.forEach(msg => {
                contextualHistory += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
            });
            contextualHistory += "\nPlease consider the above context when responding.";
        }
        
        if (contextualHistory) {
            systemPrompt += contextualHistory;
        }
        
        const cleanOptions = options.options || {};
        
        try {
            // Basit bir mockup streaming yanıtı oluşturalım
            const mockResponse = await this.sendRequestInternal(message, options, mode);
            
            // Yanıtı parçalara bölerek stream edelim
            if (onChunk && mockResponse) {
                const chunkSize = this.responseChunkSize || 200;
                for (let i = 0; i < mockResponse.length; i += chunkSize) {
                    const chunk = mockResponse.substring(i, Math.min(i + chunkSize, mockResponse.length));
                    onChunk(chunk);
                    // Gerçek streaming hissi için kısa bekletme
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
            return mockResponse;
        } catch (error) {
            console.error('Error in streaming request:', error);
            const response = await this.sendRequestInternal(message, options, mode);
            
            // Hata durumunda da son yanıtı tek seferde chunk olarak gönderelim
            if (onChunk && response) {
                onChunk(response);
            }
            
            return response;
        }
    }

    // New helper method to process message more efficiently
    public async processMessageWithStream(
        text: string, 
        options: ProcessOptions, 
        mode: 'chat' | 'agent' | 'ask',
        onProgress: (chunk: string) => void
    ): Promise<string> {
        try {
            const hasAttachments = options?.options?.attachments?.length > 0;
            
            // Skip embedding and cache check when attachments are present
            if (!hasAttachments) {
                // Optimization: Only generate embeddings for cache lookup in non-streaming mode
                // or if explicitly requested (to avoid the embedding generation overhead when streaming)
                const shouldCheckCache = options?.options?.checkCache !== false;
                
                if (shouldCheckCache) {
                    try {
                        const queryEmbedding = await this.generateEmbeddings(text);
                        
                        if (queryEmbedding) {
                            const cachedResponse = this.responseCache.findSimilarResponse(
                                text, 
                                queryEmbedding, 
                                mode
                            );
                            
                            if (cachedResponse) {
                                console.log('Found cached response, returning immediately');
                                // For cached responses, we still want the streaming experience
                                // Send chunks of the cached response to simulate streaming
                                if (onProgress) {
                                    const chunkSize = 50;
                                    for (let i = 0; i < cachedResponse.length; i += chunkSize) {
                                        const chunk = cachedResponse.substring(i, i + chunkSize);
                                        onProgress(chunk);
                                        // Small delay to simulate streaming
                                        await new Promise(resolve => setTimeout(resolve, 10));
                                    }
                                }
                                return cachedResponse;
                            }
                        }
                    } catch (error) {
                        console.warn('Error generating embedding for cache check:', error);
                    }
                }
            }
            
            // Stream the response
            const response = await this.sendStreamingRequest(text, options, mode, onProgress);
            
            // Process any file operations
            await this.processFileOperations(response);
            
            // Cache the response if it wasn't an attachment-based query
            if (!hasAttachments && options?.options?.saveToCache !== false) {
                try {
                    const queryEmbedding = await this.generateEmbeddings(text);
                    if (queryEmbedding) {
                        this.responseCache.addResponse(text, queryEmbedding, response, mode);
                    }
                } catch (error) {
                    console.warn('Error saving response to cache:', error);
                }
            }
            
            return response;
        } catch (error) {
            console.error('Error in processMessageWithStream:', error);
            const errorMessage = `I encountered an error while processing your request: ${error instanceof Error ? error.message : String(error)}`;
            if (onProgress) {
                onProgress(errorMessage);
            }
            return errorMessage;
        }
    }

    /**
     * Process file operations from a response and return the result
     * Public method for agent system to use
     */
    public async processFileOperations(response: string): Promise<{
        success: boolean;
        operationIds: string[];
        filePaths: string[];
    }> {
        try {
            // Store original operations count to track new operations
            const fileOperationManager = FileOperationManager.getInstance();
            const originalOperations = fileOperationManager.getPendingOperations();
            const originalCount = originalOperations.length;
            
            // Extract and process file content
            await this.extractAndProcessFileContent(response);
            
            // Get new operations
            const currentOperations = fileOperationManager.getPendingOperations();
            const newOperations = currentOperations.slice(originalCount);
            
            // Extract operation IDs and file paths
            const operationIds = newOperations.map(op => op.id);
            const filePaths = newOperations.map(op => op.filePath);
            
            return {
                success: true,
                operationIds,
                filePaths
            };
        } catch (error) {
            console.error('Error processing file operations:', error);
            return {
                success: false,
                operationIds: [],
                filePaths: []
            };
        }
    }

    /**
     * Checks if there's a server provider available and returns it, otherwise returns this AIEngine
     */
    private getAIProvider(): AIProvider {
        try {
            const extensionExports = require('../extension');
            if (extensionExports && extensionExports.extension) {
                const extension = extensionExports.extension as SmileAIExtension;
                if (extension.getAIProvider) {
                    const provider = extension.getAIProvider();
                    if (provider && provider.constructor && provider.constructor.name !== 'AIEngine') {
                        console.log('Using external provider for AI request');
                        return provider;
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to get MCP provider, using local AI engine:', error);
        }
        
        return this;
    }
    
    /**
     * Implements chat method from AIProvider interface
     */
    public async chat(messages: AIMessage[], systemPrompt?: string, options?: any): Promise<AIResponse> {
        try {
            const request: AIRequest = {
                messages,
                systemPrompt
            };
            
            // Special handling for streaming if needed
            if (options?.stream && options?.onChunk) {
                // Streaming logic...
                let fullResponse = '';
                // Implementation for streaming would go here
                
                return { message: fullResponse };
            } else {
                return this.sendRequest(request);
            }
        } catch (error) {
            console.error('Error in chat:', error);
            return {
                message: `Error in chat: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Implements analyzeCode from AIProvider interface
     */
    public async analyzeCode(code: string, language: string, filePath?: string): Promise<any> {
        try {
            const request: AIRequest = {
                messages: [
                    {
                        role: 'system',
                        content: `You are a code analysis assistant. Analyze the following ${language} code and provide insights.`
                    },
                    {
                        role: 'user',
                        content: `Analyze this code from ${filePath || 'unknown source'}:\n\`\`\`${language}\n${code}\n\`\`\``
                    }
                ]
            };
            
            const response = await this.sendRequest(request);
            return {
                analysis: response.message,
                success: true
            };
        } catch (error) {
            console.error('Error analyzing code:', error);
            return {
                success: false,
                error: String(error)
            };
        }
    }
    
    /**
     * Implements executeTask from AIProvider interface
     */
    public async executeTask(task: Task): Promise<TaskResult> {
        try {
            const request: AIRequest = {
                messages: [
                    {
                        role: 'system',
                        content: `You are an AI coding assistant executing the following task: ${task.description}`
                    },
                    {
                        role: 'user',
                        content: task.description
                    }
                ]
            };
            
            const response = await this.sendRequest(request);
            
            return {
                success: true,
                data: response.message
            };
        } catch (error) {
            console.error('Error executing task:', error);
            return {
                success: false,
                error: String(error)
            };
        }
    }
    
    /**
     * Implements queryLLM from AIProvider interface
     */
    public async queryLLM(prompt: string, context?: any): Promise<AIResponse> {
        try {
            const request: AIRequest = {
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                context
            };
            
            return this.sendRequest(request);
        } catch (error) {
            console.error('Error querying LLM:', error);
            return {
                message: `Error querying LLM: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Implements isConnected from AIProvider interface
     */
    public isConnected(): boolean {
        // Local AIEngine always considered connected
        return true;
    }
    
    /**
     * Gets MCP provider if available
     */
    private getMCPProvider(): AIProvider | null {
        try {
            console.log('🚀 [getMCPProvider] MCP provider kontrolü başlatılıyor...');
            const extensionExports = require('../extension');
            
            if (extensionExports && extensionExports.extension) {
                console.log('✅ [getMCPProvider] Extension örneği bulundu');
                const extension = extensionExports.extension as SmileAIExtension;
                
                if (extension.getAIProvider) {
                    console.log('✅ [getMCPProvider] getAIProvider metodu extension üzerinde mevcut');
                    const provider = extension.getAIProvider();
                    
                    if (provider) {
                        console.log('🛰️ [getMCPProvider] Provider türü:', typeof provider,
                                  'Constructor adı:', provider.constructor ? provider.constructor.name : 'bilinmiyor',
                                  'isConnected metodu var mı:', typeof provider.isConnected === 'function' ? 'Evet' : 'Hayır');
                        
                        if (provider.isConnected && typeof provider.isConnected === 'function') {
                            console.log('🔌 [getMCPProvider] Provider bağlantı durumu:', provider.isConnected() ? 'Bağlı' : 'Bağlı değil');
                        }
                    } else {
                        console.log('⚠️ [getMCPProvider] Provider null');
                    }
                    
                    if (provider && provider.constructor && provider.constructor.name !== 'AIEngine') {
                        console.log('✅ [getMCPProvider] Harici MCP provider bulundu - kullanılacak');
                        return provider;
                    } else {
                        console.log('⚠️ [getMCPProvider] Provider ya null ya da self-reference - yerel motor kullanılacak');
                    }
                } else {
                    console.log('❌ [getMCPProvider] getAIProvider metodu extension üzerinde bulunamadı');
                }
            } else {
                console.log('❌ [getMCPProvider] Extension exports bulunamadı');
            }
        } catch (error) {
            console.warn('❌ [getMCPProvider] MCP provider alınırken hata:', error);
        }
        
        return null;
    }
    
    // ... rest of the class (keep all the existing methods) ...
} 