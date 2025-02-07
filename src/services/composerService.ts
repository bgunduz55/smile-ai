import * as vscode from 'vscode';
import { aiService } from './aiService';

interface ComposerContext {
    fileContent: string;
    selection: string;
    language: string;
    filePath: string;
}

export class ComposerService {
    private static instance: ComposerService;
    private webviewPanel: vscode.WebviewPanel | undefined;
    private currentContext: ComposerContext | undefined;

    private constructor() {}

    public static getInstance(): ComposerService {
        if (!ComposerService.instance) {
            ComposerService.instance = new ComposerService();
        }
        return ComposerService.instance;
    }

    public async startComposer() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Composer başlatmak için bir dosya açık olmalıdır.');
            return;
        }

        const document = editor.document;
        const selection = editor.selection;
        const selectedText = document.getText(selection);

        this.currentContext = {
            fileContent: document.getText(),
            selection: selectedText,
            language: document.languageId,
            filePath: document.uri.fsPath
        };

        if (this.webviewPanel) {
            this.webviewPanel.reveal();
            await this.updateWebview();
            return;
        }

        this.webviewPanel = vscode.window.createWebviewPanel(
            'smileComposer',
            'Smile AI Composer',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.webviewPanel.webview.html = this.getWebviewContent();

        this.webviewPanel.webview.onDidReceiveMessage(
            async (message: { command: string; text?: string; action?: string }) => {
                switch (message.command) {
                    case 'generateCode':
                        if (message.text) {
                            await this.handleCodeGeneration(message.text);
                        }
                        break;
                    case 'applyChanges':
                        if (message.text) {
                            await this.applyChanges(message.text);
                        }
                        break;
                }
            },
            undefined,
            []
        );

        this.webviewPanel.onDidDispose(
            () => {
                this.webviewPanel = undefined;
            },
            null,
            []
        );
    }

    private async handleCodeGeneration(prompt: string) {
        if (!this.webviewPanel || !this.currentContext) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın ve metin seçin.');
            return;
        }

        try {
            const fullPrompt = `${prompt}\n\nContext:\n${JSON.stringify(this.currentContext)}`;
            const response = await aiService.generateCode(fullPrompt);
            await this.webviewPanel.webview.postMessage({ type: 'updateResponse', value: response });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            vscode.window.showErrorMessage(`Kod üretme hatası: ${errorMessage}`);
        }
    }

    private async applyChanges(newCode: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.currentContext) {
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

    private async updateWebview() {
        if (!this.webviewPanel || !this.currentContext) {
            return;
        }

        this.webviewPanel.webview.html = this.getWebviewContent();
    }

    private getWebviewContent() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Smile AI Composer</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        margin: 0;
                        padding: 20px;
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                    }
                    .container {
                        display: flex;
                        flex-direction: column;
                        gap: 20px;
                        flex: 1;
                    }
                    .input-section, .output-section {
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
                        resize: none;
                        font-family: monospace;
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
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="input-section">
                        <h3>İstek</h3>
                        <textarea id="promptInput" placeholder="Ne yapmak istediğinizi açıklayın..."></textarea>
                        <div class="button-container">
                            <button onclick="generateCode()">Kod Üret</button>
                        </div>
                    </div>
                    <div class="output-section">
                        <h3>Yanıt</h3>
                        <textarea id="responseOutput" readonly></textarea>
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
                        switch (message.command) {
                            case 'updateResponse':
                                responseOutput.value = message.response;
                                break;
                        }
                    });

                    function generateCode() {
                        const text = promptInput.value;
                        if (text) {
                            vscode.postMessage({
                                command: 'generateCode',
                                text: text
                            });
                        }
                    }

                    function applyChanges() {
                        const text = responseOutput.value;
                        if (text) {
                            vscode.postMessage({
                                command: 'applyChanges',
                                text: text
                            });
                        }
                    }

                    promptInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && e.ctrlKey) {
                            generateCode();
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}

export const composerService = ComposerService.getInstance(); 