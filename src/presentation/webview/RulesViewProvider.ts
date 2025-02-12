import * as vscode from 'vscode';
import { ChatService } from '../../application/services/ChatService';

export class RulesViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.rulesView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly chatService: ChatService
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this._setWebviewMessageListener(webviewView.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'rules.js'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
        const styleRulesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'rules.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleMainUri}" rel="stylesheet">
                <link href="${styleRulesUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <title>Rules</title>
            </head>
            <body>
                <div class="rules-container">
                    <div class="rules-list" id="rulesList"></div>
                    <div class="rules-input-container">
                        <input type="text" id="ruleInput" placeholder="Enter rule name...">
                        <button id="addButton" class="add-button">
                            <i class="codicon codicon-add"></i>
                        </button>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message: any) => {
                const { command, rule } = message;

                switch (command) {
                    case 'getRules':
                        try {
                            const rules = await this.chatService.getRules();
                            webview.postMessage({
                                type: 'setRules',
                                rules
                            });
                        } catch (error) {
                            webview.postMessage({
                                type: 'error',
                                message: error instanceof Error ? error.message : 'An error occurred'
                            });
                        }
                        break;

                    case 'addRule':
                        try {
                            await this.chatService.addRule(rule);
                            webview.postMessage({
                                type: 'ruleAdded',
                                rule
                            });
                        } catch (error) {
                            webview.postMessage({
                                type: 'error',
                                message: error instanceof Error ? error.message : 'An error occurred'
                            });
                        }
                        break;

                    case 'removeRule':
                        try {
                            await this.chatService.removeRule(rule);
                            webview.postMessage({
                                type: 'ruleRemoved',
                                rule
                            });
                        } catch (error) {
                            webview.postMessage({
                                type: 'error',
                                message: error instanceof Error ? error.message : 'An error occurred'
                            });
                        }
                        break;
                }
            },
            undefined,
            []
        );
    }
} 