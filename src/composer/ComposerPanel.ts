import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { AIMessage } from '../ai-engine/types';
import { marked } from 'marked';

export class ComposerPanel {
    public static currentPanel: ComposerPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private messages: AIMessage[] = [];
    private currentFile: vscode.TextDocument | undefined;

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly aiEngine: AIEngine,
        private readonly context: vscode.ExtensionContext
    ) {
        this.panel = panel;

        // Aktif editörü al
        this.currentFile = vscode.window.activeTextEditor?.document;

        // Panel içeriğini ayarla
        this.updateContent();

        // Panel kapatıldığında temizlik yap
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Editör değişikliklerini dinle
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                this.currentFile = editor.document;
                this.updateContent();
            }
        }, null, this.disposables);

        // Panel mesajlarını dinle
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'generateCode':
                        await this.handleCodeGeneration(message.prompt, message.context);
                        break;
                    case 'applyCode':
                        await this.applyGeneratedCode(message.code);
                        break;
                    case 'modifyCode':
                        await this.handleCodeModification(message.code, message.instructions);
                        break;
                    case 'previewDiff':
                        await this.showDiffPreview(message.originalCode, message.newCode);
                        break;
                    case 'clearComposer':
                        this.clearComposer();
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    public static show(context: vscode.ExtensionContext, aiEngine: AIEngine) {
        // Eğer panel zaten açıksa, onu göster
        if (ComposerPanel.currentPanel) {
            ComposerPanel.currentPanel.panel.reveal(vscode.ViewColumn.Two);
            return;
        }

        // Yeni panel oluştur
        const panel = vscode.window.createWebviewPanel(
            'smileAIComposer',
            'Smile AI Composer',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media')
                ]
            }
        );

        ComposerPanel.currentPanel = new ComposerPanel(panel, aiEngine, context);
    }

    private updateContent() {
        this.panel.webview.html = this.getWebviewContent();
    }

    private async handleCodeGeneration(prompt: string, context: any) {
        try {
            // Kullanıcı isteğini ekle
            this.messages.push({
                role: 'user',
                content: prompt,
                timestamp: Date.now()
            });

            // UI'ı güncelle
            this.updateContent();

            // AI yanıtını al
            const response = await this.aiEngine.generateResponse({
                prompt,
                systemPrompt: this.getCodeGenerationPrompt(context),
                maxTokens: 2048,
                temperature: 0.7
            });

            // AI yanıtını ekle
            this.messages.push({
                role: 'assistant',
                content: response.message,
                timestamp: Date.now()
            });

            // UI'ı güncelle
            this.updateContent();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Kod üretilirken hata: ${error.message}`);
        }
    }

    private async applyGeneratedCode(code: string) {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error('Aktif bir editör bulunamadı');
            }

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

    private async handleCodeModification(code: string, instructions: string) {
        try {
            // AI'dan değişiklik önerisi al
            const response = await this.aiEngine.generateResponse({
                prompt: instructions,
                systemPrompt: this.getCodeModificationPrompt(code),
                maxTokens: 2048,
                temperature: 0.7
            });

            // Değişiklikleri önizleme olarak göster
            await this.showDiffPreview(code, response.message);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Kod düzenlenirken hata: ${error.message}`);
        }
    }

    private async showDiffPreview(originalCode: string, newCode: string) {
        // Geçici dosyalar oluştur
        const originalUri = vscode.Uri.parse('untitled:Original.ts');
        const modifiedUri = vscode.Uri.parse('untitled:Modified.ts');

        // Diff görünümünü göster
        await vscode.commands.executeCommand('vscode.diff',
            originalUri,
            modifiedUri,
            'Kod Değişiklikleri',
            { preview: true }
        );
    }

    private clearComposer() {
        this.messages = [];
        this.updateContent();
    }

    private getCodeGenerationPrompt(context: any): string {
        return `You are a code generation expert. Your task is to:
1. Generate clean and maintainable code
2. Follow best practices and patterns
3. Include necessary imports and dependencies
4. Add proper error handling
5. Include comments and documentation
6. Consider performance and security

Context:
${JSON.stringify(context, null, 2)}

Please generate the code following these requirements.`;
    }

    private getCodeModificationPrompt(code: string): string {
        return `You are a code modification expert. Your task is to:
1. Analyze the existing code
2. Apply the requested changes
3. Maintain code quality and style
4. Preserve functionality
5. Add or update comments
6. Consider backward compatibility

Original Code:
\`\`\`typescript
${code}
\`\`\`

Please modify the code following the instructions while maintaining its integrity.`;
    }

    private getWebviewContent(): string {
        const styleUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'composer.css')
        );

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${styleUri}">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet">
</head>
<body>
    <div class="composer-container">
        <div class="composer-header">
            <h2>Kod Composer</h2>
            ${this.currentFile ? 
                `<div class="current-file">Aktif Dosya: ${this.currentFile.fileName}</div>` : 
                '<div class="no-file">Aktif dosya yok</div>'
            }
        </div>

        <div class="composer-content">
            <div class="input-section">
                <div class="prompt-input">
                    <textarea 
                        id="promptInput" 
                        placeholder="Ne tür bir kod üretmek veya düzenlemek istiyorsunuz? (Shift + Enter ile gönder)"
                        rows="4"
                    ></textarea>
                </div>
                
                <div class="context-section">
                    <h3>Bağlam</h3>
                    <div class="context-options">
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
                </div>

                <div class="button-container">
                    <button onclick="clearComposer()">Temizle</button>
                    <button onclick="generateCode()">Kod Üret</button>
                </div>
            </div>

            <div class="output-section">
                <div class="code-preview">
                    ${this.messages.map(msg => this.renderMessage(msg)).join('')}
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const promptInput = document.getElementById('promptInput');

        // Enter tuşu kontrolü
        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                generateCode();
            }
        });

        function getContext() {
            return {
                includeImports: document.getElementById('includeImports').checked,
                includeTypes: document.getElementById('includeTypes').checked,
                includeTests: document.getElementById('includeTests').checked
            };
        }

        function generateCode() {
            const prompt = promptInput.value.trim();
            if (prompt) {
                vscode.postMessage({
                    command: 'generateCode',
                    prompt: prompt,
                    context: getContext()
                });
                promptInput.value = '';
            }
        }

        function applyCode(code) {
            vscode.postMessage({
                command: 'applyCode',
                code: code
            });
        }

        function modifyCode(code, instructions) {
            vscode.postMessage({
                command: 'modifyCode',
                code: code,
                instructions: instructions
            });
        }

        function previewDiff(originalCode, newCode) {
            vscode.postMessage({
                command: 'previewDiff',
                originalCode: originalCode,
                newCode: newCode
            });
        }

        function clearComposer() {
            vscode.postMessage({
                command: 'clearComposer'
            });
        }

        // Kod renklendirme
        document.querySelectorAll('pre code').forEach((block) => {
            Prism.highlightElement(block);
        });
    </script>
</body>
</html>`;
    }

    private renderMessage(message: AIMessage): string {
        const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : '';
        const isUser = message.role === 'user';
        const className = isUser ? 'user-message' : 'assistant-message';

        // Markdown'ı HTML'e çevir
        const content = marked(message.content);

        return `
<div class="message ${className}">
    <div class="message-header">
        <span class="message-role">${isUser ? 'İstek' : 'Yanıt'}</span>
        <span class="message-time">${timestamp}</span>
    </div>
    <div class="message-content">
        ${content}
    </div>
    ${!isUser ? `
    <div class="message-actions">
        <button onclick="applyCode(\`${this.escapeCode(message.content)}\`)">Uygula</button>
        <button onclick="previewDiff(editor.getValue(), \`${this.escapeCode(message.content)}\`)">Önizle</button>
    </div>
    ` : ''}
</div>`;
    }

    private escapeCode(code: string): string {
        return code
            .replace(/\\/g, '\\\\')
            .replace(/`/g, '\\`')
            .replace(/\$/g, '\\$');
    }

    private dispose() {
        ComposerPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
} 