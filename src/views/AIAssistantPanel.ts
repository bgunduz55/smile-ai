import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { ModelManager } from '../utils/ModelManager';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class AIAssistantPanel {
    private static currentPanel: AIAssistantPanel | undefined;
    private readonly webviewView: vscode.WebviewView;
    private messages: Message[] = [];
    private currentView: string = 'chat';
    private modelManager: ModelManager;
    private aiEngine: AIEngine | undefined;

    private constructor(
        webviewView: vscode.WebviewView,
        private readonly context: vscode.ExtensionContext,
        aiEngine: AIEngine
    ) {
        this.webviewView = webviewView;
        this.modelManager = ModelManager.getInstance();
        
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
                    case 'toggleModel':
                        await this.handleModelToggle(message.modelName);
                        break;
                    case 'updateSetting':
                        await this.handleSettingUpdate(message.key, message.value);
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

            // Kullanıcı mesajını ekle
            const message: Message = {
                role: 'user',
                content: text,
                timestamp: Date.now()
            };

            this.messages.push(message);
            this.updateMessages();

            // AI yanıtını al
            const response = await this.aiEngine.generateResponse({
                prompt: text,
                maxTokens: activeModel.maxTokens || 2048,
                temperature: activeModel.temperature || 0.7
            });

            // AI yanıtını ekle
            const aiMessage: Message = {
                role: 'assistant',
                content: response.message,
                timestamp: Date.now()
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