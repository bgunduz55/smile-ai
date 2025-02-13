import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AIEngine } from '../ai-engine/AIEngine';
import { AIMessage } from '../ai-engine/types';
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

    private constructor(
        webviewView: vscode.WebviewView,
        private readonly aiEngine: AIEngine,
        private readonly context: vscode.ExtensionContext
    ) {
        this.webviewView = webviewView;
        this.modelManager = ModelManager.getInstance();
        this.setupWebview();
    }

    public static show(
        webviewView: vscode.WebviewView,
        context: vscode.ExtensionContext,
        aiEngine: AIEngine
    ) {
        AIAssistantPanel.currentPanel = new AIAssistantPanel(webviewView, aiEngine, context);
    }

    private setupWebview() {
        this.webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
        };

        // Webview içeriğini ayarla
        this.webviewView.webview.html = this.getWebviewContent();

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

    private getWebviewContent(): string {
        const styleUri = this.webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'assistant.css')
        );

        // HTML template'i oku
        const htmlPath = path.join(this.context.extensionPath, 'media', 'assistant.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Template değişkenlerini değiştir
        html = html.replace('{{styleUri}}', styleUri.toString());
        html = html.replace('{{cspSource}}', this.webviewView.webview.cspSource);

        return html;
    }

    private async handleUserMessage(text: string) {
        const message: Message = {
            role: 'user',
            content: text,
            timestamp: Date.now()
        };

        this.messages.push(message);
        this.updateMessages();

        try {
            const activeModel = this.modelManager.getActiveModel();
            if (!activeModel) {
                throw new Error('Aktif model seçili değil');
            }

            const response = await this.aiEngine.generateResponse({
                prompt: text,
                maxTokens: activeModel.maxTokens || 2048,
                temperature: activeModel.temperature || 0.7
            });

            const aiMessage: Message = {
                role: 'assistant',
                content: response.message,
                timestamp: Date.now()
            };

            this.messages.push(aiMessage);
            this.updateMessages();

            if (this.currentView === 'composer' && response.codeChanges) {
                this.updateComposerPreview(response.codeChanges[0]);
            }
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
            await this.modelManager.setActiveModel(modelName);
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

    private updateComposerPreview(codeChange: any) {
        this.webviewView.webview.postMessage({
            type: 'updateComposerPreview',
            code: codeChange.newContent,
            diff: {
                original: codeChange.originalContent,
                modified: codeChange.newContent
            }
        });
    }
} 