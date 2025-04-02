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

// Export the main extension class
export class SmileAIExtension {
    private context: vscode.ExtensionContext;
    private aiEngine: AIEngine;
    private fileAnalyzer: FileAnalyzer;
    private codeAnalyzer: CodeAnalyzer;
    private codebaseIndexer: CodebaseIndexer;
    private statusBarItem: vscode.StatusBarItem;
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
        this.codebaseIndexer = CodebaseIndexer.getInstance();
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusBarItem.show();

        // Initialize managers and providers
        ImprovementManager.initialize(this.context);
        
        this.taskExecutors = new Map();
        
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
        if (this.codebaseIndexer) {
            this.codebaseIndexer.dispose();
        }
    }
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
