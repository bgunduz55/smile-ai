import * as vscode from 'vscode';
import { aiService } from '../services/aiService';
import { SettingsService } from '../services/settingsService';

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
    private history: any[] = [];
    private settingsService: SettingsService;

    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {
        this.settingsService = SettingsService.getInstance();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
            enableCommandUris: true
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
            vscode.window.showErrorMessage('Please open a file and select text.');
            return;
        }


        try {
            const response = await aiService.generateCode(prompt, JSON.stringify(this.currentContext));
            this.currentResponse = response;
            await this._view.webview.postMessage({ type: 'updateResponse', value: response });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Code generation error: ${errorMessage}`);
        }
    }


    private async applyChanges(newCode: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.currentContext) {
            vscode.window.showErrorMessage('Please open a file and select text.');
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
            vscode.window.showInformationMessage('Changes applied successfully.');

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Error applying changes: ${errorMessage}`);
        }
    }


    private _getHtmlForWebview(_webview: vscode.Webview) {
        const settings = this.settingsService.getSettings();
        const currentProvider = settings.modelProvider || 'ollama';
        const providerSettings = settings.providers[currentProvider] || {};
        const models = providerSettings.models || [];
        const currentModel = models[0] || '';

        const modelSelectorHtml = `
            <div class="model-selector" data-provider="${currentProvider}">
                <label>Model:</label>
                <select onchange="window.updateModel('${currentProvider}', this.value)">
                    ${models.map(model => `
                        <option value="${model}" ${model === currentModel ? 'selected' : ''}>
                            ${model}
                        </option>
                    `).join('\n')}
                </select>
            </div>
        `;

        const contextInfo = this.currentContext
            ? `Active File: ${this.currentContext.filePath}\nLanguage: ${this.currentContext.language}\n${
                this.currentContext.selection ? 'Selected text exists' : 'No selected text'
            }`
            : 'Please open a file';

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${_webview.cspSource} https:; script-src ${_webview.cspSource} 'unsafe-inline'; style-src ${_webview.cspSource} 'unsafe-inline'; font-src ${_webview.cspSource};">
                <title>Smile AI Composer</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        margin: 0;
                        padding: 20px;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 20px;
                        padding: 10px;
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        border-radius: 4px;
                    }
                    .model-selector {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    .model-selector select {
                        padding: 4px 8px;
                        background-color: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        border-radius: 4px;
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
                        height: calc(100vh - 200px);
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
                <div class="header">
                    ${modelSelectorHtml}
                </div>
                <div class="context-info">${this._escapeHtml(contextInfo)}</div>
                <div class="container">
                    <div class="section">
                        <h3>Request</h3>
                        <textarea id="promptInput" placeholder="Explain what you want to do..."></textarea>
                        <div class="button-container">
                            <button onclick="window.generateCode()">Generate Code</button>
                        </div>
                    </div>
                    <div class="section">
                        <h3>Response</h3>
                        <textarea id="responseOutput" readonly>${this._escapeHtml(this.currentResponse || '')}</textarea>
                        <div class="button-container">
                            <button onclick="window.applyChanges()">Apply Changes</button>
                        </div>
                    </div>
                </div>
                <script>
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
                            window.generateCode();
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }

    public async handleMessage(message: any) {
        switch (message.type) {
            case 'generateCode':
                await this.handleCodeGeneration(message.value);
                break;
            case 'applyChanges':
                await this.applyChanges(message.value);
                break;
        }
    }

    public async getContent(): Promise<string> {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const currentProvider = config.get<string>('modelProvider', 'ollama');
        const currentModel = config.get(`${currentProvider}.model`, '');

        return `
            <div class="page-container">
                <div class="page-header">
                    <div class="model-selector">
                        <label>Aktif Model:</label>
                        <div class="active-model">
                            <span class="provider-badge">${currentProvider}</span>
                            <span class="model-name">${currentModel || 'Model seçilmedi'}</span>
                        </div>
                    </div>
                </div>
                
                <div class="page-content">
                    <div class="composer-content" id="composerContent">
                        ${this.renderHistory()}
                    </div>
                </div>
                
                <div class="page-footer">
                    <div class="composer-input">
                        <textarea 
                            class="composer-textarea" 
                            placeholder="İyileştirmek istediğiniz metni girin..."
                            rows="3"
                        ></textarea>
                        <div class="composer-actions">
                            <button class="action-button" id="improveText">
                                <i class="codicon codicon-wand"></i>
                                İyileştir
                            </button>
                            <button class="action-button" id="translateText">
                                <i class="codicon codicon-globe"></i>
                                Çevir
                            </button>
                            <button class="action-button" id="formatText">
                                <i class="codicon codicon-symbol-keyword"></i>
                                Biçimlendir
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    private renderHistory(): string {
        if (this.history.length === 0) {
            return `
                <div class="composer-welcome">
                    <h3>Metin İyileştirici</h3>
                    <p>Metninizi girin ve iyileştirme seçeneklerinden birini seçin.</p>
                    <ul>
                        <li>Dilbilgisi ve yazım hatalarını düzeltme</li>
                        <li>Cümle yapısını iyileştirme</li>
                        <li>Farklı dillere çevirme</li>
                        <li>Metin biçimlendirme</li>
                    </ul>
                </div>
            `;
        }

        return this.history.map(item => this.renderHistoryItem(item)).join('\\n');
    }

    private renderHistoryItem(item: any): string {
        return `
            <div class="composer-item">
                <div class="item-original">
                    <div class="item-header">
                        <span class="item-label">Orijinal Metin</span>
                        <button class="action-button small" onclick="copyToClipboard('${item.id}-original')">
                            <i class="codicon codicon-copy"></i>
                        </button>
                    </div>
                    <div class="item-content" id="${item.id}-original">
                        ${this.formatText(item.original)}
                    </div>
                </div>
                <div class="item-improved">
                    <div class="item-header">
                        <span class="item-label">İyileştirilmiş Metin</span>
                        <button class="action-button small" onclick="copyToClipboard('${item.id}-improved')">
                            <i class="codicon codicon-copy"></i>
                        </button>
                    </div>
                    <div class="item-content" id="${item.id}-improved">
                        ${this.formatText(item.improved)}
                    </div>
                </div>
                <div class="item-meta">
                    <span class="item-time">${this.formatTime(item.timestamp)}</span>
                    <span class="item-type">${this.getOperationLabel(item.type)}</span>
                </div>
            </div>
        `;
    }

    private formatText(text: string): string {
        // TODO: Implement text formatting (markdown, code blocks, etc.)
        return text;
    }

    private formatTime(timestamp: number): string {
        return new Date(timestamp).toLocaleTimeString();
    }

    private getOperationLabel(type: string): string {
        switch (type) {
            case 'improve': return 'İyileştirme';
            case 'translate': return 'Çeviri';
            case 'format': return 'Biçimlendirme';
            default: return type;
        }
    }

    public async handleOperation(operation: any) {
        if (!this._view) return;

        try {
            // Add operation to history
            const item = {
                id: Date.now().toString(),
                type: operation.type,
                original: operation.text,
                improved: `Improved: ${operation.text}`, // TODO: Implement actual improvement
                timestamp: Date.now()
            };

            this.history.unshift(item);

            // Update UI
            await this.updateHistory();

        } catch (error) {
            console.error('Error handling operation:', error);
            vscode.window.showErrorMessage('İşlem gerçekleştirilirken hata oluştu.');
        }
    }

    private async updateHistory() {
        if (!this._view) return;

        await this._view.webview.postMessage({
            type: 'updateComposerHistory',
            content: this.renderHistory()
        });
    }

    private _escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    public setWebview(webview: vscode.WebviewView) {
        this._view = webview;
    }
} 