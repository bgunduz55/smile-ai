import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { marked } from 'marked';

export class AIAssistantPanel {
    private static currentPanel: AIAssistantPanel | undefined;
    private readonly webviewView: vscode.WebviewView;
    private messages: any[] = [];
    private currentMode: 'chat' | 'composer' = 'chat';

    private constructor(
        webviewView: vscode.WebviewView,
        private readonly aiEngine: AIEngine,
        private readonly context: vscode.ExtensionContext
    ) {
        this.webviewView = webviewView;
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
                    case 'switchMode':
                        this.switchMode(message.mode);
                        break;
                    case 'applyCode':
                        await this.applyCode(message.code);
                        break;
                    case 'previewDiff':
                        await this.showDiffPreview(message.originalCode, message.newCode);
                        break;
                }
            },
            undefined
        );
    }

    private getWebviewContent() {
        const styleUri = this.webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'assistant.css')
        );

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
    <div class="container">
        <div class="mode-selector">
            <button id="chatMode" class="mode-button active" onclick="switchMode('chat')">Chat</button>
            <button id="composerMode" class="mode-button" onclick="switchMode('composer')">Composer</button>
        </div>

        <div class="content">
            <div id="chatContent" class="content-panel active">
                <div id="messageContainer" class="message-container"></div>
            </div>

            <div id="composerContent" class="content-panel">
                <div class="composer-options">
                    <label>
                        <input type="checkbox" id="includeImports" checked>
                        Import'ları dahil et
                    </label>
                    <label>
                        <input type="checkbox" id="includeTypes" checked>
                        Tip tanımlarını dahil et
                    </label>
                    <label>
                        <input type="checkbox" id="includeTests" checked>
                        Test kodunu dahil et
                    </label>
                </div>
                <div id="composerPreview" class="composer-preview"></div>
            </div>
        </div>

        <div class="input-container">
            <textarea id="userInput" placeholder="Mesajınızı yazın... (Shift + Enter ile gönder)"></textarea>
            <button id="sendButton" onclick="sendMessage()">Gönder</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messageContainer = document.getElementById('messageContainer');
        const userInput = document.getElementById('userInput');
        const chatMode = document.getElementById('chatMode');
        const composerMode = document.getElementById('composerMode');
        const chatContent = document.getElementById('chatContent');
        const composerContent = document.getElementById('composerContent');

        // Enter tuşu kontrolü
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        function sendMessage() {
            const text = userInput.value.trim();
            if (!text) return;

            vscode.postMessage({
                command: 'sendMessage',
                text: text,
                mode: getCurrentMode()
            });

            userInput.value = '';
        }

        function switchMode(mode) {
            vscode.postMessage({
                command: 'switchMode',
                mode: mode
            });

            if (mode === 'chat') {
                chatMode.classList.add('active');
                composerMode.classList.remove('active');
                chatContent.classList.add('active');
                composerContent.classList.remove('active');
            } else {
                chatMode.classList.remove('active');
                composerMode.classList.add('active');
                chatContent.classList.remove('active');
                composerContent.classList.add('active');
            }
        }

        function getCurrentMode() {
            return chatMode.classList.contains('active') ? 'chat' : 'composer';
        }

        function applyCode(code) {
            vscode.postMessage({
                command: 'applyCode',
                code: code
            });
        }

        function previewDiff(originalCode, newCode) {
            vscode.postMessage({
                command: 'previewDiff',
                originalCode: originalCode,
                newCode: newCode
            });
        }

        // Otomatik scroll
        function scrollToBottom() {
            messageContainer.scrollTop = messageContainer.scrollHeight;
        }

        // Textarea otomatik yükseklik
        userInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    </script>
</body>
</html>`;
    }

    private async handleUserMessage(text: string) {
        // Kullanıcı mesajını ekle
        this.addMessage({
            role: 'user',
            content: text,
            timestamp: Date.now()
        });

        try {
            // AI yanıtını al
            const response = await this.aiEngine.generateResponse({
                prompt: text,
                maxTokens: 2048,
                temperature: 0.7
            });

            // AI yanıtını ekle
            this.addMessage({
                role: 'assistant',
                content: response.message,
                timestamp: Date.now()
            });

            // Kod değişikliği varsa composer preview'ı güncelle
            if (this.currentMode === 'composer' && response.codeChanges) {
                this.updateComposerPreview(response.codeChanges[0]);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`AI yanıtı alınamadı: ${error.message}`);
        }
    }

    private addMessage(message: any) {
        this.messages.push(message);
        this.updateMessages();
    }

    private updateMessages() {
        this.webviewView.webview.postMessage({
            type: 'updateMessages',
            messages: this.messages.map(msg => ({
                ...msg,
                content: marked(msg.content)
            }))
        });
    }

    private switchMode(mode: 'chat' | 'composer') {
        this.currentMode = mode;
        this.webviewView.webview.postMessage({
            type: 'modeChanged',
            mode: mode
        });
    }

    private async applyCode(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Aktif bir editör bulunamadı');
            return;
        }

        try {
            await editor.edit(editBuilder => {
                const document = editor.document;
                const lastLine = document.lineAt(document.lineCount - 1);
                const range = new vscode.Range(
                    new vscode.Position(0, 0),
                    lastLine.range.end
                );

                editBuilder.replace(range, code);
            });

            vscode.window.showInformationMessage('Kod başarıyla uygulandı!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Kod uygulanırken hata: ${error.message}`);
        }
    }

    private async showDiffPreview(originalCode: string, newCode: string) {
        const originalUri = vscode.Uri.parse('untitled:Original.ts');
        const modifiedUri = vscode.Uri.parse('untitled:Modified.ts');

        await vscode.commands.executeCommand('vscode.diff',
            originalUri,
            modifiedUri,
            'Kod Değişiklikleri',
            { preview: true }
        );
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