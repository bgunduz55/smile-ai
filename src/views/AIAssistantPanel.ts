import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { ModelManager } from '../utils/ModelManager';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';
import { FileAnalyzer } from '../utils/FileAnalyzer';
import { Message } from '../types/chat';

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

            // Process message with chat mode
            console.log('Processing message with chat mode:', text);
            const response = await this.aiEngine.processMessage(text, {
                options: options,
                codebaseIndex: this.codebaseIndexer.getIndex()
            });

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
        if (this.isIndexing) return;
        
        this.isIndexing = true;
        try {
            await this.codebaseIndexer.indexWorkspace();
            this.webviewView.webview.postMessage({
                type: 'indexingComplete'
            });
        } catch (error) {
            console.error('Indexing error:', error);
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
                content: 'Welcome to Smile AI! I\'m ready to help you with your code. You can ask questions, get explanations, or request code changes.',
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
                    <div class="messages" id="messages"></div>
                    <div class="input-container">
                        <textarea id="messageInput" placeholder="Type your message..."></textarea>
                        <button id="sendButton">Send</button>
                    </div>
                </div>
            </body>
            </html>`;
            
            // Wait a bit for the webview to initialize before sending messages
            setTimeout(() => {
                console.log('Sending welcome message to webview');
                webview.postMessage({ 
                    command: 'addMessage', 
                    message: welcomeMessage
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
                }
            },
            undefined,
            this.disposables
        );
    }

    public dispose() {
        AIAssistantPanel.currentPanel = undefined;

        this.disposables.forEach(d => d.dispose());
    }
} 