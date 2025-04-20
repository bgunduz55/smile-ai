import * as vscode from 'vscode';
import { AIEngine } from './ai-engine/AIEngine';
import { TaskType, TaskExecutor } from './agent/types';
import { CodeModificationExecutor } from './agent/executors/CodeModificationExecutor';
import { TestGenerationExecutor } from './agent/executors/TestGenerationExecutor';
import { DocumentationExecutor } from './agent/executors/DocumentationExecutor';
import { RefactoringExecutor } from './agent/executors/RefactoringExecutor';
import { ExplanationExecutor } from './agent/executors/ExplanationExecutor';
import { ImprovementManager } from './improvements/ImprovementManager';
import { CodebaseIndexer } from './indexing/CodebaseIndexer';
import { FileAnalyzer } from './utils/FileAnalyzer';
import { CodeAnalyzer } from './utils/CodeAnalyzer';
import { ImprovementNoteExecutor } from './agent/executors/ImprovementNoteExecutor';
import { TestingExecutor } from './agent/executors/TestingExecutor';
import { DebuggingExecutor } from './agent/executors/DebuggingExecutor';
import { OptimizationExecutor } from './agent/executors/OptimizationExecutor';
import { SecurityExecutor } from './agent/executors/SecurityExecutor';
import { ReviewExecutor } from './agent/executors/ReviewExecutor';
import { ImprovementTreeProvider } from './views/ImprovementTreeProvider';
import { AIAssistantPanel } from './views/AIAssistantPanel';
import { ModelManager } from './utils/ModelManager';
import { AIEngineConfig } from './ai-engine/AIEngineConfig';
import { RAGService } from './indexing/RAGService';

// Export the main extension class
export class SmileAIExtension {
    private readonly aiEngine: AIEngine;
    private readonly fileAnalyzer: FileAnalyzer;
    private readonly codeAnalyzer: CodeAnalyzer;
    public readonly codebaseIndexer: CodebaseIndexer;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly taskExecutors: Map<TaskType, TaskExecutor>;
    private readonly improvementProvider: ImprovementTreeProvider;
    private readonly modelManager: ModelManager;
    private readonly improvementManager: ImprovementManager;

    constructor(context: vscode.ExtensionContext) {
        this.fileAnalyzer = FileAnalyzer.getInstance();
        this.codeAnalyzer = CodeAnalyzer.getInstance();
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusBarItem.show();

        // Initialize managers and providers
        this.modelManager = ModelManager.getInstance();
        this.improvementManager = ImprovementManager.getInstance();
        
        // Get RAG settings from configuration
        const config = vscode.workspace.getConfiguration('smile-ai');
        const enableRAG = config.get<boolean>('enableRAG', true);
        
        // Initialize AI Engine with active model from ModelManager
        const activeModel = this.modelManager.getActiveModel();
        if (!activeModel) {
            // If no active model, use default settings
            const aiConfig: AIEngineConfig = {
                provider: {
                    name: 'ollama',
                    modelName: 'qwen2.5-coder:7b',
                    apiEndpoint: 'http://localhost:11434'
                },
                maxTokens: 2048,
                temperature: 0.7,
                embeddingModelName: 'nomic-embed-text',
                enableRAG: enableRAG
            };
            this.aiEngine = new AIEngine(aiConfig);
        } else {
            const aiConfig: AIEngineConfig = {
                provider: {
                    name: activeModel.provider,
                    modelName: activeModel.modelName,
                    apiEndpoint: activeModel.apiEndpoint
                },
                maxTokens: activeModel.maxTokens || 2048,
                temperature: activeModel.temperature || 0.7,
                embeddingModelName: activeModel.embeddingModelName || 'nomic-embed-text',
                enableRAG: activeModel.enableRAG !== undefined ? activeModel.enableRAG : enableRAG
            };
            this.aiEngine = new AIEngine(aiConfig);
        }
        
        // Initialize CodebaseIndexer
        this.codebaseIndexer = CodebaseIndexer.getInstance(this.aiEngine);
        
        // Initialize RAG service with codebase index
        this.aiEngine.initRAG(this.codebaseIndexer.getIndex());
        
        // Update RAG settings from configuration
        if (this.aiEngine) {
            const ragService = RAGService.getInstance(this.aiEngine, this.codebaseIndexer.getIndex());
            if (ragService) {
                ragService.setEnabled(enableRAG);
                ragService.setMaxChunks(config.get<number>('rag.maxChunks', 5));
                ragService.setMaxChunkSize(config.get<number>('rag.maxChunkSize', 2000));
                ragService.setMinSimilarity(config.get<number>('rag.minSimilarity', 0.7));
            }
        }
        
        // Initialize tree view provider
        this.improvementProvider = new ImprovementTreeProvider(this.improvementManager);
        vscode.window.registerTreeDataProvider('smile-ai.futureImprovements', this.improvementProvider);

        // Register webview provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('smile-ai.assistant', {
                resolveWebviewView: (webviewView: vscode.WebviewView) => {
                    // Set webview options
                    webviewView.webview.options = {
                        enableScripts: true,
                        enableCommandUris: true,
                        localResourceRoots: [
                            vscode.Uri.joinPath(context.extensionUri, 'media'),
                            vscode.Uri.joinPath(context.extensionUri, 'dist')
                        ]
                    };
                    
                    AIAssistantPanel.currentPanel = new AIAssistantPanel(
                        webviewView,
                        context,
                        this.aiEngine,
                        this.modelManager,
                        this.codebaseIndexer
                    );
                }
            }, { webviewOptions: { retainContextWhenHidden: true } })
        );
        
        this.taskExecutors = new Map();

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.openChat', () => {
                vscode.commands.executeCommand('smile-ai.assistant.focus');
            }),
            vscode.commands.registerCommand('smile-ai.openComposer', () => {
                // TODO: Implement composer view
            }),
            vscode.commands.registerCommand('smile-ai.addModel', async () => {
                await this.modelManager.addModel({
                    name: 'Gemma 3 12B',
                    provider: 'ollama',
                    modelName: 'gemma3:12b',
                    apiEndpoint: 'http://localhost:11434',
                    maxTokens: 2048,
                    temperature: 0.7,
                    embeddingModelName: 'nomic-embed-text'
                });
            }),
            vscode.commands.registerCommand('smile-ai.removeModel', async (modelName: string) => {
                await this.modelManager.removeModel(modelName);
            }),
            vscode.commands.registerCommand('smile-ai.selectActiveModel', async (modelName: string) => {
                await this.modelManager.setActiveModel(modelName);
            }),
            vscode.commands.registerCommand('smile-ai.noteImprovement', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }

                const selection = editor.selection;
                
                const note = await vscode.window.showInputBox({
                    prompt: 'Enter improvement note',
                    placeHolder: 'What needs to be improved?'
                });

                if (note) {
                    await this.improvementManager.addNote(note, {
                        file: editor.document.uri.fsPath,
                        selection: {
                            startLine: selection.start.line,
                            startChar: selection.start.character,
                            endLine: selection.end.line,
                            endChar: selection.end.character
                        },
                        status: 'pending',
                        priority: 'medium',
                        timestamp: Date.now()
                    });
                }
            }),
            vscode.commands.registerCommand('smile-ai.markImprovementDone', (item) => {
                this.improvementManager.updateNoteStatus(item.id, 'done');
            }),
            vscode.commands.registerCommand('smile-ai.dismissImprovement', (item) => {
                this.improvementManager.updateNoteStatus(item.id, 'dismissed');
            }),
            vscode.commands.registerCommand('smile-ai.setImprovementPriority', async (item) => {
                const priority = await vscode.window.showQuickPick(['low', 'medium', 'high', 'none'], {
                    placeHolder: 'Select priority'
                });

                if (priority) {
                    this.improvementManager.updateNotePriority(item.id, priority as 'low' | 'medium' | 'high' | 'none');
                }
            }),
            vscode.commands.registerCommand('smile-ai.reindexCodebase', async () => {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Indexing codebase...",
                    cancellable: false
                }, async (progress) => {
                    await this.codebaseIndexer.indexWorkspace((message) => {
                        progress.report({ message });
                    });
                });
            })
        );
        
        this.initializeComponents();
    }

    private setStatusBarMessage(text: string, tooltip?: string, icon?: string): void {
        this.statusBarItem.text = icon ? `${icon} ${text}` : text;
        if (tooltip) {
            this.statusBarItem.tooltip = tooltip;
        }
    }

    private showLoading(message?: string): void {
        this.setStatusBarMessage(message || 'Loading...', undefined, '$(sync~spin)');
    }

    private showReady(message?: string): void {
        this.setStatusBarMessage(message || 'Ready', undefined, '$(check)');
    }

    private showError(message?: string): void {
        this.setStatusBarMessage(message || 'Error', undefined, '$(error)');
        vscode.window.showErrorMessage(message || 'An error occurred');
    }

    public async analyzeFile(document: vscode.TextDocument): Promise<boolean> {
        try {
            const uri = document.uri;
            const fileContext = await this.fileAnalyzer.analyzeFile(uri);
            const analysis = await this.codeAnalyzer.analyzeCode(uri, fileContext);
            
            // Update the file context with analysis results
            fileContext.analysis = analysis;
            
            return true;
        } catch (error) {
            console.error('Error analyzing file:', error);
            return false;
        }
    }

    private async startIndexing(): Promise<void> {
        await this.codebaseIndexer.indexWorkspace();
    }

    private async initializeComponents(): Promise<void> {
        try {
            // Register task executors
            this.registerTaskExecutors();

            // Start indexing the codebase
            await this.startIndexing();

            // Listen for configuration changes to update RAG settings
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('smile-ai.enableRAG') || 
                    e.affectsConfiguration('smile-ai.rag')) {
                    this.updateRAGSettings();
                }
            });

            // Add other initialization tasks here
            this.showReady('Smile AI ready');
        } catch (error) {
            this.showError(`Initialization error: ${error instanceof Error ? error.message : String(error)}`);
            console.error('Initialization error:', error);
        }
    }

    private registerTaskExecutors(): void {
        this.taskExecutors.set(TaskType.EXPLANATION, new ExplanationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.TEST_GENERATION, new TestGenerationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.DOCUMENTATION, new DocumentationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.REFACTORING, new RefactoringExecutor(this.aiEngine, this.codebaseIndexer));
        this.taskExecutors.set(TaskType.IMPROVEMENT_NOTE, new ImprovementNoteExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.TESTING, new TestingExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.DEBUGGING, new DebuggingExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.OPTIMIZATION, new OptimizationExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.SECURITY, new SecurityExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.REVIEW, new ReviewExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
    }

    private updateRAGSettings(): void {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const enableRAG = config.get<boolean>('enableRAG', true);
        
        const ragService = RAGService.getInstance(this.aiEngine, this.codebaseIndexer.getIndex());
        if (ragService) {
            ragService.setEnabled(enableRAG);
            ragService.setMaxChunks(config.get<number>('rag.maxChunks', 5));
            ragService.setMaxChunkSize(config.get<number>('rag.maxChunkSize', 2000));
            ragService.setMinSimilarity(config.get<number>('rag.minSimilarity', 0.7));
        }
        
        // Update AI engine config
        this.aiEngine.updateConfig({ enableRAG });
    }

    public dispose() {
        this.statusBarItem.dispose();
        // Note: CodebaseIndexer and ImprovementManager don't need dispose methods
        if (AIAssistantPanel.currentPanel) {
            AIAssistantPanel.currentPanel.dispose();
        }
    }
}

// Extension activation
let extension: SmileAIExtension | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Smile AI active!');

    // Create the extension instance
    extension = new SmileAIExtension(context);

    // Register commands that don't require the extension instance
    context.subscriptions.push(
        vscode.commands.registerCommand('smile-ai.startChat', () => {
            vscode.commands.executeCommand('smile-ai.assistant.focus');
        }),
        vscode.commands.registerCommand('smile-ai.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'smile-ai');
        }),
        vscode.commands.registerCommand('smile-ai.attachFile', async (uri: vscode.Uri) => {
            if (uri) {
                await extension?.codebaseIndexer.attachFile(uri.fsPath);
            }
        }),
        vscode.commands.registerCommand('smile-ai.attachFolder', async (uri: vscode.Uri) => {
            if (uri) {
                await extension?.codebaseIndexer.attachFolder(uri.fsPath);
            }
        })
    );

    // Initial indexing
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Indexing workspace...",
        cancellable: false
    }, async (progress) => {
        await extension?.codebaseIndexer.indexWorkspace((message) => {
            progress.report({ message });
        });
    });
}

// Extension deactivation
export function deactivate() {
    if (extension) {
        extension.dispose();
    }
    console.log('Smile AI inactive!');
    extension = undefined;
} 
