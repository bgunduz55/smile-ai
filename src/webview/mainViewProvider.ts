import * as vscode from 'vscode';

export class MainViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.mainView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Smile AI</title>
            </head>
            <body>
                <div class="tab-container">
                    <div class="tab-buttons">
                        <button class="tab-button active" data-tab="chat">Chat</button>
                        <button class="tab-button" data-tab="composer">Composer</button>
                        <button class="tab-button" data-tab="suggestions">Öneriler</button>
                        <button class="tab-button" data-tab="rules">Kurallar</button>
                        <button class="tab-button" data-tab="settings">Ayarlar</button>
                    </div>
                    <div class="tab-content">
                        <div id="chat" class="tab-pane active">
                            <h2>Chat</h2>
                            <p>Chat içeriği burada olacak.</p>
                        </div>
                        <div id="composer" class="tab-pane">
                            <h2>Composer</h2>
                            <p>Composer içeriği burada olacak.</p>
                        </div>
                        <div id="suggestions" class="tab-pane">
                            <h2>Öneriler</h2>
                            <p>Öneriler içeriği burada olacak.</p>
                        </div>
                        <div id="rules" class="tab-pane">
                            <h2>Kurallar</h2>
                            <p>Kurallar içeriği burada olacak.</p>
                        </div>
                        <div id="settings" class="tab-pane">
                            <h2>Ayarlar</h2>
                            <p>Ayarlar içeriği burada olacak.</p>
                        </div>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }
} 