import * as vscode from 'vscode';

export class RulesViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.rulesView';
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
                case 'createRule':
                    await vscode.commands.executeCommand('smile-ai.createRule');
                    break;
                case 'editRule':
                    await vscode.commands.executeCommand('smile-ai.editRule', data.ruleName);
                    break;
                case 'toggleRule':
                    const config = vscode.workspace.getConfiguration('smile-ai.rules');
                    const enabledRules = config.get<string[]>('enabledRules', []);
                    
                    if (enabledRules.includes(data.ruleName)) {
                        await config.update('enabledRules', 
                            enabledRules.filter(r => r !== data.ruleName), 
                            vscode.ConfigurationTarget.Workspace
                        );
                    } else {
                        await config.update('enabledRules', 
                            [...enabledRules, data.ruleName], 
                            vscode.ConfigurationTarget.Workspace
                        );
                    }
                    break;
                case 'deleteRule':
                    // Rule deletion process
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
                <title>Smile AI Rules</title>
                <style>

                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .rule {
                        margin-bottom: 20px;
                        padding: 15px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                    }
                    .rule-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 10px;
                    }
                    .rule-title {
                        font-size: 1.2em;
                        color: var(--vscode-textLink-foreground);
                    }
                    .rule-description {
                        margin-bottom: 10px;
                        color: var(--vscode-descriptionForeground);
                    }
                    .rule-meta {
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    .button-container {
                        display: flex;
                        gap: 10px;
                        margin-top: 10px;
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
                    .checkbox {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    input[type="checkbox"] {
                        width: 16px;
                        height: 16px;
                    }
                    .add-rule {
                        width: 100%;
                        margin-bottom: 20px;
                    }
                </style>
            </head>
            <body>
                <button class="add-rule" onclick="createRule()">
                    Create New Rule Set
                </button>
                <div id="rules"></div>
                <script>

                    const vscode = acquireVsCodeApi();

                    function updateRules(rules) {
                        const container = document.getElementById('rules');
                        
                        if (!rules || rules.length === 0) {
                            container.innerHTML = \`
                                <div class="empty-state">
                                    <h3>No rule set yet</h3>
                                    <p>Rule sets will appear here</p>
                                </div>
                            \`;

                            return;
                        }

                        container.innerHTML = rules.map(rule => \`
                            <div class="rule">
                                <div class="rule-header">
                                    <div class="checkbox">
                                        <input type="checkbox" 
                                            id="rule-\${rule.name}" 
                                            \${rule.enabled ? 'checked' : ''}
                                            onchange="toggleRule('\${rule.name}')"
                                        >
                                        <label for="rule-\${rule.name}" class="rule-title">
                                            \${rule.name}
                                        </label>
                                    </div>
                                </div>
                                <div class="rule-description">\${rule.description}</div>
                                <div class="rule-meta">
                                    Last modified: \${new Date(rule.lastModified).toLocaleString()}
                                </div>
                                <div class="button-container">

                                    <button onclick="editRule('\${rule.name}')">
                                        Edit
                                    </button>
                                    <button onclick="deleteRule('\${rule.name}')">
                                        Delete
                                    </button>
                                </div>
                            </div>

                        \`).join('');
                    }

                    function createRule() {
                        vscode.postMessage({ type: 'createRule' });
                    }

                    function editRule(ruleName) {
                        vscode.postMessage({ type: 'editRule', ruleName });
                    }

                    function toggleRule(ruleName) {
                        vscode.postMessage({ type: 'toggleRule', ruleName });
                    }

                    function deleteRule(ruleName) {
                        vscode.postMessage({ type: 'deleteRule', ruleName });
                    }

                    // Show empty state on first load
                    updateRules([]);
                </script>

            </body>
            </html>
        `;
    }
} 