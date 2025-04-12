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

    constructor(
        webviewView: vscode.WebviewView,
        context: vscode.ExtensionContext,
        aiEngine: AIEngine,
        modelManager: ModelManager,
        codebaseIndexer: CodebaseIndexer
    ) {
        console.log('Initializing AIAssistantPanel'); // Debug log
        this.webviewView = webviewView;
        this.context = context;
        this.aiEngine = aiEngine;
        this.modelManager = modelManager;
        this.codebaseIndexer = codebaseIndexer;
        this.fileAnalyzer = FileAnalyzer.getInstance();
        
        // Aktif modeli kontrol et ve AI Engine'i başlat
        const activeModel = this.modelManager.getActiveModel();
        console.log('Active model:', activeModel); // Debug log
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
        } else {
            // Eğer aktif model yoksa, varsayılan olarak Ollama'yı dene
            this.modelManager.promptAddModel().then(() => {
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
                }
            });
        }

        // Workspace değişikliklerini dinle
        vscode.workspace.onDidChangeTextDocument(this.handleDocumentChange, this);
        vscode.window.onDidChangeActiveTextEditor(this.handleEditorChange, this);

        // İlk indexlemeyi başlat
        this.indexCodebase();
        this.setupWebview();
    }

    private setupWebview() {
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

    private async handleUserMessage(text: string, options: any) {
        try {
            console.log('Handling user message:', text); // Debug log
            
            // Add user message
            const userMessage: Message = {
                role: 'user',
                content: text,
                timestamp: Date.now()
            };
            
            // Add attachments if there are any
            if (options?.attachments && options.attachments.length > 0) {
                userMessage.attachments = options.attachments;
            }

            this.messages.push(userMessage);
            
            console.log('Sending user message to webview'); // Debug log
            this.webviewView.webview.postMessage({ 
                command: 'addMessage', 
                message: userMessage 
            });

            // Show loading indicator
            this.webviewView.webview.postMessage({ command: 'showLoading' });

            // Process with AI based on chat mode
            let aiResponse = "";
            try {
                console.log('Processing message with chat mode:', options?.chatMode || 'chat'); // Debug log
                switch (options?.chatMode) {
                    case 'agent':
                        aiResponse = await this.aiEngine.processAgentMessage(text, {
                            options,
                            codebaseIndex: this.codebaseIndexer.getIndex()
                        });
                        break;
                    case 'ask':
                        aiResponse = await this.aiEngine.processAskMessage(text, {
                            options,
                            codebaseIndex: this.codebaseIndexer.getIndex()
                        });
                        break;
                    default:
                        aiResponse = await this.aiEngine.processMessage(text, {
                            options,
                            codebaseIndex: this.codebaseIndexer.getIndex()
                        });
                }
            } catch (aiError) {
                console.error('AI Engine error:', aiError);
                aiResponse = "Sorry, I encountered an error processing your request. Please try again.";
            }

            // Hide loading indicator first
            this.webviewView.webview.postMessage({ command: 'hideLoading' });

            // Then send assistant message
            const assistantMessage: Message = {
                role: 'assistant',
                content: aiResponse,
                timestamp: Date.now()
            };

            this.messages.push(assistantMessage);
            
            console.log('Sending assistant response to webview', assistantMessage); // Debug log
            this.webviewView.webview.postMessage({ 
                command: 'addMessage', 
                message: assistantMessage 
            });

        } catch (error) {
            console.error('Error processing message:', error);
            this.webviewView.webview.postMessage({ 
                command: 'hideLoading' 
            });
            this.webviewView.webview.postMessage({ 
                command: 'showError',
                error: 'Failed to process message. Please try again.'
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

    public dispose() {
        AIAssistantPanel.currentPanel = undefined;

        this.disposables.forEach(d => d.dispose());
    }
} 