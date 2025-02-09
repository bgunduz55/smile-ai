import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface SuggestionItem {
    id: string;
    type: 'improvement' | 'todo' | 'feature';
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high';
    status: 'pending' | 'approved' | 'rejected' | 'completed';
    createdAt: string;
    updatedAt: string;
    relatedFiles?: string[];
    tags?: string[];
    context?: {
        language?: string;
        framework?: string;
        codeSnippet?: string;
    };
}

export class SuggestionService {
    private static instance: SuggestionService;
    private suggestions: Map<string, SuggestionItem[]> = new Map();
    private statusBarItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.statusBarItem.text = "$(lightbulb) Öneriler";
        this.statusBarItem.command = 'smile-ai.showSuggestions';
        this.statusBarItem.show();

        this.registerCommands();
        this.loadSuggestions();
    }

    public static getInstance(): SuggestionService {
        if (!SuggestionService.instance) {
            SuggestionService.instance = new SuggestionService();
        }
        return SuggestionService.instance;
    }

    private registerCommands(): void {
        this.disposables.push(
            vscode.commands.registerCommand('smile-ai.showSuggestions', () => this.showSuggestionsPanel()),
            vscode.commands.registerCommand('smile-ai.addSuggestion', () => this.addSuggestion()),
            vscode.commands.registerCommand('smile-ai.completeSuggestion', (id: string) => this.completeSuggestion(id)),
            vscode.commands.registerCommand('smile-ai.removeSuggestion', (id: string) => this.removeSuggestion(id))
        );
    }

    private async loadSuggestions(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        for (const folder of workspaceFolders) {
            const suggestionsPath = path.join(folder.uri.fsPath, '.smile-ai', 'suggestions.json');
            
            if (fs.existsSync(suggestionsPath)) {
                try {
                    const content = await fs.promises.readFile(suggestionsPath, 'utf-8');
                    const items = JSON.parse(content) as SuggestionItem[];
                    this.suggestions.set(folder.uri.fsPath, items);
                } catch (error) {
                    console.error('Error loading suggestions:', error);
                }
            }
        }


        this.updateStatusBar();
    }

    private async saveSuggestions(workspaceRoot: string): Promise<void> {
        const suggestionsDir = path.join(workspaceRoot, '.smile-ai');
        const suggestionsPath = path.join(suggestionsDir, 'suggestions.json');

        try {
            if (!fs.existsSync(suggestionsDir)) {
                await fs.promises.mkdir(suggestionsDir, { recursive: true });
            }

            const items = this.suggestions.get(workspaceRoot) || [];
            await fs.promises.writeFile(suggestionsPath, JSON.stringify(items, null, 2));
        } catch (error) {
            console.error('Error saving suggestions:', error);
        }
    }


    public async addSuggestion(suggestion: Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const items = this.suggestions.get(workspaceRoot) || [];

        const newSuggestion: SuggestionItem = {
            ...suggestion,
            id: `suggestion-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        items.push(newSuggestion);
        this.suggestions.set(workspaceRoot, items);
        await this.saveSuggestions(workspaceRoot);
        this.updateStatusBar();

        // Show notification to user
        vscode.window.showInformationMessage(`New suggestion added: ${suggestion.title}`);

    }

    public async completeSuggestion(id: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const items = this.suggestions.get(workspaceRoot) || [];
        
        const suggestion = items.find(item => item.id === id);
        if (suggestion) {
            suggestion.status = 'completed';
            suggestion.updatedAt = new Date().toISOString();
            await this.saveSuggestions(workspaceRoot);
            this.updateStatusBar();
        }
    }

    public async removeSuggestion(id: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const items = this.suggestions.get(workspaceRoot) || [];
        
        const index = items.findIndex(item => item.id === id);
        if (index !== -1) {
            items.splice(index, 1);
            await this.saveSuggestions(workspaceRoot);
            this.updateStatusBar();
        }
    }

    private updateStatusBar(): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const items = this.suggestions.get(workspaceFolder.uri.fsPath) || [];
        const pendingCount = items.filter(item => item.status === 'pending').length;
        
        this.statusBarItem.text = `$(lightbulb) Suggestions (${pendingCount})`;
        this.statusBarItem.tooltip = `${pendingCount} pending suggestion`;
    }


    private async showSuggestionsPanel(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const panel = vscode.window.createWebviewPanel(
            'smileSuggestions',
            'Smile AI - Öneriler',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const items = this.suggestions.get(workspaceFolder.uri.fsPath) || [];
        panel.webview.html = this.getSuggestionsHtml(items);

        // Listen for webview messages

        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'complete':
                    await this.completeSuggestion(message.id);
                    panel.webview.html = this.getSuggestionsHtml(
                        this.suggestions.get(workspaceFolder.uri.fsPath) || []
                    );
                    break;
                case 'remove':
                    await this.removeSuggestion(message.id);
                    panel.webview.html = this.getSuggestionsHtml(
                        this.suggestions.get(workspaceFolder.uri.fsPath) || []
                    );
                    break;
            }
        });
    }

    private getSuggestionsHtml(items: SuggestionItem[]): string {
        const getPriorityColor = (priority: string) => {
            switch (priority) {
                case 'high': return 'red';
                case 'medium': return 'orange';
                case 'low': return 'green';
                default: return 'gray';
            }
        };

        const getStatusIcon = (status: string) => {
            switch (status) {
                case 'completed': return '✅';
                case 'pending': return '⏳';
                case 'approved': return '👍';
                case 'rejected': return '❌';
                default: return '❓';
            }
        };

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Smile AI - Suggestions</title>
                <style>

                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .suggestion {
                        margin-bottom: 20px;
                        padding: 15px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                    }
                    .suggestion-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 10px;
                    }
                    .suggestion-title {
                        font-size: 16px;
                        font-weight: bold;
                    }
                    .suggestion-meta {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                    }
                    .suggestion-description {
                        margin: 10px 0;
                    }
                    .suggestion-tags {
                        display: flex;
                        gap: 5px;
                        margin-top: 10px;
                    }
                    .tag {
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 12px;
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                    }
                    .priority {
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 12px;
                    }
                    .actions {
                        display: flex;
                        gap: 10px;
                        margin-top: 10px;
                    }
                    button {
                        padding: 4px 8px;
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .code-snippet {
                        background-color: var(--vscode-textBlockQuote-background);
                        padding: 10px;
                        margin: 10px 0;
                        border-left: 3px solid var(--vscode-textBlockQuote-border);
                        font-family: var(--vscode-editor-font-family);
                        font-size: 13px;
                        overflow-x: auto;
                    }
                </style>
            </head>
            <body>
                <h1>Development Suggestions</h1>

                ${items.map(item => `
                    <div class="suggestion">
                        <div class="suggestion-header">
                            <div class="suggestion-title">
                                ${getStatusIcon(item.status)} ${item.title}
                            </div>
                            <span class="priority" style="background-color: ${getPriorityColor(item.priority)}">
                                ${item.priority.toUpperCase()}
                            </span>
                        </div>
                        <div class="suggestion-meta">
                            Created: ${new Date(item.createdAt).toLocaleString()}
                            | Updated: ${new Date(item.updatedAt).toLocaleString()}
                        </div>

                        <div class="suggestion-description">
                            ${item.description}
                        </div>
                        ${item.context?.codeSnippet ? `
                            <div class="code-snippet">
                                <pre><code>${item.context.codeSnippet}</code></pre>
                            </div>
                        ` : ''}
                        ${item.tags?.length ? `
                            <div class="suggestion-tags">
                                ${item.tags.map(tag => `
                                    <span class="tag">${tag}</span>
                                `).join('')}
                            </div>
                        ` : ''}
                        <div class="actions">
                            ${item.status !== 'completed' ? `
                                <button onclick="completeSuggestion('${item.id}')">
                                    Completed
                                </button>
                            ` : ''}

                            <button onclick="removeSuggestion('${item.id}')">
                                Remove
                            </button>
                        </div>

                    </div>
                `).join('')}
                <script>
                    const vscode = acquireVsCodeApi();

                    function completeSuggestion(id) {
                        vscode.postMessage({
                            command: 'complete',
                            id: id
                        });
                    }

                    function removeSuggestion(id) {
                        vscode.postMessage({
                            command: 'remove',
                            id: id
                        });
                    }
                </script>
            </body>
            </html>
        `;
    }

    public dispose(): void {
        this.statusBarItem.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

export const suggestionService = SuggestionService.getInstance(); 