import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { ModelManager } from '../utils/ModelManager';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';
import { FileAnalyzer } from '../utils/FileAnalyzer';
import { ChatHistoryManager, ChatSession } from '../utils/ChatHistoryManager';
import { AIMessage, AIRequest } from '../ai-engine/types';

interface Message extends AIMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    context?: {
        file?: string;
        selection?: string;
        codebase?: any;
    };
}

export class AIAssistantPanel {
    private readonly webviewView: vscode.WebviewView;
    private readonly context: vscode.ExtensionContext;
    private readonly disposables: vscode.Disposable[] = [];
    private aiEngine: AIEngine;
    private chatMessages: Message[] = [];
    private composerMessages: Message[] = [];
    private currentView: string = 'chat';
    private modelManager: ModelManager;
    private codebaseIndexer: CodebaseIndexer;
    private fileAnalyzer: FileAnalyzer;
    private isIndexing: boolean = false;
    private chatHistoryManager: ChatHistoryManager;
    private currentChatSession: ChatSession | undefined;
    private currentComposerSession: ChatSession | undefined;

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
        this.chatHistoryManager = ChatHistoryManager.getInstance(context);
        
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
        this.loadLastSession();
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

        // Webview içeriğini ayarla
        this.getWebviewContent().then(content => {
            this.webviewView.webview.html = content;
        });

        // Mesaj dinleyicisini ayarla
        this.webviewView.webview.onDidReceiveMessage(
            async (message: any) => {
                switch (message.command) {
                    case 'sendMessage':
                        await this.handleUserMessage(message.text);
                        break;
                    case 'viewChanged':
                        this.handleViewChange(message.view);
                        break;
                    case 'saveModelSettings':
                        await this.handleModelSettings(message.settings);
                        break;
                    case 'testModelConnection':
                        await this.testModelConnection(message.settings);
                        break;
                    case 'updateSetting':
                        await this.handleSettingUpdate(message.key, message.value);
                        break;
                    case 'reindex':
                        await this.indexCodebase();
                        break;
                    case 'createNewSession':
                        await this.createNewSession(message.view);
                        break;
                    case 'switchSession':
                        await this.switchSession(message.sessionId);
                        break;
                }
            },
            undefined,
            this.disposables
        );

        // İlk yükleme
        this.updateModels();
        this.updateSettings();
        this.updateSessionList();
    }

    private async getWebviewContent(): Promise<string> {
        const styleUri = this.webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'assistant.css')
        );

        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'assistant.html');
        let html = '';
        
        try {
            const uint8Array = await vscode.workspace.fs.readFile(htmlPath);
            html = Buffer.from(uint8Array).toString('utf-8');

            // Template değişkenlerini değiştir
            html = html.replace(/\{\{styleUri\}\}/g, styleUri.toString());
            html = html.replace(/\{\{cspSource\}\}/g, this.webviewView.webview.cspSource);

            return html;
        } catch (error) {
            console.error('HTML template okuma hatası:', error);
            return `<!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: sans-serif; padding: 20px; }
                        .error { color: red; }
                    </style>
                </head>
                <body>
                    <h1 class="error">Hata</h1>
                    <p>Template yüklenemedi. Lütfen extension'ı yeniden yükleyin.</p>
                </body>
                </html>`;
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

    private async getCurrentContext(): Promise<any> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return {};

        const document = editor.document;
        const selection = editor.selection;
        const selectedText = document.getText(selection);

        const fileContext = await this.fileAnalyzer.analyzeFile(document.uri);

        return {
            file: document.fileName,
            selection: selectedText,
            fileContext
        };
    }

    private async handleUserMessage(text: string): Promise<void> {
        // Parse @ mentions for file/folder attachments
        const attachments = this.parseAttachments(text);
        
        // Process attachments
        for (const attachment of attachments) {
            if (attachment.type === 'file') {
                this.codebaseIndexer.attachFile(attachment.path);
            } else {
                this.codebaseIndexer.attachFolder(attachment.path);
            }
        }

        // Remove attachment syntax from message
        const cleanMessage = text.replace(/@(file|folder):"[^"]*"/g, '').trim();

        // Add user message to chat
        this.chatMessages.push({
            role: 'user',
            content: cleanMessage,
            attachments: attachments
        });

        // Update UI
        this.updateChatView();

        // Process with AI
        await this.processWithAI(cleanMessage, attachments);
    }

    private parseAttachments(text: string): Array<{type: 'file' | 'folder', path: string}> {
        const attachments: Array<{type: 'file' | 'folder', path: string}> = [];
        const regex = /@(file|folder):"([^"]*)"/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const type = match[1] as 'file' | 'folder';
            const path = match[2];
            
            // Convert to absolute path if relative
            const absolutePath = path.startsWith('/') ? path : 
                vscode.workspace.workspaceFolders?.[0] ? 
                    path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, path) : 
                    path;

            attachments.push({
                type,
                path: absolutePath
            });
        }

        return attachments;
    }

    private async processWithAI(message: string, attachments: Array<{type: 'file' | 'folder', path: string}>): Promise<void> {
        try {
            // Show loading state
            this.webviewView.webview.postMessage({ command: 'showLoading' });

            // Get context from attached files
            const context = await this.getContextFromAttachments(attachments);

            // Get AI response
            const response = await this.aiEngine.processMessage(message, {
                context,
                attachments,
                codebaseIndex: this.codebaseIndexer.getIndex()
            });

            // Add AI response to chat
            this.chatMessages.push({
                role: 'assistant',
                content: response
            });

            // Update UI
            this.updateChatView();
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

    private async getContextFromAttachments(attachments: Array<{type: 'file' | 'folder', path: string}>): Promise<any> {
        const context: any = {
            files: {},
            folders: {}
        };

        for (const attachment of attachments) {
            if (attachment.type === 'file') {
                try {
                    const uri = vscode.Uri.file(attachment.path);
                    const fileContent = await vscode.workspace.fs.readFile(uri);
                    context.files[attachment.path] = {
                        content: fileContent.toString(),
                        analysis: await this.analyzeFile(uri)
                    };
                } catch (error) {
                    console.warn(`Failed to read file ${attachment.path}:`, error);
                }
            } else {
                try {
                    const uri = vscode.Uri.file(attachment.path);
                    const entries = await vscode.workspace.fs.readDirectory(uri);
                    context.folders[attachment.path] = {
                        entries: entries.map(([name, type]) => ({
                            name,
                            type: type === vscode.FileType.Directory ? 'directory' : 'file'
                        }))
                    };
                } catch (error) {
                    console.warn(`Failed to read folder ${attachment.path}:`, error);
                }
            }
        }

        return context;
    }

    private async analyzeFile(uri: vscode.Uri): Promise<any> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            return {
                symbols: await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri),
                diagnostics: vscode.languages.getDiagnostics(uri)
            };
        } catch (error) {
            console.warn(`Failed to analyze file ${uri.fsPath}:`, error);
            return null;
        }
    }

    private scrollToBottom(containerId: string) {
        this.webviewView.webview.postMessage({
            type: 'scrollToBottom',
            containerId
        });
    }

    private handleViewChange(view: string) {
        this.currentView = view;
        if (view === 'chat') {
            this.updateMessages('chat', this.chatMessages);
            this.updateSessionList();
        } else if (view === 'composer') {
            this.updateMessages('composer', this.composerMessages);
            this.updateSessionList();
        }
        
        // Update webview with current view
        this.webviewView.webview.postMessage({
            type: 'viewChanged',
            view: this.currentView
        });
    }

    private async handleSettingUpdate(key: string, value: any) {
        const config = vscode.workspace.getConfiguration('smile-ai');
        await config.update(key, value, vscode.ConfigurationTarget.Global);
        this.updateSettings();
    }

    private async handleModelSettings(settings: any) {
        try {
            // Model ayarlarını kaydet
            const config = vscode.workspace.getConfiguration('smile-ai');
            await config.update('models', [
                {
                    name: settings.modelName,
                    provider: settings.provider,
                    modelName: settings.modelName,
                    apiEndpoint: settings.apiEndpoint,
                    maxTokens: settings.maxTokens,
                    temperature: settings.temperature
                }
            ], vscode.ConfigurationTarget.Global);

            // Aktif model olarak ayarla
            await config.update('activeModel', settings.modelName, vscode.ConfigurationTarget.Global);

            // AI Engine'i güncelle
            this.aiEngine = new AIEngine({
                provider: {
                    name: settings.provider,
                    modelName: settings.modelName,
                    apiEndpoint: settings.apiEndpoint
                },
                maxTokens: settings.maxTokens,
                temperature: settings.temperature
            });

            vscode.window.showInformationMessage('Model ayarları kaydedildi');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Model ayarları kaydedilemedi: ${error.message}`);
        }
    }

    private async testModelConnection(settings: any) {
        try {
            const testEngine = new AIEngine({
                provider: {
                    name: settings.provider,
                    modelName: settings.modelName,
                    apiEndpoint: settings.apiEndpoint
                },
                maxTokens: 100,
                temperature: 0.7
            });

            const response = await testEngine.generateResponse({
                messages: [{
                    role: 'user',
                    content: 'Test message',
                    timestamp: Date.now()
                }],
                maxTokens: 10,
                temperature: 0.7,
                context: {
                    prompt: 'Test message'
                }
            });

            if (response) {
                vscode.window.showInformationMessage('Model bağlantısı başarılı!');
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Model bağlantı hatası: ${error.message}`);
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

    private updateMessages(view: string, messages: Message[]) {
        this.webviewView.webview.postMessage({
            type: 'updateMessages',
            messages: messages,
            view: view
        });
    }

    private updateSettings() {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const settings = {
            appearance: config.get('appearance'),
            behavior: config.get('behavior'),
            shortcuts: config.get('shortcuts')
        };

        this.webviewView.webview.postMessage({
            type: 'updateSettings',
            settings
        });
    }

    private async updateSessionList() {
        const sessions = await this.chatHistoryManager.getSessions();
        const chatSessions = Array.from(sessions.values()).filter(s => s.id.startsWith('chat_'));
        const composerSessions = Array.from(sessions.values()).filter(s => s.id.startsWith('composer_'));

        this.webviewView.webview.postMessage({
            type: 'updateSessions',
            sessions: {
                chatSessions: chatSessions.sort((a, b) => b.lastUpdated - a.lastUpdated),
                composerSessions: composerSessions.sort((a, b) => b.lastUpdated - a.lastUpdated)
            }
        });
    }

    private async loadLastSession() {
        const sessions = await this.chatHistoryManager.getSessions();
        if (sessions.size > 0) {
            const sessionsArray = Array.from(sessions.values());
            const lastChatSession = sessionsArray
                .filter(s => s.id.startsWith('chat_'))
                .sort((a, b) => b.lastUpdated - a.lastUpdated)[0];
            const lastComposerSession = sessionsArray
                .filter(s => s.id.startsWith('composer_'))
                .sort((a, b) => b.lastUpdated - a.lastUpdated)[0];

            if (lastChatSession) {
                this.currentChatSession = lastChatSession;
                this.chatMessages = lastChatSession.messages as Message[];
            }
            if (lastComposerSession) {
                this.currentComposerSession = lastComposerSession;
                this.composerMessages = lastComposerSession.messages as Message[];
            }

            this.updateMessages('chat', this.chatMessages);
            this.updateSessionList();
        }
    }

    private async createNewSession(view: string) {
        const session: ChatSession = {
            id: `${view}_${Date.now()}`,
            title: view === 'chat' ? 'Yeni sohbet' : 'Yeni kod oturumu',
            messages: [],
            created: Date.now(),
            lastUpdated: Date.now()
        };

        await this.chatHistoryManager.addSession(session);
        
        if (view === 'chat') {
            this.currentChatSession = session;
            this.chatMessages = [];
            this.updateMessages('chat', this.chatMessages);
        } else if (view === 'composer') {
            this.currentComposerSession = session;
            this.composerMessages = [];
            this.updateMessages('composer', this.composerMessages);
        }
        
        this.updateSessionList();
    }

    private async switchSession(sessionId: string) {
        const session = await this.chatHistoryManager.getSession(sessionId);
        if (!session) return;

        if (sessionId.startsWith('chat_')) {
            this.currentChatSession = session;
            this.chatMessages = session.messages as Message[];
            this.updateMessages('chat', this.chatMessages);
        } else if (sessionId.startsWith('composer_')) {
            this.currentComposerSession = session;
            this.composerMessages = session.messages as Message[];
            this.updateMessages('composer', this.composerMessages);
        }
    }
} 