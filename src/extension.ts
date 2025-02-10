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
	console.log('Smile AI Extension activation started');

	try {
		// Initialize services
		agentServiceInstance = AgentService.getInstance();
		await agentServiceInstance.initialize();

		// Register views
		const chatViewProvider = new ChatViewProvider(context.extensionUri);
		const composerViewProvider = new ComposerViewProvider(context.extensionUri);
		const suggestionViewProvider = new SuggestionViewProvider(context.extensionUri);
		const rulesViewProvider = new RulesViewProvider(context.extensionUri);
		const mainViewProvider = new MainViewProvider(context.extensionUri);

		// Model konfigürasyonunu yükle
		const config: ModelConfig = {
			modelPath: context.asAbsolutePath('models/llama-2-7b-chat.gguf'),
			contextSize: 4096,
			temperature: 0.7,
			topP: 0.9,
			maxTokens: 2048,
			stopTokens: ['</s>', '<s>'],
			gpuConfig: {
				enabled: true,
				layers: 32,
				device: 'cuda'
			},
			performance: {
				batchSize: 512,
				threads: Math.max(1, Math.floor(require('os').cpus().length / 2)),
				useMlock: true,
				useMemorymap: true
			},
			caching: {
				enabled: true,
				maxSize: 1024 * 1024 * 1024, // 1GB
				ttl: 60 * 60 * 1000 // 1 saat
			}
		};

		// Initialize services
		completionServiceInstance = new CompletionService();
		
		// Register completion provider
		context.subscriptions.push(
			completionServiceInstance.registerCompletionProvider()
		);

		// Register views
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider('smile-ai.chatView', chatViewProvider),
			vscode.window.registerWebviewViewProvider('smile-ai.composerView', composerViewProvider),
			vscode.window.registerWebviewViewProvider(SuggestionViewProvider.viewType, suggestionViewProvider),
			vscode.window.registerWebviewViewProvider(RulesViewProvider.viewType, rulesViewProvider),
			vscode.window.registerWebviewViewProvider(MainViewProvider.viewType, mainViewProvider)
		);

		// Register commands
		context.subscriptions.push(
			vscode.commands.registerCommand(COMMANDS.OPEN_CHAT, () => {
				vscode.commands.executeCommand('smile-ai.chatView.focus');
			}),

			vscode.commands.registerCommand(COMMANDS.START_COMPOSER, () => {
				vscode.commands.executeCommand('smile-ai.composerView.focus');
			}),

			vscode.commands.registerCommand(COMMANDS.TOGGLE_CODE_COMPLETION, () => {
				completionServiceInstance.toggleCompletion();
			}),

			vscode.commands.registerCommand(COMMANDS.OPEN_SETTINGS, () => {
				vscode.commands.executeCommand('workbench.action.openSettings', 'smile-ai');
			}),

			vscode.commands.registerCommand(COMMANDS.SWITCH_VIEW, () => {
				const activeView = vscode.window.activeTextEditor?.document.uri.scheme === 'smile-ai.chatView' ? 'chat' : 'composer';
				if (activeView === 'chat') {
					vscode.commands.executeCommand('smile-ai.composerView.focus');
				} else {
					vscode.commands.executeCommand('smile-ai.chatView.focus');
				}
			}),

			vscode.commands.registerCommand('smile-ai.codeCompletion', () => {
				vscode.window.showInformationMessage('Code completion started...');
			}),


			vscode.commands.registerCommand('smile-ai.codeAnalysis', async () => {
				try {
					const editor = vscode.window.activeTextEditor;
					if (!editor) {
						vscode.window.showWarningMessage('Please open a file to analyze');
						return;
					}


					const document = editor.document;
					const supportedLanguages = semanticAnalysisService.getSupportedLanguages();
					
					if (!supportedLanguages.includes(document.languageId)) {
						vscode.window.showWarningMessage(
							`This feature is currently only supported for the following languages: ${supportedLanguages.join(', ')}`
						);
						return;
					}


					vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: "Code analysis in progress...",
						cancellable: false
					}, async () => {

						const result = await semanticAnalysisService.analyzeFile(document);
						
						// Analiz sonuçlarını göster
						const panel = vscode.window.createWebviewPanel(
							'codeAnalysis',
							'Code Analysis Results',
							vscode.ViewColumn.Two,
							{
								enableScripts: true
							}
						);


						panel.webview.html = `
							<!DOCTYPE html>
							<html>
							<head>
								<style>
									body { 
										font-family: Arial, sans-serif; 
										padding: 20px;
										color: var(--vscode-foreground);
										background-color: var(--vscode-editor-background);
									}
									.metric { margin-bottom: 20px; }
									.metric-title { font-weight: bold; margin-bottom: 5px; }
									.metric-value { color: var(--vscode-foreground); }
									.section { margin-bottom: 30px; }
									.section-title { 
										font-size: 1.2em; 
										color: var(--vscode-textLink-foreground); 
										margin-bottom: 10px; 
									}
									.dependency { 
										margin: 5px 0;
										padding: 5px;
										background-color: var(--vscode-editor-selectionBackground);
										border-radius: 3px;
									}
									.symbol { 
										padding: 5px;
										border-bottom: 1px solid var(--vscode-editor-lineHighlightBorder);
									}
								</style>
							</head>
							<body>
								<div class="section">
									<div class="section-title">Kod Metrikleri</div>
									<div class="metric">
										<div class="metric-title">Karmaşıklık</div>
										<div class="metric-value">${result.metrics.complexity}</div>
									</div>
									<div class="metric">
										<div class="metric-title">Satır Sayısı</div>
										<div class="metric-value">${result.metrics.linesOfCode}</div>
									</div>
									<div class="metric">
										<div class="metric-title">Yorum Satırları</div>
										<div class="metric-value">${result.metrics.commentLines}</div>
									</div>
									<div class="metric">
										<div class="metric-title">Bakım İndeksi</div>
										<div class="metric-value">${result.metrics.maintainabilityIndex.toFixed(2)}/100</div>
									</div>
								</div>

								<div class="section">
									<div class="section-title">Bağımlılıklar</div>
									${Array.from(result.dependencies.entries()).map(([module, imports]) => `
										<div class="dependency">
											<strong>${module}</strong>: ${imports.join(', ')}
										</div>
									`).join('')}
								</div>

								<div class="section">
									<div class="section-title">Semboller</div>
									${Array.from(result.symbols.entries()).map(([name, symbol]) => `
										<div class="symbol">
											<div><strong>${name}</strong> (${symbol.type})</div>
											${symbol.documentation ? `<div style="color: var(--vscode-textPreformat-foreground);">${symbol.documentation}</div>` : ''}
										</div>
									`).join('')}
								</div>
							</body>
							</html>
						`;
					});
				} catch (error) {
					vscode.window.showErrorMessage('An error occurred during code analysis: ' + 
						(error instanceof Error ? error.message : 'Unknown error'));
				}

			}),

			vscode.commands.registerCommand('smile-ai.generateCode', () => {
				vscode.window.showInformationMessage('Code generation started...');
			}),


			vscode.commands.registerCommand('smile-ai.generateDocs', () => {
				vscode.window.showInformationMessage('Documentation generation started...');
			}),


			vscode.commands.registerCommand('smile-ai.generateTests', () => {
				vscode.window.showInformationMessage('Test generation started...');
			}),


			vscode.commands.registerCommand('smile-ai.refactorCode', () => {
				vscode.window.showInformationMessage('Code refactoring started...');
			}),


			vscode.commands.registerCommand('smile-ai.fixBug', () => {
				vscode.window.showInformationMessage('Bug fixing started...');
			}),


			vscode.commands.registerCommand(COMMANDS.SELECT_PROVIDER, async () => {
				const providers = ['openai', 'anthropic', 'ollama', 'lmstudio', 'localai', 'deepseek', 'qwen'];
				const selected = await vscode.window.showQuickPick(providers, {
					placeHolder: 'Select AI provider'
				});


				if (selected) {
					await vscode.workspace.getConfiguration('smile-ai').update('provider', selected, true);
					vscode.window.showInformationMessage(`AI provider changed to ${selected}`);
				}

			}),

			vscode.commands.registerCommand(COMMANDS.SELECT_OLLAMA_MODEL, async () => {
				const config = vscode.workspace.getConfiguration('smile-ai');
				if (config.get('provider') !== 'ollama') {
					vscode.window.showErrorMessage('This command is only available when the Ollama provider is selected');
					return;
				}


				try {
					const ollamaService = new OllamaService();
					await ollamaService.initialize();
					const models = await ollamaService.listModels();
					
					const selected = await vscode.window.showQuickPick(
						models.map(m => ({
							label: m.name,
							description: `${m.details.parameter_size} - ${m.details.format}`,
							detail: `Last update: ${new Date(m.modified_at).toLocaleString()}`
						})),
						{ placeHolder: 'Select an Ollama model' }

					);

					if (selected) {
						await ollamaService.setModel(selected.label);
						vscode.window.showInformationMessage(`Ollama model changed to ${selected.label}`);
					}


					ollamaService.dispose();
				} catch (error) {
					vscode.window.showErrorMessage('An error occurred while loading Ollama models: ' + 
						(error instanceof Error ? error.message : 'Unknown error'));
				}

			}),

			vscode.commands.registerCommand(COMMANDS.CREATE_RULE, async () => {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					vscode.window.showErrorMessage('Please open a workspace');
					return;
				}


				const ruleName = await vscode.window.showInputBox({
					prompt: 'Enter a new rule set name',
					placeHolder: 'Example: api-conventions'
				});


				if (ruleName) {
					await RulesService.getInstance().createRule(workspaceFolder, ruleName);
				}
			}),

			vscode.commands.registerCommand(COMMANDS.EDIT_RULE, async () => {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					vscode.window.showErrorMessage('Please open a workspace');
					return;
				}


				const config = vscode.workspace.getConfiguration('smile-ai.rules');
				const enabledRules = config.get<string[]>('enabledRules', []);

				const ruleName = await vscode.window.showQuickPick(enabledRules, {
					placeHolder: 'Select the rule set to edit'
				});


				if (ruleName) {
					await RulesService.getInstance().editRule(workspaceFolder, ruleName);
				}
			}),

			vscode.commands.registerCommand(COMMANDS.VIEW_RULES, async () => {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					vscode.window.showErrorMessage('Please open a workspace');
					return;
				}


				await RulesService.getInstance().viewRules(workspaceFolder);
			}),

			vscode.commands.registerCommand('smile-ai.switchToChat', () => {
				mainViewProvider.switchTab('chat');
			}),

			vscode.commands.registerCommand('smile-ai.switchToComposer', () => {
				mainViewProvider.switchTab('composer');
			}),

			vscode.commands.registerCommand('smile-ai.switchToSuggestions', () => {
				mainViewProvider.switchTab('suggestions');
			}),

			vscode.commands.registerCommand('smile-ai.switchToRules', () => {
				mainViewProvider.switchTab('rules');
			}),

			vscode.commands.registerCommand('smile-ai.switchToSettings', () => {
				mainViewProvider.switchTab('settings');
			})
		);

		// Ayarlar değiştiğinde servisleri yeniden başlat
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('smile-ai')) {
					vscode.window.showInformationMessage('Smile AI settings updated. Services are being restarted...');
				}
			})

		);

		// Workspace açıldığında veya değiştiğinde indexlemeyi ve kuralları yükle
		if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
			const workspaceFolder = vscode.workspace.workspaceFolders[0];
			await indexService.startIndexing(workspaceFolder);
			await RulesService.getInstance().loadRules(workspaceFolder);
		}

		context.subscriptions.push(
			vscode.workspace.onDidChangeWorkspaceFolders(async e => {
				if (e.added.length > 0) {
					await indexService.startIndexing(e.added[0]);
					await RulesService.getInstance().loadRules(e.added[0]);
				}
			})
		);

		// Add services to context
		context.subscriptions.push(completionServiceInstance);
		context.subscriptions.push(agentServiceInstance);

		// Servisleri başlat
		context.subscriptions.push(
			chatService,
			composerService,
			completionServiceInstance,
			indexService,
			workspaceIndexer,
			suggestionService
		);

		// Index the workspace
		if (vscode.workspace.workspaceFolders?.length) {
			await workspaceIndexer.startIndexing(vscode.workspace.workspaceFolders[0]);
		}

		// Show success message
		vscode.window.showInformationMessage('Smile AI successfully activated!');

		// Dispose services on deactivation
		context.subscriptions.push({
			dispose: () => {
				agentServiceInstance.dispose();
			}
		});

	} catch (error) {
		console.error('Smile AI activation error:', error);
		vscode.window.showErrorMessage('Smile AI activation failed: ' + 
			(error instanceof Error ? error.message : 'Unknown error'));
	}

}

// This method is called when your extension is deactivated
export function deactivate() {
	aiService.dispose();
	indexService.dispose();
	if (completionServiceInstance) {
		completionServiceInstance.dispose();
	}
	if (agentServiceInstance) {
		agentServiceInstance.dispose();
	}
}
