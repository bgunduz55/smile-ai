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
import { ChatView } from './views/ChatView';
import { CodebaseView } from './views/CodebaseView';
import { ImprovementsView } from './views/ImprovementsView';

// Export the main extension class
export class SmileAIExtension {
    private readonly aiEngine: AIEngine;
    private readonly fileAnalyzer: FileAnalyzer;
    private readonly codeAnalyzer: CodeAnalyzer;
    private readonly codebaseIndexer: CodebaseIndexer;
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
        
        // Initialize AI Engine
        const aiConfig: AIEngineConfig = {
            provider: {
                name: 'ollama',
                modelName: 'gemma3:12b',
                apiEndpoint: 'http://localhost:11434'
            },
            maxTokens: 2048,
            temperature: 0.7,
            embeddingModelName: 'nomic-embed-text'
        };
        this.aiEngine = new AIEngine(aiConfig);
        
        // Initialize CodebaseIndexer
        this.codebaseIndexer = CodebaseIndexer.getInstance(this.aiEngine);
        
        // Initialize tree view provider
        this.improvementProvider = new ImprovementTreeProvider(this.improvementManager);
        vscode.window.registerTreeDataProvider('smile-ai.futureImprovements', this.improvementProvider);

        // Register additional tree views
        const emptyTreeDataProvider = {
            getTreeItem: (element: vscode.TreeItem): vscode.TreeItem => element,
            getChildren: (): Thenable<vscode.TreeItem[]> => Promise.resolve([])
        };
        vscode.window.registerTreeDataProvider('smile-ai-codebase', emptyTreeDataProvider);
        vscode.window.registerTreeDataProvider('smile-ai-improvements', emptyTreeDataProvider);

        // Register webview provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('smile-ai.assistant', {
                resolveWebviewView: (webviewView: vscode.WebviewView) => {
                    AIAssistantPanel.currentPanel = new AIAssistantPanel(
                        webviewView,
                        context,
                        this.aiEngine,
                        this.modelManager,
                        this.codebaseIndexer
                    );
                }
            })
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
        const statusCallbacks = {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        };

        // Initialize each executor individually
        this.taskExecutors.set(TaskType.EXPLANATION, new ExplanationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.TEST_GENERATION, new TestGenerationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.DOCUMENTATION, new DocumentationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.REFACTORING, new RefactoringExecutor(this.aiEngine, this.codebaseIndexer));
        this.taskExecutors.set(TaskType.IMPROVEMENT_NOTE, new ImprovementNoteExecutor(this.aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.TESTING, new TestingExecutor(this.aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.DEBUGGING, new DebuggingExecutor(this.aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.OPTIMIZATION, new OptimizationExecutor(this.aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.SECURITY, new SecurityExecutor(this.aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.REVIEW, new ReviewExecutor(this.aiEngine, statusCallbacks));

        await this.startIndexing();
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

    // Initialize AI Engine first with configuration
    const aiConfig: AIEngineConfig = {
        provider: {
            name: 'ollama',
            modelName: 'gemma3:12b',
            apiEndpoint: 'http://localhost:11434'
        },
        maxTokens: 2048,
        temperature: 0.7,
        embeddingModelName: 'nomic-embed-text'
    };
    const aiEngine = new AIEngine(aiConfig);

    // Initialize managers using getInstance pattern
    const modelManager = ModelManager.getInstance();
    const codebaseIndexer = CodebaseIndexer.getInstance(aiEngine);
    const improvementManager = ImprovementManager.getInstance();

    // Register views
    const chatView = ChatView.getInstance(context.extensionUri);
    const codebaseView = new CodebaseView();
    const improvementsView = new ImprovementsView(improvementManager);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('smile-ai.startChat', () => {
            chatView.show();
        }),
        vscode.commands.registerCommand('smile-ai.indexWorkspace', async () => {
            await codebaseIndexer.indexWorkspace();
        }),
        vscode.commands.registerCommand('smile-ai.attachFile', async (uri: vscode.Uri) => {
            if (uri) {
                await codebaseIndexer.attachFile(uri.fsPath);
            }
        }),
        vscode.commands.registerCommand('smile-ai.attachFolder', async (uri: vscode.Uri) => {
            if (uri) {
                await codebaseIndexer.attachFolder(uri.fsPath);
            }
        }),
        vscode.commands.registerCommand('smile-ai.addModel', async () => {
            await modelManager.addModel({
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
            await modelManager.removeModel(modelName);
        }),
        vscode.commands.registerCommand('smile-ai.selectActiveModel', async (modelName: string) => {
            await modelManager.setActiveModel(modelName);
        })
    );

    // Register views in the container
    vscode.window.registerTreeDataProvider('smile-ai-codebase', codebaseView);
    vscode.window.registerTreeDataProvider('smile-ai-improvements', improvementsView);

    // Register webview view
    vscode.window.registerWebviewViewProvider('smile-ai-chat', chatView);

    // Initial indexing
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Indexing workspace...",
        cancellable: false
    }, async (progress) => {
        await codebaseIndexer.indexWorkspace((message) => {
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
