import * as vscode from 'vscode';
import { LlamaService } from './llamaService';
import { AgentTask, TaskResult, ModelConfig } from './types';

export class AgentService {
    private llamaService: LlamaService;
    private disposables: vscode.Disposable[] = [];
    private statusBarItem: vscode.StatusBarItem;

    constructor(config: ModelConfig) {
        this.llamaService = new LlamaService(config);
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.statusBarItem.text = "$(hubot) Smile AI";
        this.statusBarItem.tooltip = "Smile AI Agent";
        this.statusBarItem.show();
    }

    public async initialize(): Promise<void> {
        try {
            await this.llamaService.initialize();
            this.registerCommands();
            this.statusBarItem.text = "$(check) Smile AI";
        } catch (error) {
            this.statusBarItem.text = "$(error) Smile AI";
            throw error;
        }
    }

    private registerCommands(): void {
        // Register all agent-related commands
        this.disposables.push(
            vscode.commands.registerCommand('smile-ai.codeCompletion', () => this.handleCodeCompletion()),
            vscode.commands.registerCommand('smile-ai.codeAnalysis', () => this.handleCodeAnalysis()),
            vscode.commands.registerCommand('smile-ai.generateCode', () => this.handleCodeGeneration()),
            vscode.commands.registerCommand('smile-ai.generateDocs', () => this.handleDocGeneration()),
            vscode.commands.registerCommand('smile-ai.generateTests', () => this.handleTestGeneration()),
            vscode.commands.registerCommand('smile-ai.refactorCode', () => this.handleRefactoring()),
            vscode.commands.registerCommand('smile-ai.fixBug', () => this.handleBugFix())
        );
    }

    private async handleCodeCompletion(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        const context = this.getCodeContext(document, position);
        
        const task: AgentTask = {
            type: 'code_completion',
            input: document.getText(editor.selection),
            context,
            constraints: {
                language: document.languageId,
                maxLength: 1000
            }
        };

        await this.executeTask(task);
    }

    private async handleCodeAnalysis(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const task: AgentTask = {
            type: 'code_analysis',
            input: 'Analyze the following code for quality, potential issues, and improvements',
            context: document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        await this.executeTask(task);
    }

    private async handleCodeGeneration(): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: 'Ne tür bir kod üretmek istersiniz?',
            placeHolder: 'Örn: Bir REST API endpoint\'i oluştur'
        });

        if (!input) return;

        const task: AgentTask = {
            type: 'code_generation',
            input,
            constraints: {
                language: await this.promptForLanguage()
            }
        };

        await this.executeTask(task);
    }

    private async handleDocGeneration(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const task: AgentTask = {
            type: 'documentation',
            input: 'Generate comprehensive documentation for the following code',
            context: document.getText(editor.selection) || document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        await this.executeTask(task);
    }

    private async handleTestGeneration(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const task: AgentTask = {
            type: 'test_generation',
            input: 'Generate comprehensive test cases for the following code',
            context: document.getText(editor.selection) || document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        await this.executeTask(task);
    }

    private async handleRefactoring(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const task: AgentTask = {
            type: 'refactoring',
            input: 'Refactor the following code to improve its quality and maintainability',
            context: document.getText(editor.selection) || document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        await this.executeTask(task);
    }

    private async handleBugFix(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const description = await vscode.window.showInputBox({
            prompt: 'Hatayı açıklayın',
            placeHolder: 'Örn: Fonksiyon beklendiği gibi çalışmıyor'
        });

        if (!description) return;

        const task: AgentTask = {
            type: 'bug_fix',
            input: description,
            context: document.getText(editor.selection) || document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        await this.executeTask(task);
    }

    private getCodeContext(document: vscode.TextDocument, position: vscode.Position): string {
        // Get relevant code context around the cursor position
        const startLine = Math.max(0, position.line - 10);
        const endLine = Math.min(document.lineCount, position.line + 10);
        
        return document.getText(new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine, 0)
        ));
    }

    private async promptForLanguage(): Promise<string> {
        const languages = ['typescript', 'javascript', 'python'];
        const selected = await vscode.window.showQuickPick(languages, {
            placeHolder: 'Programlama dilini seçin'
        });
        return selected || 'typescript';
    }

    private async executeTask(task: AgentTask): Promise<void> {
        this.statusBarItem.text = "$(sync~spin) Smile AI";
        
        try {
            const result = await this.llamaService.executeTask(task);
            await this.handleTaskResult(result);
        } catch (error) {
            vscode.window.showErrorMessage(
                error instanceof Error ? error.message : 'Görev yürütülürken bir hata oluştu'
            );
        } finally {
            this.statusBarItem.text = "$(hubot) Smile AI";
        }
    }

    private async handleTaskResult(result: TaskResult): Promise<void> {
        if (!result.success) {
            vscode.window.showErrorMessage(`Hata: ${result.error}`);
            return;
        }

        // Create or show output channel
        const channel = vscode.window.createOutputChannel('Smile AI');
        channel.clear();
        
        // Add metadata
        if (result.metadata) {
            channel.appendLine('--- Metadata ---');
            channel.appendLine(`Model: ${result.metadata.modelName}`);
            channel.appendLine(`Execution Time: ${result.metadata.executionTime}ms`);
            channel.appendLine(`Tokens Used: ${result.metadata.tokensUsed}`);
            channel.appendLine('---------------\n');
        }

        // Add result
        channel.appendLine(result.output);
        channel.show();
    }

    public dispose(): void {
        this.llamaService.dispose();
        this.statusBarItem.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
} 