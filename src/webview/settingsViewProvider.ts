import * as vscode from 'vscode';
import { SettingsService } from '../services/settingsService';
import { ExtensionSettings, ModelProvider } from '../models/settings';

interface WebviewMessage {
    type: 'updateSettings' | 'refreshProviderModels' | 'setApiKey';
    settings?: Partial<ExtensionSettings>;
    provider?: ModelProvider;
    apiKey?: string;
}

export class SettingsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'smile-ai.settingsView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly settingsService: SettingsService
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getWebviewContent(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            switch (message.type) {
                case 'updateSettings':
                    if (message.settings) {
                        await this.settingsService.updateSettings(message.settings);
                    }
                    break;
                case 'refreshProviderModels':
                    if (message.provider) {
                        await this.settingsService.refreshProviderModels(message.provider);
                    }
                    break;
                case 'setApiKey':
                    if (message.provider && message.apiKey) {
                        await this.settingsService.setApiKey(message.provider, message.apiKey);
                    }
                    break;
            }
        });

        // Initial settings load
        this.updateSettings(this.settingsService.getSettings());

        // Listen for settings changes
        this.settingsService.onSettingsChanged(() => {
            this.updateSettings(this.settingsService.getSettings());
        });
    }

    private getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'media', 'settings.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'settings.css')
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'codicon.css')
        );

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
                <link href="${styleUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <title>Settings</title>
            </head>
            <body>
                <div class="settings-container">
                    <div class="settings-section">
                        <h2><i class="codicon codicon-server"></i> AI Providers</h2>
                        <div class="provider-list" id="providerList">
                            <!-- Providers will be dynamically added here -->
                        </div>
                    </div>

                    <div class="settings-section">
                        <h2><i class="codicon codicon-settings-gear"></i> Model Parameters</h2>
                        <div class="parameter-list" id="parameterList">
                            <!-- Parameters will be dynamically added here -->
                        </div>
                    </div>

                    <div class="settings-section">
                        <h2><i class="codicon codicon-paintcan"></i> Appearance</h2>
                        <div class="theme-settings" id="themeSettings">
                            <!-- Theme settings will be dynamically added here -->
                        </div>
                    </div>

                    <div class="settings-section">
                        <h2><i class="codicon codicon-key"></i> Security</h2>
                        <div class="security-settings" id="securitySettings">
                            <!-- Security settings will be dynamically added here -->
                        </div>
                    </div>

                    <div class="settings-section">
                        <h2><i class="codicon codicon-keyboard"></i> Shortcuts</h2>
                        <div class="shortcut-settings" id="shortcutSettings">
                            <!-- Shortcut settings will be dynamically added here -->
                        </div>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    public async updateSettings(settings: ExtensionSettings): Promise<void> {
        if (!this._view) {
            return;
        }

        this._view.webview.postMessage({
            type: 'updateSettings',
            settings
        });
    }
} 