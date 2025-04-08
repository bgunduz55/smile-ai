import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { ModelManager } from '../utils/ModelManager';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';
import { FileAnalyzer } from '../utils/FileAnalyzer';
import { Message } from '../types/chat';

export class AIAssistantPanel {
    private readonly webviewView: vscode.WebviewView;
    private readonly context: vscode.ExtensionContext;
    private readonly disposables: vscode.Disposable[] = [];
    private aiEngine: AIEngine;
    private messages: Message[] = [];
    private modelManager: ModelManager;
    private codebaseIndexer: CodebaseIndexer;
    private fileAnalyzer: FileAnalyzer;
    private isIndexing: boolean = false;

    private constructor(
        webviewView: vscode.WebviewView,
        context: vscode.ExtensionContext,
        aiEngine: AIEngine,
        codebaseIndexer: CodebaseIndexer
    ) {
        this.webviewView = webviewView;
        this.context = context;
        this.aiEngine = aiEngine;
        this.modelManager = ModelManager.getInstance();
        this.codebaseIndexer = codebaseIndexer;
        this.fileAnalyzer = FileAnalyzer.getInstance();
        
        // Aktif modeli kontrol et ve AI Engine'i başlat
        const activeModel = this.modelManager.getActiveModel();
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

    public static show(
        webviewView: vscode.WebviewView,
        context: vscode.ExtensionContext,
        aiEngine: AIEngine,
        codebaseIndexer: CodebaseIndexer
    ) {
        new AIAssistantPanel(webviewView, context, aiEngine, codebaseIndexer);
    }

    private setupWebview() {
        this.webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
        };

        // Get resource URIs
        const mediaPath = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        const cssUri = this.webviewView.webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'main.css'));
        const mainUri = this.webviewView.webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'main.js'));

        // Set webview HTML
        const htmlContent = this.getWebviewContent(cssUri.toString(), mainUri.toString());
        this.webviewView.webview.html = htmlContent;

        // Handle messages from webview
        this.webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        await this.handleUserMessage(message.text, message.options);
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

        // İlk yükleme
        this.updateModels();
    }

    private getWebviewContent(cssUri: string, mainUri: string): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Smile AI Assistant</title>
            <link rel="stylesheet" href="${cssUri}">
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons/dist/codicon.css">
        </head>
        <body>
            <div class="container">
                <div class="toolbar">
                    <div class="chat-mode">
                        <select id="chatMode">
                            <option value="chat">Chat</option>
                            <option value="agent">Agent</option>
                            <option value="ask">Ask</option>
                        </select>
                    </div>
                    <div style="flex: 1"></div>
                    <button class="toolbar-button" id="addModel">
                        <i class="codicon codicon-add"></i>
                        Add AI Model
                    </button>
                </div>

                <div class="chat-container">
                    <div class="messages" id="messages">
                        <!-- Messages will be inserted here -->
                    </div>

                    <div class="input-container">
                        <div class="checkbox-container">
                            <label>
                                <input type="checkbox" id="includeImports" checked>
                                Import'ları dahil et
                            </label>
                            <label>
                                <input type="checkbox" id="includeTips" checked>
                                Tip tanımlarını dahil et
                            </label>
                            <label>
                                <input type="checkbox" id="includeTests" checked>
                                Test kodunu dahil et
                            </label>
                        </div>
                        
                        <div class="attachment-toolbar">
                            <button class="attachment-button" id="attachFile">
                                <i class="codicon codicon-file-add"></i>
                                Dosya Ekle
                            </button>
                            <button class="attachment-button" id="attachFolder">
                                <i class="codicon codicon-folder-add"></i>
                                Klasör Ekle
                            </button>
                        </div>
                        
                        <div class="current-attachments">
                            <!-- Attached files/folders will be shown here -->
                        </div>

                        <textarea
                            class="input-box"
                            id="messageInput"
                            placeholder="Kod üretmek için talimatlarınızı yazın... (Enter ile gönder, Shift+Enter ile yeni satır)"
                            rows="1"
                        ></textarea>
                        <button class="send-button" id="sendButton">
                            <i class="codicon codicon-send"></i>
                            Send
                        </button>
                    </div>
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

            <template id="file-attachment-template">
                <div class="file-attachment">
                    <i class="codicon codicon-file-code icon"></i>
                    <span class="filename"></span>
                </div>
            </template>

            <script src="${mainUri}"></script>
        </body>
        </html>`;
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
            // Add user message
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

            // Process with AI based on chat mode
            this.webviewView.webview.postMessage({ command: 'showLoading' });

            let aiResponse;
            switch (options.chatMode) {
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

            const assistantMessage: Message = {
                role: 'assistant',
                content: aiResponse,
                timestamp: Date.now()
            };

            this.messages.push(assistantMessage);
            this.webviewView.webview.postMessage({ 
                command: 'addMessage', 
                message: assistantMessage 
            });

        } catch (error) {
            console.error('Error processing message:', error);
            this.webviewView.webview.postMessage({ 
                command: 'showError',
                error: 'Failed to process message. Please try again.'
            });
        } finally {
            this.webviewView.webview.postMessage({ command: 'hideLoading' });
        }
    }

    private async handleAddModel() {
        await vscode.commands.executeCommand('smile-ai.addModel');
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

    private updateModels() {
        const models = this.modelManager.getModels();
        const activeModel = this.modelManager.getActiveModel();

        this.webviewView.webview.postMessage({
            type: 'updateModels',
            models: models.map(model => ({
                ...model,
                active: activeModel?.name === model.name
            }))
        });
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }
} 