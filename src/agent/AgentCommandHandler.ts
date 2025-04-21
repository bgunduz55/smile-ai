import * as vscode from 'vscode';
import { AgentEngine } from './AgentEngine';
import { AIEngine } from '../ai-engine/AIEngine';
import { TaskManager } from './TaskManager';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';

/**
 * Handler for agent-related commands
 */
export class AgentCommandHandler {
    private agentEngine: AgentEngine;
    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;
    private isProcessing: boolean = false;

    constructor(
        aiEngine: AIEngine,
        taskManager: TaskManager,
        codebaseIndexer: CodebaseIndexer
    ) {
        this.agentEngine = AgentEngine.getInstance(aiEngine, taskManager, codebaseIndexer);
        this.outputChannel = vscode.window.createOutputChannel('Smile AI Agent');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = '$(rocket) Smile AI';
        this.statusBarItem.tooltip = 'Smile AI Agent';
        this.statusBarItem.command = 'smileai.runAgentCommand';
        this.statusBarItem.show();
    }

    /**
     * Register all agent-related commands
     */
    public registerCommands(context: vscode.ExtensionContext): void {
        const runAgentCommand = vscode.commands.registerCommand('smileai.runAgentCommand', async () => {
            await this.runAgentCommand();
        });

        const runAgentWithSelectionCommand = vscode.commands.registerCommand('smileai.runAgentWithSelection', async () => {
            await this.runAgentWithSelection();
        });

        context.subscriptions.push(runAgentCommand);
        context.subscriptions.push(runAgentWithSelectionCommand);
    }

    /**
     * Run agent command with input from the user
     */
    private async runAgentCommand(): Promise<void> {
        if (this.isProcessing) {
            vscode.window.showInformationMessage('Agent is already processing a request. Please wait.');
            return;
        }

        const request = await vscode.window.showInputBox({
            prompt: 'What would you like the AI agent to do?',
            placeHolder: 'e.g., "Create a new React component" or "Fix the bugs in this file"'
        });

        if (!request) {
            return;
        }

        await this.processAgentRequest(request);
    }

    /**
     * Run agent command with the current selection as context
     */
    private async runAgentWithSelection(): Promise<void> {
        if (this.isProcessing) {
            vscode.window.showInformationMessage('Agent is already processing a request. Please wait.');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (!selectedText) {
            vscode.window.showErrorMessage('No text selected');
            return;
        }

        const request = await vscode.window.showInputBox({
            prompt: 'What would you like the AI agent to do with the selected code?',
            placeHolder: 'e.g., "Refactor this code" or "Add error handling"'
        });

        if (!request) {
            return;
        }

        const fullRequest = `${request}\n\nSelected code:\n\`\`\`\n${selectedText}\n\`\`\``;
        await this.processAgentRequest(fullRequest);
    }

    /**
     * Process an agent request with progress indication
     */
    private async processAgentRequest(request: string): Promise<void> {
        this.isProcessing = true;
        this.statusBarItem.text = '$(sync~spin) Smile AI Working...';

        this.outputChannel.clear();
        this.outputChannel.appendLine(`Request: ${request}`);
        this.outputChannel.appendLine('---');
        this.outputChannel.show();

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Smile AI Agent',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Processing your request...' });

                    const result = await this.agentEngine.processRequest(request);

                    this.outputChannel.appendLine(result);
                    this.outputChannel.appendLine('---');

                    // Check if there are file operations to show
                    if (result.includes('Modified files:')) {
                        const modifiedFilesMatch = result.match(/Modified files:\n((?:- .*\n)*)/);
                        if (modifiedFilesMatch && modifiedFilesMatch[1]) {
                            const modifiedFiles = modifiedFilesMatch[1]
                                .split('\n')
                                .filter(line => line.startsWith('- '))
                                .map(line => line.substring(2).trim());

                            if (modifiedFiles.length > 0) {
                                const openFile = await vscode.window.showInformationMessage(
                                    'Agent completed with file modifications',
                                    'Open Modified Files'
                                );

                                if (openFile === 'Open Modified Files') {
                                    // Open the first file
                                    if (modifiedFiles.length > 0) {
                                        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                                        if (workspaceRoot) {
                                            const firstFilePath = modifiedFiles[0];
                                            try {
                                                const document = await vscode.workspace.openTextDocument(
                                                    vscode.Uri.file(firstFilePath)
                                                );
                                                await vscode.window.showTextDocument(document);
                                            } catch (error) {
                                                console.error(`Error opening file ${firstFilePath}:`, error);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            );
        } catch (error) {
            this.outputChannel.appendLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
            vscode.window.showErrorMessage(`Agent error: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.isProcessing = false;
            this.statusBarItem.text = '$(rocket) Smile AI';
        }
    }
} 