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
            await this.handleMessage(data);
        });
    }

    public async handleMessage(message: any) {
        switch (message.type) {
            case 'createRule':
                await vscode.commands.executeCommand('smile-ai.createRule');
                break;
            case 'editRule':
                await vscode.commands.executeCommand('smile-ai.editRule', message.ruleName);
                break;
            case 'toggleRule':
                await vscode.commands.executeCommand('smile-ai.toggleRule', message.ruleName);
                break;
            case 'deleteRule':
                await vscode.commands.executeCommand('smile-ai.deleteRule', message.ruleName);
                break;
        }
    }

    public async getContent(): Promise<string> {
        return `
            <div class="rules-container">
                <div class="rules-header">
                    <h3>Code Rules</h3>
                    <button id="addRuleSet">
                        <i class="codicon codicon-add"></i>
                        New Rule Set
                    </button>
                </div>
                <div class="rules-list" id="rulesList">
                    ${await this.getRuleSets()}
                </div>
            </div>
        `;
    }

    private async getRuleSets(): Promise<string> {
        const config = vscode.workspace.getConfiguration('smile-ai.rules');
        const enabledRules = config.get<string[]>('enabledRules', []);
        const customRules = config.get<any[]>('customRules', []);

        if (enabledRules.length === 0 && customRules.length === 0) {
            return `
                <div class="no-rules">
                    <i class="codicon codicon-book"></i>
                    <p>No rule sets defined yet. Click "New Rule Set" to create one.</p>
                </div>
            `;
        }

        const ruleSets = [...enabledRules.map(rule => ({
            name: rule,
            isBuiltIn: true
        })), ...customRules];

        return ruleSets.map(ruleSet => `
            <div class="rule-set" data-id="${ruleSet.name}">
                <div class="rule-set-header">
                    <h4>${ruleSet.name}</h4>
                    <div class="rule-set-actions">
                        <button class="edit-rule-set" onclick="editRuleSet('${ruleSet.name}')">
                            <i class="codicon codicon-edit"></i>
                        </button>
                        <button class="delete-rule-set" onclick="deleteRuleSet('${ruleSet.name}')">
                            <i class="codicon codicon-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="rule-items">
                    ${this.getRuleItems(ruleSet)}
                </div>
            </div>
        `).join('');
    }

    private getRuleItems(ruleSet: any): string {
        // TODO: Replace with actual rule items from configuration
        const defaultItems = [
            { id: 'rule1', name: 'Strict Type Checking', enabled: true },
            { id: 'rule2', name: 'No Any Type', enabled: true }
        ];

        return defaultItems.map(item => `
            <div class="rule-item">
                <input type="checkbox" id="${item.id}" 
                    ${item.enabled ? 'checked' : ''} 
                    onchange="toggleRule('${ruleSet.name}', '${item.id}')"
                >
                <label for="${item.id}">${item.name}</label>
            </div>
        `).join('');
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `
            <div class="rules-container">
                <div class="rules-header">
                    <h3>Code Rules</h3>
                    <button id="addRuleSet">
                        <i class="codicon codicon-add"></i>
                        New Rule Set
                    </button>
                </div>
                <div class="rules-list" id="rulesList">
                    <div class="rule-set">
                        <div class="rule-set-header">
                            <h4>TypeScript Rules</h4>
                            <div class="rule-set-actions">
                                <button class="edit-rule-set">
                                    <i class="codicon codicon-edit"></i>
                                </button>
                                <button class="delete-rule-set">
                                    <i class="codicon codicon-trash"></i>
                                </button>
                            </div>
                        </div>
                        <div class="rule-items">
                            <div class="rule-item">
                                <input type="checkbox" id="rule1" checked>
                                <label for="rule1">Strict Type Checking</label>
                            </div>
                            <div class="rule-item">
                                <input type="checkbox" id="rule2" checked>
                                <label for="rule2">No Any Type</label>
                            </div>
                        </div>
                    </div>
                    <div class="rule-set">
                        <div class="rule-set-header">
                            <h4>Documentation Rules</h4>
                            <div class="rule-set-actions">
                                <button class="edit-rule-set">
                                    <i class="codicon codicon-edit"></i>
                                </button>
                                <button class="delete-rule-set">
                                    <i class="codicon codicon-trash"></i>
                                </button>
                            </div>
                        </div>
                        <div class="rule-items">
                            <div class="rule-item">
                                <input type="checkbox" id="rule3" checked>
                                <label for="rule3">JSDoc Required</label>
                            </div>
                            <div class="rule-item">
                                <input type="checkbox" id="rule4" checked>
                                <label for="rule4">Parameter Descriptions</label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    public setWebview(webview: vscode.WebviewView) {
        this._view = webview;
    }
} 