import * as vscode from 'vscode';
import { ChatService } from '../../application/services/ChatService';

export class SuggestionViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.suggestionView';
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
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'suggestion.js'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
        const styleSuggestionUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'suggestion.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleMainUri}" rel="stylesheet">
                <link href="${styleSuggestionUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <title>Suggestions</title>
            </head>
            <body>
                <div class="suggestion-container">
                    <div class="suggestion-list" id="suggestionList"></div>
                    <div class="suggestion-input-container">
                        <textarea id="suggestionInput" placeholder="Type your suggestion..."></textarea>
                        <button id="sendButton" class="send-button">
                            <i class="codicon codicon-send"></i>
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
                const { command, text } = message;

                switch (command) {
                    case 'getSuggestions':
                        try {
                            const suggestions = await this.chatService.getSuggestions(text);
                            webview.postMessage({
                                type: 'setSuggestions',
                                suggestions
                            });
                        } catch (error) {
                            webview.postMessage({
                                type: 'error',
                                message: error instanceof Error ? error.message : 'An error occurred'
                            });
                        }
                        break;

                    case 'applySuggestion':
                        try {
                            await this.chatService.applySuggestion(text);
                            webview.postMessage({
                                type: 'suggestionApplied'
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