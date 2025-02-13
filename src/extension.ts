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
import { CodebaseIndexer } from './utils/CodebaseIndexer';
import { ModelManager } from './utils/ModelManager';
import { ModelTreeProvider } from './views/ModelTreeProvider';
import { FileContext } from './utils/FileAnalyzer';
import { AIAssistantPanel } from './views/AIAssistantPanel';

// Extension sınıfı
class SmileAIExtension {
    private aiEngine!: AIEngine;
    private taskManager!: TaskManager;
    private taskPlanner!: TaskPlanner;
    private executors!: Map<TaskType, any>;
    private context: vscode.ExtensionContext;
    private codebaseIndexer: CodebaseIndexer;
    private modelManager: ModelManager;
    private modelTreeProvider: ModelTreeProvider;
    private statusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.codebaseIndexer = CodebaseIndexer.getInstance();
        this.modelManager = ModelManager.getInstance();
        this.modelTreeProvider = new ModelTreeProvider(this.modelManager);
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        
        this.initializeComponents();
        this.registerViews();
        this.registerCommands();
        this.startIndexing();
    }

    private async startIndexing() {
        this.statusBarItem.text = "$(sync~spin) Smile AI: Indexing...";
        this.statusBarItem.show();

        try {
            await this.codebaseIndexer.indexWorkspace();
            this.statusBarItem.text = "$(check) Smile AI: Ready";
        } catch (error) {
            this.statusBarItem.text = "$(error) Smile AI: Indexing Failed";
            vscode.window.showErrorMessage('Codebase indexleme hatası: ' + error);
        }
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
        this.executors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(this.aiEngine));
        this.executors.set(TaskType.TEST_GENERATION, new TestGenerationExecutor(this.aiEngine));
        this.executors.set(TaskType.DOCUMENTATION, new DocumentationExecutor(this.aiEngine));
        this.executors.set(TaskType.REFACTORING, new RefactoringExecutor(this.aiEngine));
        this.executors.set(TaskType.EXPLANATION, new ExplanationExecutor(this.aiEngine));

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
        this.executors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(this.aiEngine));
        this.executors.set(TaskType.TEST_GENERATION, new TestGenerationExecutor(this.aiEngine));
        this.executors.set(TaskType.DOCUMENTATION, new DocumentationExecutor(this.aiEngine));
        this.executors.set(TaskType.REFACTORING, new RefactoringExecutor(this.aiEngine));
        this.executors.set(TaskType.EXPLANATION, new ExplanationExecutor(this.aiEngine));
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
    }

    private async analyzeCode() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error('Aktif bir editör bulunamadı');
            }

            // Dosya bağlamını al
            const fileContext: FileContext | undefined = this.codebaseIndexer.getFileContext(editor.document.uri);
            
            // Analiz görevi oluştur
            const task = await this.taskPlanner.planTask('Analyze the current code file');
            task.type = TaskType.CODE_ANALYSIS;
            task.metadata = { fileContext: fileContext as FileContext, codeAnalysis: null as any };

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

            // Dosya bağlamını al
            const fileContext: FileContext | undefined = this.codebaseIndexer.getFileContext(editor.document.uri);

            // Test üretme görevi oluştur
            const task = await this.taskPlanner.planTask('Generate tests for the current code file');
            task.type = TaskType.TEST_GENERATION;
            task.metadata = { fileContext: fileContext as FileContext, codeAnalysis: null as any };

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

            // Dosya bağlamını al
            const fileContext: FileContext | undefined = this.codebaseIndexer.getFileContext(editor.document.uri);

            // Refactoring görevi oluştur
            const task = await this.taskPlanner.planTask('Refactor the current code file');
            task.type = TaskType.REFACTORING;
            task.metadata = { fileContext: fileContext as FileContext, codeAnalysis: null as any };

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

            // Dosya bağlamını al
            const fileContext: FileContext | undefined = this.codebaseIndexer.getFileContext(editor.document.uri);

            // Açıklama görevi oluştur
            const task = await this.taskPlanner.planTask('Explain the current code file');
            task.type = TaskType.EXPLANATION;
            task.metadata = { fileContext: fileContext as FileContext, codeAnalysis: null as any };

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

    public dispose() {
        this.statusBarItem.dispose();
        this.codebaseIndexer.dispose();
    }
}

// Extension aktivasyon
let extension: SmileAIExtension | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Smile AI aktif!');
    extension = new SmileAIExtension(context);
}

// Extension deaktivasyon
export function deactivate() {
    if (extension) {
        extension.dispose();
    }
    console.log('Smile AI deaktif!');
    extension = undefined;
} 