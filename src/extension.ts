import * as vscode from 'vscode';
import * as ts from 'typescript';
import { AIEngine } from './ai-engine/AIEngine';
import { TaskManager } from './agent/TaskManager';
import { TaskPlanner } from './agent/TaskPlanner';
import { CodeAnalysisExecutor } from './agent/executors/CodeAnalysisExecutor';
import { CodeModificationExecutor } from './agent/executors/CodeModificationExecutor';
import { TestGenerationExecutor } from './agent/executors/TestGenerationExecutor';
import { DocumentationExecutor } from './agent/executors/DocumentationExecutor';
import { RefactoringExecutor } from './agent/executors/RefactoringExecutor';
import { ExplanationExecutor } from './agent/executors/ExplanationExecutor';
import { Task, TaskType, TaskStatus, TaskPriority, TaskExecutor, TaskResult } from './agent/types';
import { CodebaseIndex, SymbolInfo } from './indexing/CodebaseIndex';
import { ModelManager } from './utils/ModelManager';
import { ModelTreeProvider } from './views/ModelTreeProvider';
import { FileContext } from './utils/FileAnalyzer';
import { AIAssistantPanel } from './views/AIAssistantPanel';
import { ImprovementManager, ImprovementNote, ImprovementNoteStatus, ImprovementNoteContext } from './improvements/ImprovementManager';
import { ImprovementTreeProvider } from './views/ImprovementTreeProvider';
import { CodebaseIndexer } from './indexing/CodebaseIndexer';
import { FileAnalyzer } from './utils/FileAnalyzer';
import { CodeAnalyzer, CodeAnalysis } from './utils/CodeAnalyzer';
import { AIResponse } from './ai-engine/types';
import { BaseExecutor } from './agent/executors/BaseExecutor';
import { ImprovementNoteExecutor } from './agent/executors/ImprovementNoteExecutor';
import { TestingExecutor } from './agent/executors/TestingExecutor';
import { DebuggingExecutor } from './agent/executors/DebuggingExecutor';
import { OptimizationExecutor } from './agent/executors/OptimizationExecutor';
import { SecurityExecutor } from './agent/executors/SecurityExecutor';
import { ReviewExecutor } from './agent/executors/ReviewExecutor';

enum InteractionMode {
    Ask = 'ask',
    Edit = 'edit',
    Agent = 'agent'
}

// Export the main extension class
export class SmileAIExtension {
    private context: vscode.ExtensionContext;
    private aiEngine: AIEngine;
    private fileAnalyzer: FileAnalyzer;
    private codeAnalyzer: CodeAnalyzer;
    private taskPlanner: TaskPlanner;
    private taskManager: TaskManager;
    private codebaseIndexer: CodebaseIndexer;
    private executors: Map<TaskType, TaskExecutor>;
    private statusBarItem: vscode.StatusBarItem;
    private modelManager: ModelManager;
    private modelTreeProvider: ModelTreeProvider;
    private improvementManager: ImprovementManager;
    private improvementTreeProvider: ImprovementTreeProvider;
    private currentMode: InteractionMode;
    private taskExecutors: Map<TaskType, TaskExecutor>;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.aiEngine = new AIEngine({
            provider: {
                name: 'openai',
                modelName: 'gpt-4',
                apiEndpoint: 'https://api.openai.com/v1/chat/completions'
            },
            maxTokens: 4000,
            temperature: 0.7
        });
        this.fileAnalyzer = FileAnalyzer.getInstance();
        this.codeAnalyzer = CodeAnalyzer.getInstance();
        this.taskPlanner = new TaskPlanner(this.aiEngine);
        this.taskManager = new TaskManager();
        this.codebaseIndexer = CodebaseIndexer.getInstance();
        this.executors = new Map();
        this.taskExecutors = new Map();
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusBarItem.show();

        // Initialize managers and providers
        this.modelManager = ModelManager.getInstance();
        this.modelTreeProvider = new ModelTreeProvider(this.modelManager);
        ImprovementManager.initialize(this.context);
        this.improvementManager = ImprovementManager.getInstance();
        this.improvementTreeProvider = new ImprovementTreeProvider(this.improvementManager);
        this.currentMode = InteractionMode.Ask;

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

    private initializeExecutors(): void {
        const statusCallbacks: StatusCallbacks = {
            setStatusBar: (text: string, tooltip?: string, icon?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.setStatusBarMessage(message || 'Loading...'),
            showReady: (message?: string) => this.setStatusBarMessage(message || 'Ready'),
            showError: (message?: string) => this.showError(message || 'An error occurred')
        };

        this.executors.set(TaskType.EXPLANATION, new ExplanationExecutor(
            this.aiEngine,
            statusCallbacks
        ));

        this.executors.set(TaskType.REFACTORING, new RefactoringExecutor(
            this.aiEngine,
            this.codebaseIndexer
        ));

        this.executors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(
            this.aiEngine,
            statusCallbacks
        ));

        this.executors.set(TaskType.TEST_GENERATION, new TestGenerationExecutor(
            this.aiEngine
        ));
    }

    private async analyzeFile(document: vscode.TextDocument): Promise<void> {
        try {
            const fileContext = await this.fileAnalyzer.analyzeFile(document.uri);
            if (!fileContext) {
                throw new Error('Failed to analyze file');
            }

            const codeAnalysis = await this.codeAnalyzer.analyzeCode(document.uri, fileContext);
            if (!codeAnalysis) {
                throw new Error('Failed to analyze code');
            }

            // Process the analysis results
            console.log('File analysis completed:', {
                fileContext,
                codeAnalysis
            });
        } catch (error: any) {
            console.error('Error analyzing file:', error);
            throw error;
        }
    }

    private async handleAIResponse(response: AIResponse): Promise<void> {
        if (!response.success) {
            throw new Error(response.error || 'Unknown error occurred');
        }

        if (response.edit) {
            await vscode.workspace.applyEdit(response.edit);
        }

        vscode.window.showInformationMessage(response.message);
    }

    private async executeTask(task: Task): Promise<boolean> {
        try {
            const executor = this.executors.get(task.type);
            if (!executor) {
                throw new Error(`No executor found for task type: ${task.type}`);
            }

            const result = await executor.execute(task);
            if (typeof result === 'boolean') {
                return result;
            }
            
            return result.success;
        } catch (error: any) {
            console.error('Error executing task:', error);
            return false;
        }
    }

    private async indexWorkspace(): Promise<void> {
        await this.codebaseIndexer.indexWorkspace();
    }

    private async startIndexing(): Promise<void> {
        await this.codebaseIndexer.indexWorkspace();
    }

    private async initializeComponents() {
        const aiEngine = new AIEngine({
            provider: {
                name: 'openai',
                modelName: 'gpt-4',
                apiEndpoint: 'https://api.openai.com/v1/chat/completions'
            },
            maxTokens: 4000,
            temperature: 0.7
        });
        const statusCallbacks = {
            setStatusBar: (text: string, tooltip?: string, icon?: string) => {
                this.setStatusBarMessage(text, tooltip);
            },
            showLoading: (message?: string) => {
                this.setStatusBarMessage(message || 'Loading...', 'AI is processing your request');
            },
            showReady: (message?: string) => {
                this.setStatusBarMessage(message || 'Ready', 'AI is ready to help');
            },
            showError: (message?: string) => {
                this.showError(message || 'An error occurred');
            }
        };

        this.codeAnalyzer = CodeAnalyzer.getInstance();
        this.fileAnalyzer = FileAnalyzer.getInstance();
        this.improvementManager = ImprovementManager.getInstance();

        // Initialize task executors
        this.taskExecutors.set(TaskType.EXPLANATION, new ExplanationExecutor(aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.IMPROVEMENT_NOTE, new ImprovementNoteExecutor(aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.DOCUMENTATION, new DocumentationExecutor(aiEngine));
        this.taskExecutors.set(TaskType.REFACTORING, new RefactoringExecutor(aiEngine, this.codebaseIndexer));
        this.taskExecutors.set(TaskType.TESTING, new TestingExecutor(aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.DEBUGGING, new DebuggingExecutor(aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.OPTIMIZATION, new OptimizationExecutor(aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.SECURITY, new SecurityExecutor(aiEngine, statusCallbacks));
        this.taskExecutors.set(TaskType.REVIEW, new ReviewExecutor(aiEngine, statusCallbacks));

        // Set up workspace change listeners
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.codebaseIndexer.indexWorkspace();
        });

        // Listen for model changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('smile-ai.activeModel')) {
                this.reinitializeAIEngine();
            }
        });
    }

    private async reinitializeAIEngine(): Promise<void> {
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
            temperature: activeModel.temperature || 0.7,
            embeddingModelName: activeModel.embeddingModelName
        });

        if (this.codebaseIndexer) {
            this.codebaseIndexer.setAIEngine(this.aiEngine);
        }

        const statusCallbacks = {
            setStatusBar: (text: string, tooltip?: string, icon?: string) => this.setStatusBarMessage(text, tooltip, icon),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        };

        this.executors.set(TaskType.CODE_ANALYSIS, new CodeAnalysisExecutor(this.aiEngine));
        this.executors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(
            this.aiEngine,
            statusCallbacks
        ));
        this.executors.set(TaskType.TEST_GENERATION, new TestGenerationExecutor(
            this.aiEngine,
            statusCallbacks
        ));
        this.executors.set(TaskType.DOCUMENTATION, new DocumentationExecutor(this.aiEngine));
        this.executors.set(TaskType.REFACTORING, new RefactoringExecutor(
            this.aiEngine,
            this.codebaseIndexer
        ));
        this.executors.set(TaskType.EXPLANATION, new ExplanationExecutor(
            this.aiEngine,
            {
                setStatusBar: (text: string, tooltip?: string, icon?: string) => this.setStatusBarMessage(text, tooltip, icon),
                showError: (message?: string) => this.showError(message)
            }
        ));
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
                    await this.improvementManager.updateNoteStatus(note.id, 'completed');
                } else {
                    vscode.window.showErrorMessage('Could not mark improvement as done: Invalid note provided.');
                }
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.dismissImprovement', async (note: ImprovementNote) => {
                if (note?.id) {
                    await this.improvementManager.updateNoteStatus(note.id, 'dismissed');
                } else {
                    vscode.window.showErrorMessage('Could not dismiss improvement: Invalid note provided.');
                }
            })
        );

        // --- Register Semantic Search Command --- 
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.semanticCodeSearch', async () => {
                await this.semanticCodeSearch();
            })
        );
        // -----------------------------------------

        // Register the setImprovementPriority command
        let setImprovementPriorityCommand = vscode.commands.registerCommand('smile-ai.setImprovementPriority', async () => {
            const notes = this.improvementManager.getNotes().filter(note => note.status === 'pending');
            if (notes.length === 0) {
                vscode.window.showInformationMessage('No pending improvement notes found.');
                return;
            }

            // First, select a note
            const selectedNote = await vscode.window.showQuickPick(
                notes.map(note => ({
                    label: note.content,
                    description: `Priority: ${note.priority}`,
                    note: note
                })),
                {
                    placeHolder: 'Select an improvement note to change priority'
                }
            );

            if (!selectedNote) {
                return;
            }

            // Then, select a priority
            const selectedPriority = await vscode.window.showQuickPick(
                ['high', 'medium', 'low', 'none'],
                {
                    placeHolder: 'Select priority level'
                }
            ) as 'high' | 'medium' | 'low' | 'none' | undefined;

            if (!selectedPriority) {
                return;
            }

            // Update the note priority
            await this.improvementManager.updateNotePriority(selectedNote.note.id, selectedPriority);
            vscode.window.showInformationMessage(`Updated priority to ${selectedPriority} for note: ${selectedNote.note.content}`);
        });

        this.context.subscriptions.push(setImprovementPriorityCommand);

        // Register multi-file modification command
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.modifyMultipleFiles', async () => {
                const prompt = await vscode.window.showInputBox({
                    prompt: 'Describe the changes you want to make across multiple files',
                    placeHolder: 'e.g., Add error handling to all API calls'
                });

                if (!prompt) {
                    return;
                }

                // Get current file context
                const editor = vscode.window.activeTextEditor;
                let fileContext: FileContext | undefined;
                let codeAnalysis: CodeAnalysis | undefined;
                let selectedText: string | undefined;

                if (editor) {
                    fileContext = await this.fileAnalyzer.analyzeFile(editor.document);
                    if (fileContext) {
                        codeAnalysis = await this.codeAnalyzer.analyzeCode(editor.document, fileContext);
                    }
                    if (editor.selection) {
                        selectedText = editor.document.getText(editor.selection);
                    }
                }

                try {
                    const task: Task = {
                        id: Date.now().toString(),
                        type: TaskType.CODE_MODIFICATION,
                        description: prompt,
                        status: TaskStatus.PENDING,
                        priority: TaskPriority.MEDIUM,
                        metadata: fileContext && codeAnalysis ? {
                            fileContext,
                            codeAnalysis,
                            selectedText
                        } : undefined,
                        created: Date.now(),
                        updated: Date.now()
                    };
                    const success = await this.executors.get(TaskType.CODE_MODIFICATION)?.execute(task);
                    if (success) {
                        vscode.window.showInformationMessage('Code modifications completed successfully!');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to modify code: ${error}`);
                }
            })
        );

        // Register commands for interaction mode
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.switchMode', async () => {
                const modes = [
                    { label: '$(question) Ask', description: 'Ask questions about your code', mode: InteractionMode.Ask },
                    { label: '$(edit) Edit', description: 'Make code changes', mode: InteractionMode.Edit },
                    { label: '$(rocket) Agent', description: 'Autonomous coding tasks', mode: InteractionMode.Agent }
                ];

                const selected = await vscode.window.showQuickPick(modes, {
                    placeHolder: 'Select interaction mode'
                });

                if (selected) {
                    this.currentMode = selected.mode;
                    this.updateStatusBar();
                }
            })
        );

        // Register main interaction command
        this.context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.interact', async () => {
                if (!this.aiEngine) {
                    vscode.window.showErrorMessage('Please configure an AI model first.');
                    return;
                }

                const editor = vscode.window.activeTextEditor;
                const selection = editor?.selection;
                const selectedText = editor?.document.getText(selection);

                let prompt: string | undefined;
                let inputPlaceholder: string;

                switch (this.currentMode) {
                    case InteractionMode.Ask:
                        inputPlaceholder = 'Ask a question about your code...';
                        break;
                    case InteractionMode.Edit:
                        inputPlaceholder = 'Describe the changes you want to make...';
                        break;
                    case InteractionMode.Agent:
                        inputPlaceholder = 'Describe what you want the agent to do...';
                        break;
                }

                // Show input box with appropriate placeholder
                prompt = await vscode.window.showInputBox({
                    placeHolder: inputPlaceholder,
                    prompt: selectedText ? 'Selected code will be included in the context' : undefined
                });

                if (!prompt) return;

                // Show progress
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Smile AI is ${this.currentMode === InteractionMode.Ask ? 'thinking' : 'working'}...`,
                    cancellable: false
                }, async (progress) => {
                    try {
                        // Prepare context
                        const context = {
                            mode: this.currentMode,
                            selectedText,
                            filePath: editor?.document.uri.fsPath,
                            prompt
                        };

                        // Get AI response
                        const response = await this.aiEngine.generateResponse({
                            messages: [
                                { role: 'system', content: this.getSystemPromptForMode(this.currentMode) },
                                { role: 'user', content: prompt }
                            ],
                            maxTokens: 1000,
                            temperature: 0.7
                        });

                        if (response.codeChanges) {
                            // Apply code changes
                            const workspaceEdit = new vscode.WorkspaceEdit();
                            for (const change of response.codeChanges) {
                                // Apply each change
                                if (change.uri && change.range && change.newText) {
                                    workspaceEdit.replace(vscode.Uri.parse(change.uri), new vscode.Range(
                                        new vscode.Position(change.range.start.line, change.range.start.character),
                                        new vscode.Position(change.range.end.line, change.range.end.character)
                                    ), change.newText);
                                }
                            }
                            await vscode.workspace.applyEdit(workspaceEdit);
                        }

                        // Handle response based on mode
                        switch (this.currentMode) {
                            case InteractionMode.Ask:
                                // Show response in new editor
                                const doc = await vscode.workspace.openTextDocument({
                                    content: response.message,
                                    language: 'markdown'
                                });
                                await vscode.window.showTextDocument(doc, { preview: true });
                                break;

                            case InteractionMode.Edit:
                                // Apply edits if confirmed
                                const edit = response.edit;
                                if (edit) {
                                    const confirmEdit = await vscode.window.showInformationMessage(
                                        'Review and apply the suggested changes?',
                                        'Apply',
                                        'Show Changes',
                                        'Cancel'
                                    );

                                    if (confirmEdit === 'Apply') {
                                        // Apply edits
                                        await vscode.workspace.applyEdit(edit);
                                    } else if (confirmEdit === 'Show Changes') {
                                        // Show diff
                                        const diffDoc = await vscode.workspace.openTextDocument({
                                            content: response.message,
                                            language: 'markdown'
                                        });
                                        await vscode.window.showTextDocument(diffDoc, { preview: true });
                                    }
                                }
                                break;

                            case InteractionMode.Agent:
                                // Show progress and updates
                                const channel = vscode.window.createOutputChannel('Smile AI Agent');
                                channel.show();
                                channel.appendLine('Agent Task Started...');
                                channel.appendLine(`Task: ${prompt}`);
                                channel.appendLine('---');
                                channel.appendLine(response.message);
                                break;
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
                    }
                });
            })
        );
    }

    private updateStatusBar() {
        const icons = {
            [InteractionMode.Ask]: '$(question)',
            [InteractionMode.Edit]: '$(edit)',
            [InteractionMode.Agent]: '$(rocket)'
        };
        this.statusBarItem.text = `${icons[this.currentMode]} Smile AI: ${this.currentMode.toUpperCase()}`;
        this.statusBarItem.show();
    }

    private getSystemPromptForMode(mode: InteractionMode): string {
        switch (mode) {
            case InteractionMode.Ask:
                return `You are a helpful coding assistant. Answer questions clearly and concisely.
                       Provide code examples when relevant. Format your responses in markdown.`;
            
            case InteractionMode.Edit:
                return `You are a code editing assistant. Suggest specific code changes and improvements.
                       Explain your changes clearly. Format your responses in markdown and include code blocks.`;
            
            case InteractionMode.Agent:
                return `You are an autonomous coding agent. You can analyze code, suggest improvements,
                       and make changes across multiple files. Explain your actions clearly and wait for user
                       confirmation before making changes. Format your responses in markdown.`;
        }
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

        // Then, select a priority
        const priorityLabels = ['Medium (Default)', 'High', 'Low', 'None'];
        const selectedPriorityLabel = await vscode.window.showQuickPick(priorityLabels, {
            placeHolder: 'Select a priority for this improvement note'
        });

        let priority: 'high' | 'medium' | 'low' | 'none' = 'medium';
        if (selectedPriorityLabel === 'High') {
            priority = 'high';
        } else if (selectedPriorityLabel === 'Low') {
            priority = 'low';
        } else if (selectedPriorityLabel === 'None') {
            priority = 'none';
        }

        try {
            await this.improvementManager.addNote(description, noteContext, false, priority);
            vscode.window.showInformationMessage('Improvement note added.');
        } catch (error: any) {
            console.error('Error adding improvement note:', error);
            vscode.window.showErrorMessage(`Failed to note improvement: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // ---------------------------------------

    // --- Implement Semantic Search Logic --- 
    private async semanticCodeSearch() {
        if (!this.aiEngine) {
             vscode.window.showErrorMessage('Cannot perform semantic search: AI Engine not available.');
            return;
        }
        // Check if embeddings are enabled in settings
        const config = vscode.workspace.getConfiguration('smile-ai');
        const embeddingsEnabled = config.get<boolean>('indexing.generateEmbeddings', false);
        if (!embeddingsEnabled) {
            vscode.window.showWarningMessage('Semantic search requires embedding generation to be enabled in Smile AI settings (smile-ai.indexing.generateEmbeddings). Please enable it and re-index the codebase.');
            return;
        }

        const searchQuery = await vscode.window.showInputBox({ 
            prompt: 'Enter semantic search query:',
            placeHolder: 'e.g., function to handle user login, class for database connection'
        });

        if (!searchQuery) {
            return; // User cancelled
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Smile AI: Semantic Search",
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: 'Generating embedding for query...' });
                this.showLoading('Searching...');

                // 1. Generate embedding for the search query
                const queryEmbedding = await this.aiEngine!.generateEmbeddings(searchQuery);

                progress.report({ message: 'Searching index for similar symbols...' });
                
                // 2. Find similar symbols in the index
                const topNResults = 10; // Show top 10 results
                const minSimilarity = 0.7; // Adjust threshold as needed
                const similarSymbols = this.codebaseIndexer.findSimilarSymbols(queryEmbedding, topNResults, minSimilarity);

                this.showReady(); // Update status bar

                // 3. Display results using the new Webview panel
                if (similarSymbols.length === 0) {
                    vscode.window.showInformationMessage(`No similar code found for "${searchQuery}". Try rephrasing or check if indexing included embeddings.`);
                    return;
                }

                await this.showSemanticSearchResultsPanel(similarSymbols, searchQuery);

            } catch (error) {
                this.showError('Search Failed');
                console.error('Error during semantic search:', error);
                vscode.window.showErrorMessage(`Semantic search failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
    // ---------------------------------------

    public dispose() {
        this.statusBarItem.dispose();
        if (this.codebaseIndexer) {
            this.codebaseIndexer.dispose();
        }
    }

    // --- Semantic Search Panel Implementation --- 

    /**
     * Displays semantic search results in a dedicated Webview panel.
     *
     * @param results Array of search results with symbols and scores.
     * @param query The original search query.
     */
    private async showSemanticSearchResultsPanel(
        results: { symbol: SymbolInfo; score: number }[], 
        query: string
    ) {
        const panel = vscode.window.createWebviewPanel(
            'semanticSearchResults', // Identifies the type of the webview. Used internally
            `Semantic Search Results for "${query}"`, // Title of the panel displayed to the user
            vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
            {
                enableScripts: true, // Allow scripts to run in the webview
                localResourceRoots: [] // Keep empty if not loading local files
            }
        );

        panel.webview.html = this.generateSemanticSearchHtml(results, query);

        // Handle messages from the webview (e.g., clicking a result)
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'navigateToLocation':
                        const { filePath, line, char } = message;
                        if (filePath && line !== undefined && char !== undefined) {
                             try {
                                const targetUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, filePath);
                                const targetPosition = new vscode.Position(line - 1, char); // Convert to 0-based index
                                const targetRange = new vscode.Range(targetPosition, targetPosition);
                                await vscode.window.showTextDocument(targetUri, { selection: targetRange, viewColumn: vscode.ViewColumn.One });
                            } catch (error) {
                                vscode.window.showErrorMessage(`Failed to navigate to location: ${error}`);
                            }
                        }
                        return;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    /**
     * Generates the HTML content for the semantic search results webview.
     */
    private generateSemanticSearchHtml(results: { symbol: SymbolInfo; score: number }[], query: string): string {
        // Basic styling using VS Code theme variables
        const styles = `
            <style>
                body {
                    font-family: var(--vscode-font-family, sans-serif);
                    font-size: var(--vscode-font-size, 13px);
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 15px;
                }
                h1 {
                    color: var(--vscode-textLink-foreground);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 10px;
                    margin-bottom: 15px;
                    font-size: 1.5em;
                }
                 h1 small {
                     font-size: 0.8em;
                     color: var(--vscode-descriptionForeground);
                 }
                ul {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                li {
                    padding: 10px;
                    margin-bottom: 8px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background-color 0.2s ease;
                }
                li:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .symbol-name {
                    font-weight: bold;
                    color: var(--vscode-symbolIcon-methodForeground); /* Adjust based on symbol type later */
                    margin-right: 10px;
                }
                .symbol-kind {
                     color: var(--vscode-symbolIcon-keywordForeground);
                     font-size: 0.9em;
                     margin-right: 10px;
                 }
                .file-path {
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.9em;
                }
                .score {
                    float: right;
                    color: var(--vscode-list-highlightForeground);
                    font-weight: bold;
                }
            </style>
        `;

        // Generate list items for each result
        const listItems = results.map(result => {
            const relativePath = vscode.workspace.asRelativePath(result.symbol.location.uri);
            // Simple kind mapping for now
            const kindName = ts.SyntaxKind[result.symbol.kind]?.replace('Declaration', '') || 'Symbol';
            return `
                <li 
                    data-command="navigateToLocation"
                    data-filepath="${this.escapeHtml(vscode.workspace.asRelativePath(result.symbol.location.uri))}" 
                    data-line="${result.symbol.startLine}" 
                    data-char="${result.symbol.startChar}"
                    title="Navigate to ${this.escapeHtml(relativePath)}:${result.symbol.startLine}"
                >
                    <span class="score">${result.score.toFixed(3)}</span>
                    <span class="symbol-kind">[${this.escapeHtml(kindName)}]</span>
                    <span class="symbol-name">${this.escapeHtml(result.symbol.name)}</span>
                    <br>
                    <span class="file-path">${this.escapeHtml(relativePath)}:${result.symbol.startLine}</span>
                </li>
            `;
        }).join('\n');

        // Basic script to handle clicks and post messages
        const script = `
            <script>
                const vscode = acquireVsCodeApi();
                document.querySelectorAll('li[data-command="navigateToLocation"]\').forEach(item => {
                    item.addEventListener('click', () => {
                        const filePath = item.getAttribute('data-filepath');
                        const line = parseInt(item.getAttribute('data-line'));
                        const char = parseInt(item.getAttribute('data-char'));
                        if (filePath && !isNaN(line) && !isNaN(char)) {
                            vscode.postMessage({
                                command: 'navigateToLocation',
                                filePath: filePath,
                                line: line,
                                char: char
                            });
                        }
                    });
                });
            </script>
        `;

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Semantic Search Results</title>
                ${styles}
            </head>
            <body>
                <h1>Semantic Search Results <small>for "${this.escapeHtml(query)}"</small></h1>
                ${results.length > 0 ? `<ul>${listItems}</ul>` : '<p>No results found.</p>'}
                ${script}
            </body>
            </html>`;
    }

     // Helper to escape HTML characters
    private escapeHtml(str: string): string {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    // ---------------------------------------
}

// Extension aktivasyon
let extension: SmileAIExtension | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Smile AI aktif!');
    try {
        extension = new SmileAIExtension(context);
        context.subscriptions.push(extension);
    } catch (error) {
        console.error('Failed to activate extension:', error);
        vscode.window.showErrorMessage('Failed to activate Smile AI extension. Please check the logs for details.');
    }
}

// Extension deaktivasyon
export function deactivate() {
    if (extension) {
        extension.dispose();
    }
    console.log('Smile AI deaktif!');
    extension = undefined;
} 