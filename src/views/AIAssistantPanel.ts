import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { ModelManager } from '../utils/ModelManager';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';
import { FileAnalyzer } from '../utils/FileAnalyzer';
import { Message } from '../types/chat';
import { FileOperationManager } from '../utils/FileOperationManager';

export class AIAssistantPanel {
    public static currentPanel: AIAssistantPanel | undefined;
    private readonly webviewView: vscode.WebviewView;
    private readonly context: vscode.ExtensionContext;
    private readonly disposables: vscode.Disposable[] = [];
    private aiEngine: AIEngine;
    private messages: Message[] = [];
    private modelManager: ModelManager;
    private codebaseIndexer: CodebaseIndexer;
    private fileAnalyzer: FileAnalyzer;
    private isIndexing: boolean = false;
    private isAIEngineReady: boolean = false;

    constructor(
        webviewView: vscode.WebviewView,
        context: vscode.ExtensionContext,
        aiEngine: AIEngine,
        modelManager: ModelManager,
        codebaseIndexer: CodebaseIndexer
    ) {
        console.log('Initializing AIAssistantPanel');
        this.webviewView = webviewView;
        this.context = context;
        this.aiEngine = aiEngine;
        this.modelManager = modelManager;
        this.codebaseIndexer = codebaseIndexer;
        this.fileAnalyzer = FileAnalyzer.getInstance();
        
        // Set up FileOperationManager
        const fileOperationManager = FileOperationManager.getInstance();
        fileOperationManager.setWebviewView(webviewView);
        
        // Initialize components independently
        this.initializeAIEngine()
            .catch((error: Error) => this.handleError('AI Engine initialization failed', error));
        
        // Setup webview asynchronously
        this.setupWebview()
            .catch((error: Error) => this.handleError('Webview setup failed', error));
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Start indexing in the background
        this.indexCodebase()
            .catch((error: Error) => this.handleError('Codebase indexing failed', error));
    }

    private async initializeAIEngine(): Promise<void> {
        try {
            const activeModel = this.modelManager.getActiveModel();
            console.log('Active model:', activeModel);
            
            if (activeModel) {
                this.aiEngine = new AIEngine({
                    provider: {
                        name: activeModel.provider,
                        modelName: activeModel.modelName,
                        apiEndpoint: activeModel.apiEndpoint
                    },
                    maxTokens: activeModel.maxTokens || 2048,
                    temperature: activeModel.temperature || 0.7
                });
                this.isAIEngineReady = true;
            } else {
                // Prompt for model configuration without blocking
                this.showModelConfigurationRequired();
                await this.modelManager.promptAddModel();
                const model = this.modelManager.getActiveModel();
                if (model) {
                    this.aiEngine = new AIEngine({
                        provider: {
                            name: model.provider,
                            modelName: model.modelName,
                            apiEndpoint: model.apiEndpoint
                        },
                        maxTokens: model.maxTokens || 2048,
                        temperature: model.temperature || 0.7
                    });
                    this.isAIEngineReady = true;
                }
            }
        } catch (error) {
            this.isAIEngineReady = false;
            throw error;
        }
    }

    private setupEventListeners(): void {
        // Workspace event listeners
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(
                this.handleDocumentChange.bind(this)
            ),
            vscode.window.onDidChangeActiveTextEditor(
                this.handleEditorChange.bind(this)
            )
        );
    }

    private showModelConfigurationRequired(): void {
        const message = "AI model configuration required";
        const configureButton = "Configure";
        
        vscode.window.showWarningMessage(message, configureButton)
            .then(selection => {
                if (selection === configureButton) {
                    this.modelManager.promptAddModel()
                        .catch(error => this.handleError('Model configuration failed', error));
                }
            });
    }

    private handleError(context: string, error: any): void {
        console.error(`${context}:`, error);
        
        // Send error to webview if available
        if (this.webviewView?.webview) {
            this.webviewView.webview.postMessage({
                command: 'showError',
                error: {
                    message: `${context}: ${error.message || 'Unknown error'}`,
                    details: error.stack
                }
            });
        }
        
        // Show error in VS Code UI
        vscode.window.showErrorMessage(`${context}: ${error.message || 'Unknown error'}`);
    }

    private async handleUserMessage(text: string, options: any): Promise<void> {
        if (!this.isAIEngineReady) {
            this.showModelConfigurationRequired();
            return;
        }

        try {
            // Add user message to UI immediately
            const userMessage: Message = {
                role: 'user',
                content: text,
                timestamp: Date.now()
            };
            this.messages.push(userMessage);
            this.webviewView.webview.postMessage({
                command: 'addMessage',
                message: userMessage
            });

            // Show loading state
            this.webviewView.webview.postMessage({
                command: 'showLoading'
            });

            // Enhanced agent mode detection with more context awareness
            // Check if the user's message contains action-oriented keywords that suggest agent mode
            const agentModeKeywords = [
                // Explicit action verbs (English & Turkish)
                'ekle', 'oluştur', 'yarat', 'düzenle', 'güncelle', 'sil', 'değiştir', 'yaz', 'kodla',
                'add', 'create', 'make', 'edit', 'update', 'delete', 'change', 'modify', 'write', 'code',
                'fix', 'implement', 'generate', 'build', 'develop', 'refactor', 'improve',
                
                // File type references suggesting creation
                '.md', '.js', '.ts', '.html', '.css', '.json', '.yml', '.yaml', '.txt', '.xml',
                'dosya', 'file', 'document', 'script', 'class', 'component', 'module',
                
                // Implied creation phrases
                'yeni', 'new', 'oluşturabilir misin', 'can you create', 'dosyası', 'bir md', 'a file', 
                'özellik', 'feature', 'implement', 'generate', 'need to have', 'olmalı',
                'ekler misin', 'could you add', 'should be created'
            ];
            
            // Check for contextual clues that suggest an agent mode response
            const previousMessages = this.messages.slice(-5); // Get the last 5 messages for context
            let containsFollowUpCue = false;
            
            // Check if this message seems to be following up on a previous request
            // by looking for phrases that imply correction or continuation
            const followUpPhrases = [
                'ama', 'but', 'instead', 'yerine', 'aslında', 'actually', 'hatırlayarak',
                'remember', 'hala', 'still', 'tekrar', 'again', 'bir daha', 'once more',
                'doğru', 'correct', 'yanlış', 'wrong', 'olmadı', 'didn\'t work',
                'yapamadı', 'couldn\'t', 'çalışmadı', 'didn\'t work'
            ];
            
            const containsFollowUpPhrase = followUpPhrases.some(phrase => 
                text.toLowerCase().includes(phrase.toLowerCase())
            );
            
            // If this seems like a follow-up message, check if we have a previous agent response
            if (containsFollowUpPhrase) {
                const hasPreviousAgentResponse = previousMessages.some(msg => 
                    msg.role === 'assistant' && 
                    (msg.content.includes('```') || // Contains code block
                     msg.content.includes('file') || // References a file
                     msg.content.includes('dosya')) // References a file in Turkish
                );
                
                if (hasPreviousAgentResponse) {
                    containsFollowUpCue = true;
                }
            }
            
            // Determine if agent mode should be used
            const containsAgentKeyword = agentModeKeywords.some(keyword => 
                text.toLowerCase().includes(keyword.toLowerCase())
            );
            
            const shouldUseAgentMode = containsAgentKeyword || containsFollowUpCue;
            
            let response;
            if (shouldUseAgentMode) {
                // Process message with agent mode for action-oriented requests
                console.log('Processing message with agent mode:', text);
                
                // If this is a follow-up, provide the context of previous messages
                const contextHistory = containsFollowUpCue ? previousMessages.map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp || Date.now() // Ensure timestamp is always a number
                })) : [];
                
                response = await this.aiEngine.processAgentMessage(text, {
                    options: options,
                    codebaseIndex: this.codebaseIndexer.getIndex(),
                    contextHistory: contextHistory
                });
            } else {
                // Process message with chat mode for Q&A
                console.log('Processing message with chat mode:', text);
                response = await this.aiEngine.processMessage(text, {
                    options: options,
                    codebaseIndex: this.codebaseIndexer.getIndex()
                });
            }

            // Add assistant response
            const assistantMessage: Message = {
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            };
            this.messages.push(assistantMessage);

            // Hide loading and show response
            this.webviewView.webview.postMessage({
                command: 'hideLoading'
            });
            this.webviewView.webview.postMessage({
                command: 'addMessage',
                message: assistantMessage
            });
        } catch (error) {
            // Hide loading state
            this.webviewView.webview.postMessage({
                command: 'hideLoading'
            });

            // Show error message in chat
            const errorMessage: Message = {
                role: 'assistant',
                content: `I encountered an error while processing your request: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease try again or check your AI model configuration.`,
                timestamp: Date.now()
            };
            this.messages.push(errorMessage);
            this.webviewView.webview.postMessage({
                command: 'addMessage',
                message: errorMessage
            });

            this.handleError('Message processing failed', error instanceof Error ? error : new Error('Unknown error'));
        }
    }

    private async indexCodebase() {
        console.log('Starting codebase indexing from AIAssistantPanel');
        if (this.isIndexing) {
            console.log('Indexing already in progress');
            return;
        }
        
        this.isIndexing = true;
        try {
            // First make sure the AI engine is ready
            if (!this.isAIEngineReady) {
                console.log('AI Engine not ready, initializing before indexing');
                await this.initializeAIEngine();
            }
            
            // Then start indexing
            await this.codebaseIndexer.indexWorkspace((message) => {
                console.log('Indexing progress:', message);
            });
            
            console.log('Codebase indexing complete');
            this.webviewView.webview.postMessage({
                type: 'indexingComplete'
            });
        } catch (error) {
            console.error('Codebase indexing error:', error);
            throw error;
        } finally {
            this.isIndexing = false;
        }
    }

    private async handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (event.document === vscode.window.activeTextEditor?.document) {
            const fileContext = await this.fileAnalyzer.analyzeFile(event.document.uri);
            this.webviewView.webview.postMessage({
                type: 'contextUpdate',
                context: {
                    file: event.document.fileName,
                    fileContext
                }
            });
        }
    }

    private async handleEditorChange(editor: vscode.TextEditor | undefined) {
        if (editor) {
            const fileContext = await this.fileAnalyzer.analyzeFile(editor.document.uri);
            this.webviewView.webview.postMessage({
                type: 'contextUpdate',
                context: {
                    file: editor.document.fileName,
                    fileContext
                }
            });
        }
    }

    private async handleAddModel() {
        await this.modelManager.promptAddModel();
        this.updateModels();
    }

    private async handleAttachFile() {
        try {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Attach File'
            });

            if (result && result[0]) {
                this.webviewView.webview.postMessage({
                    command: 'fileAttached',
                    path: result[0].fsPath
                });
            }
        } catch (error) {
            console.error('Error attaching file:', error);
        }
    }

    private async handleAttachFolder() {
        try {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Attach Folder'
            });

            if (result && result[0]) {
                this.webviewView.webview.postMessage({
                    command: 'folderAttached',
                    path: result[0].fsPath
                });
            }
        } catch (error) {
            console.error('Error attaching folder:', error);
        }
    }

    private async updateModels() {
        const models = await this.modelManager.getModels();
        this.webviewView.webview.postMessage({
            command: 'updateModels',
            models
        });
    }

    private async setupWebview(): Promise<void> {
        const webview = this.webviewView.webview;

        // Set options
        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                vscode.Uri.joinPath(this.context.extensionUri, 'dist')
            ]
        };

        // Get URIs
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css'));
        const mainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));

        try {
            console.log('Setting up webview in AIAssistantPanel');
            
            // Create a welcome message
            const welcomeMessage: Message = {
                role: 'system',
                content: 'Welcome to Smile AI! I\'m ready to help you with your code. You can ask questions, get explanations, or request code changes. I\'m indexing your codebase to provide better assistance.',
                timestamp: Date.now()
            };
            
            // Add to our internal messages list
            this.messages.push(welcomeMessage);
            
            // Set HTML content with updated CSP and service worker handling
            webview.html = `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'self' ${webview.cspSource}; script-src 'self' 'unsafe-inline' ${webview.cspSource}; style-src 'self' 'unsafe-inline' ${webview.cspSource} https:; img-src 'self' ${webview.cspSource} https: data:; connect-src 'self' https: http: ws:; font-src https:;">
                <title>Smile AI Assistant</title>
                <link rel="stylesheet" href="${cssUri}">
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons/dist/codicon.css">
                <script>
                    // Unregister any existing service workers
                    if ('serviceWorker' in navigator) {
                        navigator.serviceWorker.getRegistrations().then(function(registrations) {
                            for(let registration of registrations) {
                                registration.unregister();
                            }
                        });
                    }
                </script>
                <script src="${mainUri}" defer></script>
            </head>
            <body>
                <div class="container">
                    <div class="chat-container">
                        <div class="messages" id="messages">
                            <!-- Messages will be inserted here -->
                        </div>
                        <div class="input-container">
                            <div class="input-row">
                                <textarea
                                    class="input-box"
                                    id="messageInput"
                                    placeholder="Ask, search, build anything... (Enter ile gönder, Shift+Enter ile yeni satır)"
                                    rows="1"
                                ></textarea>
                                <button class="send-button" id="sendButton">
                                    <i class="codicon codicon-send"></i>
                                    Send
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Pending file operations container -->
                    <div class="pending-operations" style="display: none;">
                        <!-- File operations will be inserted here -->
                    </div>
                </div>

                <template id="message-template">
                    <div class="message">
                        <div class="avatar">
                            <i class="codicon"></i>
                        </div>
                        <div class="message-content">
                            <div class="markdown-content"></div>
                        </div>
                    </div>
                </template>

                <template id="code-block-template">
                    <div class="code-block">
                        <div class="header">
                            <span class="filename"></span>
                            <button class="copy-button">
                                <i class="codicon codicon-copy"></i>
                            </button>
                        </div>
                        <pre><code></code></pre>
                    </div>
                </template>
            </body>
            </html>`;
            
            // Wait a bit for the webview to initialize before sending messages
            setTimeout(() => {
                console.log('Sending welcome message to webview');
                webview.postMessage({ 
                    command: 'addMessage', 
                    message: welcomeMessage
                });
                
                // Start indexing in the background
                this.indexCodebase()
                    .then(() => {
                        const indexCompleteMessage: Message = {
                            role: 'system',
                            content: 'Codebase indexing complete! I now have a better understanding of your project.',
                            timestamp: Date.now()
                        };
                        this.messages.push(indexCompleteMessage);
                        webview.postMessage({
                            command: 'addMessage',
                            message: indexCompleteMessage
                        });
                    })
                    .catch((error) => {
                        console.error('Error during codebase indexing:', error);
                        const indexErrorMessage: Message = {
                            role: 'system',
                            content: 'There was an issue indexing your codebase. I\'ll still try to help, but my responses might be less accurate.',
                            timestamp: Date.now()
                        };
                        this.messages.push(indexErrorMessage);
                        webview.postMessage({
                            command: 'addMessage',
                            message: indexErrorMessage
                        });
                    });
            }, 1000);
        } catch (error) {
            console.error('Error setting up webview:', error);
        }

        // Handle messages from webview
        webview.onDidReceiveMessage(
            async (message) => {
                console.log('Received message from webview:', message);
                switch (message.command) {
                    case 'sendMessage':
                        await this.handleUserMessage(message.text, message.options || {});
                        break;
                    case 'addModel':
                        await this.handleAddModel();
                        break;
                    case 'attachFile':
                        await this.handleAttachFile();
                        break;
                    case 'attachFolder':
                        await this.handleAttachFolder();
                        break;
                    case 'acceptOperation':
                        await this.handleAcceptOperation(message.id);
                        break;
                    case 'rejectOperation':
                        await this.handleRejectOperation(message.id);
                        break;
                    case 'acceptAllOperations':
                        await this.handleAcceptAllOperations();
                        break;
                    case 'rejectAllOperations':
                        await this.handleRejectAllOperations();
                        break;
                    case 'getOperationDiff':
                        await this.handleGetOperationDiff(message.id);
                        break;
                }
            },
            undefined,
            this.disposables
        );
    }

    private async handleAcceptOperation(id: string): Promise<void> {
        try {
            const fileOperationManager = FileOperationManager.getInstance();
            const success = await fileOperationManager.acceptOperation(id);
            
            if (success) {
                vscode.window.showInformationMessage('File operation applied successfully.');
            } else {
                vscode.window.showErrorMessage('Failed to apply file operation.');
            }
        } catch (error) {
            console.error('Error accepting operation:', error);
            vscode.window.showErrorMessage(`Error applying operation: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleRejectOperation(id: string): Promise<void> {
        try {
            const fileOperationManager = FileOperationManager.getInstance();
            const success = await fileOperationManager.rejectOperation(id);
            
            if (success) {
                vscode.window.showInformationMessage('File operation rejected.');
            } else {
                vscode.window.showErrorMessage('Failed to reject file operation.');
            }
        } catch (error) {
            console.error('Error rejecting operation:', error);
            vscode.window.showErrorMessage(`Error rejecting operation: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleAcceptAllOperations(): Promise<void> {
        try {
            const fileOperationManager = FileOperationManager.getInstance();
            const success = await fileOperationManager.acceptAllOperations();
            
            if (success) {
                vscode.window.showInformationMessage('All file operations applied successfully.');
            } else {
                vscode.window.showErrorMessage('Failed to apply all file operations.');
            }
        } catch (error) {
            console.error('Error accepting all operations:', error);
            vscode.window.showErrorMessage(`Error applying all operations: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleRejectAllOperations(): Promise<void> {
        try {
            const fileOperationManager = FileOperationManager.getInstance();
            const success = await fileOperationManager.rejectAllOperations();
            
            if (success) {
                vscode.window.showInformationMessage('All file operations rejected.');
            } else {
                vscode.window.showErrorMessage('Failed to reject all file operations.');
            }
        } catch (error) {
            console.error('Error rejecting all operations:', error);
            vscode.window.showErrorMessage(`Error rejecting all operations: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleGetOperationDiff(id: string): Promise<void> {
        try {
            const fileOperationManager = FileOperationManager.getInstance();
            const diff = fileOperationManager.getDiff(id);
            
            this.webviewView.webview.postMessage({
                command: 'operationDiff',
                id,
                diff
            });
        } catch (error) {
            console.error('Error getting operation diff:', error);
        }
    }

    public dispose() {
        AIAssistantPanel.currentPanel = undefined;

        this.disposables.forEach(d => d.dispose());
    }
} 