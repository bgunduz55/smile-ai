import * as vscode from 'vscode';
import { SuggestionItem } from '../services/suggestionService';

export class SuggestionViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.suggestionView';
    private _view?: vscode.WebviewView;

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

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'complete':
                    // Mark suggestion as completed
                    break;
                case 'delete':
                    // Delete suggestion

                    break;
                case 'openChat':
                    // Open chat
                    break;
                case 'openComposer':
                    // Open composer
                    break;

            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Smile AI Suggestions</title>
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
                    .suggestion-title {
                        font-size: 1.2em;
                        margin-bottom: 10px;
                        color: var(--vscode-textLink-foreground);
                    }
                    .suggestion-description {
                        margin-bottom: 10px;
                    }
                    .suggestion-meta {
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 10px;
                    }
                    .suggestion-tags {
                        display: flex;
                        gap: 5px;
                        flex-wrap: wrap;
                        margin-bottom: 10px;
                    }
                    .tag {
                        padding: 2px 8px;
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        border-radius: 10px;
                        font-size: 0.8em;
                    }
                    .priority {
                        display: inline-block;
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        margin-right: 5px;
                    }
                    .priority-high { background-color: #f14c4c; }
                    .priority-medium { background-color: #ffa629; }
                    .priority-low { background-color: #3794ff; }
                    .button-container {
                        display: flex;
                        gap: 10px;
                    }
                    button {
                        padding: 6px 12px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .empty-state {
                        text-align: center;
                        padding: 40px 20px;
                        color: var(--vscode-descriptionForeground);
                    }
                    pre {
                        background-color: var(--vscode-textBlockQuote-background);
                        padding: 10px;
                        border-radius: 4px;
                        overflow-x: auto;
                    }
                    code {
                        font-family: var(--vscode-editor-font-family);
                    }
                </style>
            </head>
            <body>
                <div id="suggestions"></div>
                <script>
                    const vscode = acquireVsCodeApi();

                    function updateSuggestions(suggestions) {
                        const container = document.getElementById('suggestions');
                        
                        if (!suggestions || suggestions.length === 0) {
                            container.innerHTML = \`
                                <div class="empty-state">
                                    <h3>No suggestions yet</h3>
                                    <p>Suggestions will appear here</p>
                                </div>
                            \`;

                            return;
                        }

                        container.innerHTML = suggestions.map(suggestion => \`
                            <div class="suggestion">
                                <div class="suggestion-title">
                                    <span class="priority priority-\${suggestion.priority}"></span>
                                    \${suggestion.title}
                                </div>
                                <div class="suggestion-description">\${suggestion.description}</div>
                                <div class="suggestion-meta">
                                    Created: \${new Date(suggestion.createdAt).toLocaleString()}
                                </div>
                                <div class="suggestion-tags">

                                    \${suggestion.tags?.map(tag => \`
                                        <span class="tag">\${tag}</span>
                                    \`).join('') || ''}
                                </div>
                                \${suggestion.context?.codeSnippet ? \`
                                    <pre><code>\${suggestion.context.codeSnippet}</code></pre>
                                \` : ''}
                                <div class="button-container">
                                    <button onclick="openChat('\${suggestion.id}')">
                                        Develop with Chat
                                    </button>
                                    <button onclick="openComposer('\${suggestion.id}')">
                                        Develop with Composer

                                    </button>
                                    <button onclick="completeSuggestion('\${suggestion.id}')">
                                        Completed
                                    </button>
                                    <button onclick="deleteSuggestion('\${suggestion.id}')">
                                        Delete
                                    </button>
                                </div>

                            </div>
                        \`).join('');
                    }

                    function openChat(id) {
                        vscode.postMessage({ type: 'openChat', id });
                    }

                    function openComposer(id) {
                        vscode.postMessage({ type: 'openComposer', id });
                    }

                    function completeSuggestion(id) {
                        vscode.postMessage({ type: 'complete', id });
                    }

                    function deleteSuggestion(id) {
                        vscode.postMessage({ type: 'delete', id });
                    }

                    // Show empty state on first load
                    updateSuggestions([]);
                </script>

            </body>
            </html>
        `;
    }

    public async handleMessage(message: any) {
        switch (message.type) {
            case 'refreshSuggestions':
                // Handle refresh
                break;
            case 'applyAllSuggestions':
                // Handle apply all
                break;
            case 'filterSuggestions':
                // Handle filter
                break;
        }
    }

    public async getContent(): Promise<string> {
        return `
            <div class="suggestions-container">
                <div class="suggestions-header">
                    <h3>Smart Code Suggestions</h3>
                    <div class="filter-options">
                        <select id="suggestionType">
                            <option value="all">All Suggestions</option>
                            <option value="improvement">Improvements</option>
                            <option value="security">Security</option>
                            <option value="performance">Performance</option>
                            <option value="quality">Code Quality</option>
                        </select>
                    </div>
                </div>
                <div class="suggestions-list" id="suggestionsList">
                    ${this.getSuggestionItems()}
                </div>
                <div class="suggestions-footer">
                    <button id="refreshSuggestions">
                        <i class="codicon codicon-refresh"></i>
                        Refresh
                    </button>
                    <button id="applyAllSuggestions">
                        <i class="codicon codicon-check-all"></i>
                        Apply All
                    </button>
                </div>
            </div>
        `;
    }

    private getSuggestionItems(): string {
        // TODO: Replace with actual suggestions
        const suggestions: SuggestionItem[] = [];
        
        if (suggestions.length === 0) {
            return `
                <div class="no-suggestions">
                    <i class="codicon codicon-lightbulb"></i>
                    <p>Suggestions for the active file will appear here.</p>
                </div>
            `;
        }

        return suggestions.map(suggestion => `
            <div class="suggestion-item">
                <div class="suggestion-title">
                    <span class="priority priority-${suggestion.priority}"></span>
                    ${suggestion.title}
                </div>
                <div class="suggestion-description">${suggestion.description}</div>
                <div class="suggestion-meta">
                    Created: ${new Date(suggestion.createdAt).toLocaleString()}
                </div>
                <div class="suggestion-tags">
                    ${suggestion.tags?.map(tag => `
                        <span class="tag">${tag}</span>
                    `).join('') || ''}
                </div>
                ${suggestion.context?.codeSnippet ? `
                    <pre><code>${suggestion.context.codeSnippet}</code></pre>
                ` : ''}
                <div class="button-container">
                    <button onclick="openChat('${suggestion.id}')">
                        Develop with Chat
                    </button>
                    <button onclick="openComposer('${suggestion.id}')">
                        Develop with Composer
                    </button>
                    <button onclick="completeSuggestion('${suggestion.id}')">
                        Completed
                    </button>
                    <button onclick="deleteSuggestion('${suggestion.id}')">
                        Delete
                    </button>
                </div>
            </div>
        `).join('');
    }

    public setWebview(webview: vscode.WebviewView) {
        this._view = webview;
    }
} 