import * as vscode from 'vscode';
import { SettingsService } from '../../services/settingsService';
import { ExtensionSettings } from '../../models/settings';

export class SettingsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.settingsView';
    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly settingsService: SettingsService
    ) {
        this._extensionUri = extensionUri;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this._setWebviewMessageListener(webviewView.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'settings.js'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const styleSettingsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'settings.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleMainUri}" rel="stylesheet">
                <link href="${styleSettingsUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <title>Settings</title>
            </head>
            <body>
                <div class="settings-container">
                    <div class="settings-section">
                        <h2>Model Providers</h2>
                        <div id="providerList" class="provider-list"></div>
                    </div>
                    <div class="settings-section">
                        <h2>Rate Limits</h2>
                        <div id="rateLimitSettings" class="rate-limit-settings"></div>
                    </div>
                    <div class="settings-section">
                        <h2>Theme</h2>
                        <div id="themeSettings" class="theme-settings"></div>
                    </div>
                    <div class="settings-section">
                        <h2>Security</h2>
                        <div id="securitySettings" class="security-settings"></div>
                    </div>
                    <div class="settings-section">
                        <h2>Shortcuts</h2>
                        <div id="shortcutSettings" class="shortcut-settings"></div>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message: any) => {
                const { command, settings } = message;

                switch (command) {
                    case 'getSettings':
                        try {
                            const currentSettings = this.settingsService.loadSettings();
                            webview.postMessage({
                                type: 'setSettings',
                                settings: currentSettings
                            });
                        } catch (error) {
                            webview.postMessage({
                                type: 'error',
                                message: error instanceof Error ? error.message : 'An error occurred'
                            });
                        }
                        break;

                    case 'updateSettings':
                        try {
                            await this.settingsService.updateSettings(settings);
                            webview.postMessage({
                                type: 'settingsUpdated'
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