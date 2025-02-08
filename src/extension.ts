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

let completionServiceInstance: CompletionService;
let agentService: AgentService;

// Command identifiers
const COMMANDS = {
	OPEN_CHAT: 'smile-ai.openChat',
	START_COMPOSER: 'smile-ai.startComposer',
	TOGGLE_CODE_COMPLETION: 'smile-ai.toggleCodeCompletion',
	OPEN_SETTINGS: 'smile-ai.openSettings',
	SWITCH_VIEW: 'smile-ai.switchView',
	SELECT_PROVIDER: 'smile-ai.selectProvider',
	SELECT_OLLAMA_MODEL: 'smile-ai.selectOllamaModel'
};

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	console.log('Smile AI Extension aktivasyonu başladı');

	try {
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

		// Agent servisini başlat
		agentService = new AgentService(config);
		await agentService.initialize();

		// View providers
		const chatViewProvider = new ChatViewProvider(context.extensionUri);
		const composerViewProvider = new ComposerViewProvider(context.extensionUri);

		// Initialize services
		completionServiceInstance = new CompletionService();
		
		// Register completion provider
		context.subscriptions.push(
			completionServiceInstance.registerCompletionProvider()
		);

		// Register views
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider('smile-ai.chatView', chatViewProvider),
			vscode.window.registerWebviewViewProvider('smile-ai.composerView', composerViewProvider)
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
				vscode.window.showInformationMessage('Kod tamamlama başlatılıyor...');
			}),

			vscode.commands.registerCommand('smile-ai.codeAnalysis', () => {
				vscode.window.showInformationMessage('Kod analizi başlatılıyor...');
			}),

			vscode.commands.registerCommand('smile-ai.generateCode', () => {
				vscode.window.showInformationMessage('Kod üretimi başlatılıyor...');
			}),

			vscode.commands.registerCommand('smile-ai.generateDocs', () => {
				vscode.window.showInformationMessage('Dokümantasyon üretimi başlatılıyor...');
			}),

			vscode.commands.registerCommand('smile-ai.generateTests', () => {
				vscode.window.showInformationMessage('Test üretimi başlatılıyor...');
			}),

			vscode.commands.registerCommand('smile-ai.refactorCode', () => {
				vscode.window.showInformationMessage('Kod yeniden düzenleme başlatılıyor...');
			}),

			vscode.commands.registerCommand('smile-ai.fixBug', () => {
				vscode.window.showInformationMessage('Hata düzeltme başlatılıyor...');
			}),

			vscode.commands.registerCommand(COMMANDS.SELECT_PROVIDER, async () => {
				const providers = ['openai', 'anthropic', 'ollama'];
				const selected = await vscode.window.showQuickPick(providers, {
					placeHolder: 'AI sağlayıcısını seçin'
				});

				if (selected) {
					await vscode.workspace.getConfiguration('smile-ai').update('provider', selected, true);
					vscode.window.showInformationMessage(`AI sağlayıcısı ${selected} olarak değiştirildi`);
				}
			}),

			vscode.commands.registerCommand(COMMANDS.SELECT_OLLAMA_MODEL, async () => {
				const config = vscode.workspace.getConfiguration('smile-ai');
				if (config.get('provider') !== 'ollama') {
					vscode.window.showErrorMessage('Bu komut yalnızca Ollama sağlayıcısı seçiliyken kullanılabilir');
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
							detail: `Son güncelleme: ${new Date(m.modified_at).toLocaleString()}`
						})),
						{ placeHolder: 'Ollama modelini seçin' }
					);

					if (selected) {
						await ollamaService.setModel(selected.label);
						vscode.window.showInformationMessage(`Ollama modeli ${selected.label} olarak değiştirildi`);
					}

					ollamaService.dispose();
				} catch (error) {
					vscode.window.showErrorMessage('Ollama modelleri yüklenirken hata oluştu: ' + 
						(error instanceof Error ? error.message : 'Bilinmeyen bir hata'));
				}
			})
		);

		// Ayarlar değiştiğinde servisleri yeniden başlat
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('smile-ai')) {
					vscode.window.showInformationMessage('Smile AI ayarları güncellendi. Servisler yeniden başlatılıyor...');
				}
			})
		);

		// Workspace açıldığında veya değiştiğinde indexlemeyi başlat
		if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
			indexService.startIndexing(vscode.workspace.workspaceFolders[0]);
		}

		context.subscriptions.push(
			vscode.workspace.onDidChangeWorkspaceFolders(e => {
				if (e.added.length > 0) {
					indexService.startIndexing(e.added[0]);
				}
			})
		);

		// Add services to context
		context.subscriptions.push(completionServiceInstance);
		context.subscriptions.push(agentService);

		vscode.window.showInformationMessage('Smile AI başarıyla aktive edildi!');
	} catch (error) {
		console.error('Smile AI aktivasyon hatası:', error);
		vscode.window.showErrorMessage('Smile AI aktivasyonu başarısız oldu: ' + 
			(error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu'));
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	aiService.dispose();
	indexService.dispose();
	if (completionServiceInstance) {
		completionServiceInstance.dispose();
	}
	if (agentService) {
		agentService.dispose();
	}
}
