// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatViewProvider } from './presentation/webview/ChatViewProvider';
import { ComposerViewProvider } from './webview/composerViewProvider';
import { SuggestionViewProvider } from './webview/suggestionViewProvider';
import { RulesViewProvider } from './webview/rulesViewProvider';
import { MainViewProvider } from './webview/mainViewProvider';
import { SettingsViewProvider } from './webview/settingsViewProvider';
import { VSCodeChatRepository } from './infrastructure/repositories/VSCodeChatRepository';
import { ChatService } from './application/services/ChatService';
import { SettingsService } from './services/settingsService';
import { RateLimiterService } from './services/rateLimiterService';
import { ErrorHandlingService } from './services/errorHandlingService';
import { AIServiceFactory } from './services/llm/aiServiceFactory';
import { ModelProvider } from './models/settings';

// Command identifiers
export const COMMANDS = {
	OPEN_CHAT: 'smile-ai.openChat',
	START_COMPOSER: 'smile-ai.startComposer',
	TOGGLE_CODE_COMPLETION: 'smile-ai.toggleCodeCompletion',
	OPEN_SETTINGS: 'smile-ai.openSettings',
	SWITCH_VIEW: 'smile-ai.switchView',
	SELECT_PROVIDER: 'smile-ai.selectProvider',
	SELECT_OLLAMA_MODEL: 'smile-ai.selectOllamaModel',
	CREATE_RULE: 'smile-ai.createRule',
	EDIT_RULE: 'smile-ai.editRule',
	VIEW_RULES: 'smile-ai.viewRules'
};

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	console.log('Smile AI extension is being activated...');

	try {
		// Initialize services
		const settingsService = SettingsService.getInstance();
		const rateLimiterService = RateLimiterService.getInstance(settingsService);
		const errorHandlingService = new ErrorHandlingService(settingsService);
		const aiServiceFactory = AIServiceFactory.getInstance(settingsService, rateLimiterService, errorHandlingService);
		const chatRepository = VSCodeChatRepository.getInstance(context);

		// Initialize chat service
		const chatService = ChatService.getInstance(
			chatRepository,
			aiServiceFactory,
			settingsService,
			rateLimiterService,
			errorHandlingService
		);

		// Register webview providers
		const suggestionProvider = new SuggestionViewProvider(context.extensionUri, chatService);
		const rulesProvider = new RulesViewProvider(context.extensionUri, chatService);
		const mainProvider = new MainViewProvider(
			context.extensionUri,
			settingsService,
			rateLimiterService,
			errorHandlingService,
			context
		);
		const settingsProvider = new SettingsViewProvider(context.extensionUri, settingsService);
		const composerProvider = new ComposerViewProvider(context.extensionUri);
		const chatProvider = new ChatViewProvider(context.extensionUri, chatService);

		// Register webview panels
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				SuggestionViewProvider.viewType,
				suggestionProvider,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			),
			vscode.window.registerWebviewViewProvider(
				RulesViewProvider.viewType,
				rulesProvider,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			),
			vscode.window.registerWebviewViewProvider(
				MainViewProvider.viewType,
				mainProvider,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			),
			vscode.window.registerWebviewViewProvider(
				SettingsViewProvider.viewType,
				settingsProvider,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			),
			vscode.window.registerWebviewViewProvider(
				ComposerViewProvider.viewType,
				composerProvider,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			),
			vscode.window.registerWebviewViewProvider(
				ChatViewProvider.viewType,
				chatProvider,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			)
		);

		// Register commands
		context.subscriptions.push(
			vscode.commands.registerCommand('smile-ai.switchToChat', () => {
				mainProvider.handleViewSwitch('chat');
			}),
			vscode.commands.registerCommand('smile-ai.switchToComposer', () => {
				mainProvider.handleViewSwitch('composer');
			}),
			vscode.commands.registerCommand('smile-ai.switchToSuggestions', () => {
				mainProvider.handleViewSwitch('suggestions');
			}),
			vscode.commands.registerCommand('smile-ai.switchToRules', () => {
				mainProvider.handleViewSwitch('rules');
			}),
			vscode.commands.registerCommand('smile-ai.switchToSettings', () => {
				mainProvider.handleViewSwitch('settings');
			}),
			vscode.commands.registerCommand('smile-ai.openChat', () => {
				vscode.commands.executeCommand('workbench.view.extension.smile-ai-chat-view');
			}),
			vscode.commands.registerCommand('smile-ai.clearChat', async () => {
				await chatService.clearSession();
				vscode.window.showInformationMessage('Chat cleared successfully');
			}),
			vscode.commands.registerCommand('smile-ai.switchProvider', async () => {
				const providers = await aiServiceFactory.getAvailableProviders();
				const selectedProvider = await vscode.window.showQuickPick(
					providers.map(provider => ({
						label: formatProviderName(provider),
						value: provider
					})),
					{
						placeHolder: 'Select AI Provider'
					}
				);

				if (selectedProvider) {
					try {
						await chatService.switchProvider(selectedProvider.value);
						vscode.window.showInformationMessage(`Switched to ${selectedProvider.label}`);
					} catch (error) {
						if (error instanceof Error) {
							vscode.window.showErrorMessage(`Failed to switch provider: ${error.message}`);
						} else {
							vscode.window.showErrorMessage('Failed to switch provider: Unknown error');
						}
					}
				}
			})
		);

		// Status bar item for current provider
		const providerStatusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			100
		);
		providerStatusBarItem.command = 'smile-ai.switchProvider';
		context.subscriptions.push(providerStatusBarItem);

		// Update status bar when provider changes
		const updateStatusBar = () => {
			const provider = aiServiceFactory.getCurrentProvider();
			if (provider) {
				providerStatusBarItem.text = `$(hubot) ${formatProviderName(provider)}`;
				providerStatusBarItem.show();
			}
		};

		settingsService.onSettingsChanged(updateStatusBar);
		updateStatusBar();

		console.log('Smile AI extension activated successfully');
	} catch (error) {
		console.error('Error activating Smile AI extension:', error);
		throw error;
	}
}

function formatProviderName(provider: ModelProvider): string {
	switch (provider) {
		case 'ollama': return 'Ollama (Local)';
		case 'openai': return 'OpenAI';
		case 'anthropic': return 'Anthropic Claude';
		case 'lmstudio': return 'LM Studio (Local)';
		case 'localai': return 'LocalAI (Local)';
		case 'deepseek': return 'Deepseek Coder';
		case 'qwen': return 'Qwen';
		default: return provider;
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('Smile AI extension is being deactivated...');
	try {
		// Cleanup code here
		console.log('Smile AI extension deactivated successfully');
	} catch (error) {
		console.error('Error deactivating Smile AI extension:', error);
		throw error;
	}
}
