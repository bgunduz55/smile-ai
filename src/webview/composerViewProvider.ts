import * as vscode from 'vscode';
import { aiService } from '../services/aiService';

interface ComposerContext {
    fileContent: string;
    selection: string;
    language: string;
    filePath: string;
}

export class ComposerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.composerView';
    private _view?: vscode.WebviewView;
    private currentContext?: ComposerContext;
    private currentResponse?: string;

    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this.updateContext();
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'generateCode':
                    await this.handleCodeGeneration(data.value);
                    break;
                case 'applyChanges':
                    await this.applyChanges(data.value);
                    break;
            }
        });

        // Aktif editör değiştiğinde context'i güncelle
        vscode.window.onDidChangeActiveTextEditor(() => {
            this.updateContext();
            if (this._view) {
                this._view.webview.html = this._getHtmlForWebview(this._view.webview);
            }
        });
    }

    private updateContext() {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const selection = editor.selection;
            this.currentContext = {
                fileContent: document.getText(),
                selection: document.getText(selection),
                language: document.languageId,
                filePath: document.uri.fsPath
            };
        } else {
            this.currentContext = undefined;
        }
    }

    private async handleCodeGeneration(prompt: string) {
        if (!this._view || !this.currentContext) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın ve metin seçin.');
            return;
        }

        try {
            const response = await aiService.generateCode(prompt, JSON.stringify(this.currentContext));
            this.currentResponse = response;
            await this._view.webview.postMessage({ type: 'updateResponse', value: response });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            vscode.window.showErrorMessage(`Kod üretme hatası: ${errorMessage}`);
        }
    }

    private async applyChanges(newCode: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.currentContext) {
            vscode.window.showErrorMessage('Değişiklikleri uygulamak için bir dosya açık olmalıdır.');
            return;
        }

        try {
            const edit = new vscode.WorkspaceEdit();
            const selection = editor.selection;
            
            edit.replace(
                editor.document.uri,
                selection.isEmpty ? new vscode.Range(0, 0, editor.document.lineCount, 0) : selection,
                newCode
            );

            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage('Değişiklikler başarıyla uygulandı.');
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            vscode.window.showErrorMessage(`Değişiklikleri uygularken hata: ${errorMessage}`);
        }
    }

    private _getHtmlForWebview(_webview: vscode.Webview) {
        const contextInfo = this.currentContext
            ? `Aktif Dosya: ${this.currentContext.filePath}\nDil: ${this.currentContext.language}\n${
                this.currentContext.selection ? 'Seçili metin var' : 'Seçili metin yok'
            }`
            : 'Lütfen bir dosya açın';

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Smile AI Composer</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        margin: 0;
                        padding: 20px;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .context-info {
                        font-family: var(--vscode-editor-font-family);
                        font-size: 12px;
                        padding: 8px;
                        margin-bottom: 16px;
                        background-color: var(--vscode-textBlockQuote-background);
                        border-left: 4px solid var(--vscode-textBlockQuote-border);
                        white-space: pre-wrap;
                    }
                    .container {
                        display: flex;
                        flex-direction: column;
                        gap: 20px;
                        height: calc(100vh - 150px);
                    }
                    .section {
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                    }
                    textarea {
                        flex: 1;
                        padding: 8px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        font-family: var(--vscode-editor-font-family);
                        resize: none;
                    }
                    .button-container {
                        display: flex;
                        gap: 10px;
                        margin-top: 10px;
                    }
                    button {
                        padding: 8px 16px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    h3 {
                        margin: 0 0 10px 0;
                        color: var(--vscode-sideBarTitle-foreground);
                    }
                </style>
            </head>
            <body>
                <div class="context-info">${this._escapeHtml(contextInfo)}</div>
                <div class="container">
                    <div class="section">
                        <h3>İstek</h3>
                        <textarea id="promptInput" placeholder="Ne yapmak istediğinizi açıklayın..."></textarea>
                        <div class="button-container">
                            <button onclick="generateCode()">Kod Üret</button>
                        </div>
                    </div>
                    <div class="section">
                        <h3>Yanıt</h3>
                        <textarea id="responseOutput" readonly>${this._escapeHtml(this.currentResponse || '')}</textarea>
                        <div class="button-container">
                            <button onclick="applyChanges()">Değişiklikleri Uygula</button>
                        </div>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const promptInput = document.getElementById('promptInput');
                    const responseOutput = document.getElementById('responseOutput');

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'updateResponse':
                                responseOutput.value = message.value;
                                break;
                        }
                    });

                    promptInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && e.ctrlKey) {
                            generateCode();
                        }
                    });

                    function generateCode() {
                        const text = promptInput.value;
                        if (text) {
                            vscode.postMessage({
                                type: 'generateCode',
                                value: text
                            });
                        }
                    }

                    function applyChanges() {
                        const text = responseOutput.value;
                        if (text) {
                            vscode.postMessage({
                                type: 'applyChanges',
                                value: text
                            });
                        }
                    }
                </script>
            </body>
            </html>
        `;
    }

    private _escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
} 