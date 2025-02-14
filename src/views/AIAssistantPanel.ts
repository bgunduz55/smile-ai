import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { ModelManager } from '../utils/ModelManager';
import { CodebaseIndexer } from '../utils/CodebaseIndexer';
import { FileAnalyzer } from '../utils/FileAnalyzer';

interface Message {
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
    private static currentPanel: AIAssistantPanel | undefined;
    private readonly webviewView: vscode.WebviewView;
    private messages: Message[] = [];
    private currentView: string = 'chat';
    private modelManager: ModelManager;
    private aiEngine: AIEngine | undefined;
    private codebaseIndexer: CodebaseIndexer;
    private fileAnalyzer: FileAnalyzer;
    private isIndexing: boolean = false;

    private constructor(
        webviewView: vscode.WebviewView,
        private readonly context: vscode.ExtensionContext,
        aiEngine: AIEngine
    ) {
        this.webviewView = webviewView;
        this.modelManager = ModelManager.getInstance();
        this.codebaseIndexer = CodebaseIndexer.getInstance();
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
        aiEngine: AIEngine
    ) {
        AIAssistantPanel.currentPanel = new AIAssistantPanel(webviewView, context, aiEngine);
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
            async message => {
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
                }
            },
            undefined,
            this.context.subscriptions
        );

        // İlk yükleme
        this.updateModels();
        this.updateSettings();
    }

    private async getWebviewContent(): Promise<string> {
        const styleUri = this.webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'assistant.css')
        );

        // HTML template'i oku
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'assistant.html');
        let html = '';
        
        try {
            const uint8Array = await vscode.workspace.fs.readFile(htmlPath);
            html = Buffer.from(uint8Array).toString('utf-8');
        } catch (error) {
            console.error('HTML template okuma hatası:', error);
            html = '<html><body>Template yüklenemedi</body></html>';
        }

        // Template değişkenlerini değiştir
        html = html.replace('{{styleUri}}', styleUri.toString());
        html = html.replace('{{cspSource}}', this.webviewView.webview.cspSource);

        return html;
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
        const projectContext = this.codebaseIndexer.getProjectStructure();

        return {
            file: document.fileName,
            selection: selectedText,
            fileContext,
            projectContext
        };
    }

    private async handleUserMessage(text: string) {
        try {
            // Aktif model kontrolü
            const activeModel = this.modelManager.getActiveModel();
            if (!activeModel) {
                throw new Error('Lütfen önce bir AI model seçin');
            }

            // AI Engine kontrolü
            if (!this.aiEngine) {
                this.aiEngine = new AIEngine({
                    provider: {
                        name: activeModel.provider,
                        modelName: activeModel.modelName,
                        apiEndpoint: activeModel.apiEndpoint
                    },
                    maxTokens: activeModel.maxTokens || 2048,
                    temperature: activeModel.temperature || 0.7
                });
            }

            // Bağlam bilgisini al
            const context = await this.getCurrentContext();

            // Kullanıcı mesajını ekle
            const message: Message = {
                role: 'user',
                content: text,
                timestamp: Date.now(),
                context
            };

            this.messages.push(message);
            this.updateMessages();

            // Sistem promptunu hazırla
            let systemPrompt = `You are a coding assistant with access to the following context:
File: ${context.file || 'No active file'}
Selection: ${context.selection ? 'Selected text exists' : 'No selection'}
Project Structure: Available
Language: ${context.fileContext?.language || 'Unknown'}
Framework: ${context.fileContext?.framework || 'Unknown'}

Please provide assistance based on this context. If you need to reference code, use the context provided.`;

            // AI yanıtını al
            const response = await this.aiEngine.generateResponse({
                prompt: text,
                systemPrompt,
                maxTokens: activeModel.maxTokens || 2048,
                temperature: activeModel.temperature || 0.7
            });

            // AI yanıtını ekle
            const aiMessage: Message = {
                role: 'assistant',
                content: response.message,
                timestamp: Date.now(),
                context
            };

            this.messages.push(aiMessage);
            this.updateMessages();
        } catch (error: any) {
            vscode.window.showErrorMessage(`AI yanıtı alınamadı: ${error.message}`);
        }
    }

    private handleViewChange(view: string) {
        this.currentView = view;
        this.updateViewState();
    }

    private async handleModelToggle(modelName: string) {
        try {
            const currentModel = this.modelManager.getActiveModel();
            if (currentModel?.name === modelName) {
                await this.modelManager.setActiveModel(undefined);
            } else {
                await this.modelManager.setActiveModel(modelName);
                
                // AI Engine'i yeni modelle güncelle
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
            }
            this.updateModels();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Model değiştirilemedi: ${error.message}`);
        }
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
                prompt: 'Test message',
                maxTokens: 10
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

    private updateMessages() {
        this.webviewView.webview.postMessage({
            type: 'updateMessages',
            messages: this.messages
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

    private updateViewState() {
        this.webviewView.webview.postMessage({
            type: 'viewChanged',
            view: this.currentView
        });
    }
} 