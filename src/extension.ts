// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatViewProvider } from './webview/chatViewProvider';
import { ComposerViewProvider } from './webview/composerViewProvider';
import { aiService } from './services/aiService';
import { indexService } from './services/indexService';
import { CompletionService } from './services/completionService';
import { AgentService } from './services/llm/agentService';
import { ModelConfig } from './services/llm/types';
import { OllamaService } from './services/llm/ollamaService';
import { semanticAnalysisService } from './services/semanticAnalysisService';
import { chatService } from './services/chatService';
import { composerService } from './services/composerService';
import { workspaceIndexer } from './services/workspaceIndexer';
import { suggestionService } from './services/suggestionService';
import { SuggestionViewProvider } from './webview/suggestionViewProvider';
import { RulesService } from './services/rulesService';
import { RulesViewProvider } from './webview/rulesViewProvider';
import { MainViewProvider } from './webview/mainViewProvider';
import { SettingsService } from './services/settingsService';
import { SettingsViewProvider } from './webview/settingsViewProvider';

let completionServiceInstance: CompletionService;
let agentServiceInstance: AgentService;

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
		agentServiceInstance = AgentService.getInstance();
		
		// Initialize view providers
		const mainViewProvider = new MainViewProvider(context.extensionUri);
		const chatViewProvider = new ChatViewProvider(context.extensionUri);
		const composerViewProvider = new ComposerViewProvider(context.extensionUri);
		const suggestionViewProvider = new SuggestionViewProvider(context.extensionUri);
		const rulesViewProvider = new RulesViewProvider(context.extensionUri);
		const settingsViewProvider = new SettingsViewProvider(context.extensionUri);

		// Register view providers
		const mainViewDisposable = vscode.window.registerWebviewViewProvider(
			MainViewProvider.viewType,
			mainViewProvider,
			{
				webviewOptions: { 
					retainContextWhenHidden: true
				}
			}
		);

		const settingsViewDisposable = vscode.window.registerWebviewViewProvider(
			SettingsViewProvider.viewType,
			settingsViewProvider,
			{
				webviewOptions: { retainContextWhenHidden: true }
			}
		);

		context.subscriptions.push(mainViewDisposable, settingsViewDisposable);

		// Register commands
		context.subscriptions.push(
			vscode.commands.registerCommand('smile-ai.switchToChat', function() {
				mainViewProvider.switchTab('chat');
			}),
			vscode.commands.registerCommand('smile-ai.switchToComposer', function() {
				mainViewProvider.switchTab('composer');
			}),
			vscode.commands.registerCommand('smile-ai.switchToSuggestions', function() {
				mainViewProvider.switchTab('suggestions');
			}),
			vscode.commands.registerCommand('smile-ai.switchToRules', function() {
				mainViewProvider.switchTab('rules');
			}),
			vscode.commands.registerCommand('smile-ai.switchToSettings', function() {
				mainViewProvider.switchTab('settings');
			})
		);

		// Initialize agent service after everything else is set up
		await agentServiceInstance.initialize().catch(error => {
			console.error('Failed to initialize agent service:', error);
			// Continue even if agent service fails
		});

		console.log('Smile AI extension activated successfully');
	} catch (error) {
		console.error('Error activating Smile AI extension:', error);
		// Rethrow to ensure VS Code knows activation failed
		throw error;
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
