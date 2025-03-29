import * as vscode from 'vscode';
import { AIEngine } from './ai-engine/AIEngine';
import { TaskManager } from './agent/TaskManager';
import { TaskPlanner } from './agent/TaskPlanner';
import { CodeAnalysisExecutor } from './agent/executors/CodeAnalysisExecutor';
import { CodeModificationExecutor } from './agent/executors/CodeModificationExecutor';
import { TestGenerationExecutor } from './agent/executors/TestGenerationExecutor';
import { DocumentationExecutor } from './agent/executors/DocumentationExecutor';
import { RefactoringExecutor } from './agent/executors/RefactoringExecutor';
import { ExplanationExecutor } from './agent/executors/ExplanationExecutor';
import { Task, TaskType, TaskStatus, TaskPriority } from './agent/types';
import { CodebaseIndex } from './indexing/CodebaseIndex';
import { ModelManager } from './utils/ModelManager';
import { ModelTreeProvider } from './views/ModelTreeProvider';
import { FileContext } from './utils/FileAnalyzer';
import { AIAssistantPanel } from './views/AIAssistantPanel';
import { ImprovementManager } from './utils/ImprovementManager';
import { ImprovementNoteContext, ImprovementNote, ImprovementNoteStatus } from './agent/types';
import { ImprovementTreeProvider } from './views/ImprovementTreeProvider';

// Extension sınıfı
class SmileAIExtension {
    private aiEngine!: AIEngine;
    private taskManager!: TaskManager;
    private taskPlanner!: TaskPlanner;
    private executors!: Map<TaskType, any>;
    private context: vscode.ExtensionContext;
    private codebaseIndexer: CodebaseIndex;
    private modelManager: ModelManager;
    private modelTreeProvider: ModelTreeProvider;
    private statusBarItem: vscode.StatusBarItem;
    private improvementManager: ImprovementManager;
    private improvementTreeProvider: ImprovementTreeProvider;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.codebaseIndexer = CodebaseIndex.getInstance();
        this.modelManager = ModelManager.getInstance();
        ImprovementManager.initialize(context);
        this.improvementManager = ImprovementManager.getInstance();
        this.modelTreeProvider = new ModelTreeProvider(this.modelManager);
        this.improvementTreeProvider = new ImprovementTreeProvider(this.improvementManager);
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        
        this.initializeComponents();
        this.registerViews();
        this.registerTreeViews();
        this.registerCommands();
        this.startIndexing().catch(err => console.error("Initial indexing failed:", err));
    }

    private async startIndexing() {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: "Smile AI: Indexing Codebase",
            cancellable: false
        }, async (progress) => {
            this.statusBarItem.text = "$(sync~spin) Smile AI: Indexing...";
            this.statusBarItem.show();
    
            try {
                await this.codebaseIndexer.buildIndex(progress);
                this.statusBarItem.text = "$(check) Smile AI: Ready";
            } catch (error) {
                this.statusBarItem.text = "$(error) Smile AI: Indexing Failed";
                console.error('Codebase indexing error:', error);
                vscode.window.showErrorMessage(`Codebase indexing failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }

    private initializeComponents() {
        // AI Engine'i yapılandır
        const activeModel = this.modelManager.getActiveModel();
        if (!activeModel) {
            vscode.window.showWarningMessage('No active AI model configured. Please add and select a model.');
            return;
        }

        this.aiEngine = new AIEngine({
            provider: {
                name: activeModel.provider,
                modelName: activeModel.modelName,
                apiEndpoint: activeModel.apiEndpoint
            },
            maxTokens: activeModel.maxTokens || 2048,
            temperature: activeModel.temperature || 0.7
        });

        // Task yönetim sistemini başlat
        this.taskManager = new TaskManager();
        this.taskPlanner = new TaskPlanner(this.aiEngine);

        // Executor'ları kaydet
        this.executors = new Map();
        this.executors.set(TaskType.CODE_ANALYSIS, new CodeAnalysisExecutor(this.aiEngine));
        this.executors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(this.aiEngine, this.codebaseIndexer));
        this.executors.set(TaskType.TEST_GENERATION, new TestGenerationExecutor(this.aiEngine));
        this.executors.set(TaskType.DOCUMENTATION, new DocumentationExecutor(this.aiEngine));
        this.executors.set(TaskType.REFACTORING, new RefactoringExecutor(this.aiEngine, this.codebaseIndexer));
        this.executors.set(TaskType.EXPLANATION, new ExplanationExecutor(this.aiEngine, this.codebaseIndexer));

        // Workspace değişikliklerini dinle
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.startIndexing();
        });

        // Model değişikliklerini dinle
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('smile-ai.activeModel')) {
                this.reinitializeAIEngine();
            }
        });
    }

    private async reinitializeAIEngine() {
        const activeModel = this.modelManager.getActiveModel();
        if (!activeModel) {
            vscode.window.showWarningMessage('No active AI model configured. Please add and select a model.');
            return;
        }

        this.aiEngine = new AIEngine({
            provider: {
                name: activeModel.provider,
                modelName: activeModel.modelName,
                apiEndpoint: activeModel.apiEndpoint
            },
            maxTokens: activeModel.maxTokens || 2048,
            temperature: activeModel.temperature || 0.7
        });

        // Executor'ları güncelle
        this.executors.set(TaskType.CODE_ANALYSIS, new CodeAnalysisExecutor(this.aiEngine));
        this.executors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(this.aiEngine, this.codebaseIndexer));
        this.executors.set(TaskType.TEST_GENERATION, new TestGenerationExecutor(this.aiEngine));
        this.executors.set(TaskType.DOCUMENTATION, new DocumentationExecutor(this.aiEngine));
        this.executors.set(TaskType.REFACTORING, new RefactoringExecutor(this.aiEngine, this.codebaseIndexer));
        this.executors.set(TaskType.EXPLANATION, new ExplanationExecutor(this.aiEngine, this.codebaseIndexer));
    }

    private registerViews() {
        const context = this.context;
        const aiEngine = this.aiEngine;

        // AI Assistant panel'ini kaydet
        this.context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                'smile-ai.assistant',
                {
                    resolveWebviewView(webviewView) {
                        AIAssistantPanel.show(webviewView, context, aiEngine);
                    }
                }
            )
        );
    }

    private registerTreeViews() {
        // Register Future Improvements Tree View
        this.context.subscriptions.push(
            vscode.window.registerTreeDataProvider(
                'smile-ai.futureImprovements', 
                this.improvementTreeProvider
            )
        );

        // Register other tree views if any (like ModelTreeProvider)
        // vscode.window.registerTreeDataProvider('smile-ai.models', this.modelTreeProvider);
        // Ensure ModelTreeProvider is also registered if it exists and is intended
    }

    private registerCommands() {
        // Model yönetimi komutları
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.addModel', () => {
                this.modelManager.promptAddModel();
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.removeModel', async (item) => {
                if (item?.model) {
                    await this.modelManager.removeModel(item.model.name);
                }
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.selectActiveModel', async (item) => {
                if (item?.model) {
                    await this.modelManager.setActiveModel(item.model.name);
                } else {
                    await this.modelManager.promptSelectActiveModel();
                }
            })
        );

        // Kod analizi komutu
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.analyzeCode', async () => {
                await this.analyzeCode();
            })
        );

        // Test üretme komutu
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.generateTests', async () => {
                await this.generateTests();
            })
        );

        // Kod refactoring komutu
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.refactorCode', async () => {
                await this.refactorCode();
            })
        );

        // Kod açıklama komutu
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.explainCode', async () => {
                await this.explainCode();
            })
        );

        // Yeniden indexleme komutu
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.reindexCodebase', async () => {
                await this.startIndexing();
            })
        );

        // --- Register Note Improvement Command --- 
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.noteImprovement', async () => {
                await this.noteImprovement();
                this.improvementTreeProvider.refresh();
            })
        );

        // --- Register TreeView Item Commands --- 
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.markImprovementDone', async (note: ImprovementNote) => {
                if (note?.id) {
                    await this.improvementManager.updateNoteStatus(note.id, ImprovementNoteStatus.DONE);
                    // Tree view should refresh automatically via the event listener
                } else {
                    vscode.window.showErrorMessage('Could not mark improvement as done: Invalid note provided.');
                }
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.dismissImprovement', async (note: ImprovementNote) => {
                if (note?.id) {
                    await this.improvementManager.updateNoteStatus(note.id, ImprovementNoteStatus.DISMISSED);
                } else {
                     vscode.window.showErrorMessage('Could not dismiss improvement: Invalid note provided.');
                }
            })
        );

        // TODO: Register command for opening context later
        // this.context.subscriptions.push(
        //     vscode.commands.registerCommand('smile-ai.openImprovementContext', async (note: ImprovementNote) => {
        //         // ... implementation to open file and go to location ...
        //     })
        // );
        // -----------------------------------------
    }

    private async analyzeCode() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error('Aktif bir editör bulunamadı');
            }

            const filePath = vscode.workspace.asRelativePath(editor.document.uri);
            const fileData = this.codebaseIndexer.getFileData(filePath);
            console.log(`File data for ${filePath}:`, fileData);
            
            const task = await this.taskPlanner.planTask('Analyze the current code file');
            task.type = TaskType.CODE_ANALYSIS;

            this.taskManager.addTask(task);
            const executor = this.executors.get(task.type);
            if (!executor) { throw new Error(`${task.type} için executor bulunamadı`); }
            const result = await executor.execute(task);
            if (!result.success) { throw new Error(result.error); }
            vscode.window.showInformationMessage('Kod analizi tamamlandı!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Kod analizi sırasında hata: ${error.message}`);
        }
    }

    private async generateTests() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error('Aktif bir editör bulunamadı');
            }

            const filePath = vscode.workspace.asRelativePath(editor.document.uri);
            const fileData = this.codebaseIndexer.getFileData(filePath);
            console.log(`File data for ${filePath}:`, fileData);
            
            const task = await this.taskPlanner.planTask('Generate tests for the current code');
            task.type = TaskType.TEST_GENERATION;

            this.taskManager.addTask(task);
            const executor = this.executors.get(task.type);
            if (!executor) { throw new Error(`${task.type} için executor bulunamadı`); }
            const result = await executor.execute(task);
            if (!result.success) { throw new Error(result.error); }
            vscode.window.showInformationMessage('Test üretimi tamamlandı!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Test üretimi sırasında hata: ${error.message}`);
        }
    }

    private async refactorCode() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error('Aktif bir editör bulunamadı');
            }

            // Refactoring görevi oluştur
            const task = await this.taskPlanner.planTask('Refactor the selected code or current file');
            task.type = TaskType.REFACTORING;

            // Görevi yöneticiye ekle
            this.taskManager.addTask(task);

            // İlgili executor'ı bul ve çalıştır
            const executor = this.executors.get(task.type);
            if (!executor) {
                throw new Error(`${task.type} için executor bulunamadı`);
            }

            const result = await executor.execute(task);
            if (!result.success) {
                throw new Error(result.error);
            }

            vscode.window.showInformationMessage('Kod refactoring tamamlandı!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Kod refactoring sırasında hata: ${error.message}`);
        }
    }

    private async explainCode() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error('Aktif bir editör bulunamadı');
            }

            // Açıklama görevi oluştur
            const task = await this.taskPlanner.planTask('Explain the selected code or current file');
            task.type = TaskType.EXPLANATION;

            // Görevi yöneticiye ekle
            this.taskManager.addTask(task);

            // İlgili executor'ı bul ve çalıştır
            const executor = this.executors.get(task.type);
            if (!executor) {
                throw new Error(`${task.type} için executor bulunamadı`);
            }

            const result = await executor.execute(task);
            if (!result.success) {
                throw new Error(result.error);
            }

            vscode.window.showInformationMessage('Kod açıklaması tamamlandı!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Kod açıklama sırasında hata: ${error.message}`);
        }
    }

    // --- Implement Note Improvement Logic --- 
    private async noteImprovement() {
        const editor = vscode.window.activeTextEditor;
        let description = '';
        let noteContext: ImprovementNoteContext | undefined = undefined;

        if (editor) {
            const selection = editor.selection;
            const document = editor.document;
            const filePath = vscode.workspace.asRelativePath(document.uri);

            if (selection && !selection.isEmpty) {
                description = document.getText(selection);
                noteContext = {
                    filePath: filePath,
                    selection: {
                        startLine: selection.start.line + 1,
                        startChar: selection.start.character,
                        endLine: selection.end.line + 1,
                        endChar: selection.end.character
                    },
                    selectedText: description
                };
                // Optionally try to find the symbol name for context
                const midPointPos = new vscode.Position(
                    Math.floor((selection.start.line + selection.end.line) / 2),
                    Math.floor((selection.start.character + selection.end.character) / 2)
                );
                const symbol = this.codebaseIndexer.findSymbolAtPosition(filePath, midPointPos);
                if (symbol) {
                    noteContext.symbolName = symbol.name;
                }
            } else {
                // No selection, ask user for description
                description = await vscode.window.showInputBox({ 
                    prompt: 'Enter a description for the future improvement:',
                    placeHolder: 'e.g., Refactor this function to be more efficient'
                }) || '';
                
                if (description && filePath) {
                     noteContext = { filePath: filePath };
                     // Add symbol context if cursor is inside one
                     const symbol = this.codebaseIndexer.findSymbolAtPosition(filePath, selection.active);
                     if (symbol) {
                         noteContext.symbolName = symbol.name;
                     }
                }
            }
        } else {
            // No editor open, just ask for description
            description = await vscode.window.showInputBox({ 
                prompt: 'Enter a description for the future improvement:',
                 placeHolder: 'e.g., Add unit tests for the authentication module'
            }) || '';
        }

        if (!description) {
            vscode.window.showInformationMessage('Improvement note cancelled.');
            return;
        }

        try {
            const newNote = await this.improvementManager.addNote(description, noteContext);
            vscode.window.showInformationMessage(`Future improvement noted: "${newNote.description.substring(0, 30)}..."`);
            // TODO: Refresh the TreeView here later
        } catch (error) {
            console.error('Error adding improvement note:', error);
            vscode.window.showErrorMessage(`Failed to note improvement: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // ---------------------------------------

    public dispose() {
        this.statusBarItem.dispose();
        if (this.codebaseIndexer) {
            this.codebaseIndexer.dispose();
        }
    }
}

// Extension aktivasyon
let extension: SmileAIExtension | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Smile AI aktif!');
    extension = new SmileAIExtension(context);
    context.subscriptions.push(extension);
}

// Extension deaktivasyon
export function deactivate() {
    if (extension) {
        extension.dispose();
    }
    console.log('Smile AI deaktif!');
    extension = undefined;
} 