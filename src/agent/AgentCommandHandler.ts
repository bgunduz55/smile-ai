import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AgentEngine } from './AgentEngine';
import { AIEngine } from '../ai-engine/AIEngine';
import { TaskManager } from './TaskManager';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Handler for agent-related commands
 */
export class AgentCommandHandler {
    private static instance: AgentCommandHandler;
    private agentEngine: AgentEngine;
    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;
    private isProcessing: boolean = false;

    /**
     * Get the singleton instance
     */
    public static getInstance(): AgentCommandHandler {
        if (!AgentCommandHandler.instance) {
            throw new Error('AgentCommandHandler not initialized. Call initialize() first.');
        }
        return AgentCommandHandler.instance;
    }

    /**
     * Initialize the singleton instance
     */
    public static initialize(
        aiEngine: AIEngine,
        taskManager: TaskManager,
        codebaseIndexer: CodebaseIndexer
    ): AgentCommandHandler {
        if (!AgentCommandHandler.instance) {
            AgentCommandHandler.instance = new AgentCommandHandler(aiEngine, taskManager, codebaseIndexer);
        }
        return AgentCommandHandler.instance;
    }

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
     * Execute an agent command with progress tracking and cancellation support
     */
    public async executeCommand(request: string, options?: {
        onProgress?: (progress: string) => void;
        checkCancellation?: () => boolean;
    }): Promise<{ success: boolean; message: string }> {
        this.isProcessing = true;
        this.outputChannel.clear();
        this.outputChannel.appendLine(`Request: ${request}`);
        this.outputChannel.appendLine('---');
        this.outputChannel.show();

        try {
            // Check for cancellation before starting
            if (options?.checkCancellation && options.checkCancellation()) {
                return { success: false, message: 'Operation cancelled before starting' };
            }

            // Set up progress reporting
            const reportProgress = (message: string) => {
                this.outputChannel.appendLine(message);
                if (options?.onProgress) {
                    options.onProgress(message);
                }
            };

            // Process the request
            reportProgress('Processing request...');
            
            // Periodically check for cancellation during processing
            const result = await this.agentEngine.processRequest(request);
            
            reportProgress('Agent operation completed');
            this.outputChannel.appendLine(result);
            
            return { success: true, message: result };
        } catch (error) {
            const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
            this.outputChannel.appendLine(errorMessage);
            return { success: false, message: errorMessage };
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Read a file from the workspace
     */
    public async readFile(filePath: string): Promise<string> {
        try {
            // Determine if path is absolute or relative
            const absolutePath = this.resolveWorkspacePath(filePath);
            
            // Read the file
            const content = await fs.readFile(absolutePath, 'utf-8');
            return content;
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Write content to a file in the workspace
     */
    public async writeFile(filePath: string, content: string, append: boolean = false): Promise<void> {
        try {
            // Determine if path is absolute or relative
            const absolutePath = this.resolveWorkspacePath(filePath);
            
            // Ensure the directory exists
            const directory = path.dirname(absolutePath);
            await fs.mkdir(directory, { recursive: true });
            
            // Write the file
            if (append) {
                await fs.appendFile(absolutePath, content, 'utf-8');
            } else {
                await fs.writeFile(absolutePath, content, 'utf-8');
            }
        } catch (error) {
            console.error(`Error writing file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Run a shell command
     */
    public async runCommand(command: string, cwd?: string): Promise<string> {
        try {
            // Determine working directory
            let workingDirectory = cwd;
            if (!workingDirectory) {
                workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            } else {
                workingDirectory = this.resolveWorkspacePath(workingDirectory);
            }
            
            // Execute the command
            const { stdout, stderr } = await execPromise(command, { cwd: workingDirectory });
            
            // Return combined output
            return stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
        } catch (error) {
            if (error instanceof Error) {
                const execError = error as any;
                // Include stderr output in the error
                if (execError.stderr) {
                    return `Error: ${execError.message}\nSTDERR:\n${execError.stderr}`;
                }
                return `Error: ${execError.message}`;
            }
            return `Error: ${String(error)}`;
        }
    }

    /**
     * List the contents of a directory
     */
    public async listDirectory(dirPath: string): Promise<{ files: string[]; directories: string[] }> {
        try {
            // Determine if path is absolute or relative
            const absolutePath = this.resolveWorkspacePath(dirPath);
            
            // Read the directory
            const entries = await fs.readdir(absolutePath, { withFileTypes: true });
            
            // Separate files and directories
            const files: string[] = [];
            const directories: string[] = [];
            
            for (const entry of entries) {
                const entryPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    directories.push(entryPath);
                } else {
                    files.push(entryPath);
                }
            }
            
            return { files, directories };
        } catch (error) {
            console.error(`Error listing directory ${dirPath}:`, error);
            throw error;
        }
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

    /**
     * Resolve a path to an absolute path in the workspace
     */
    private resolveWorkspacePath(inputPath: string): string {
        // If already absolute, return as is
        if (path.isAbsolute(inputPath)) {
            return inputPath;
        }
        
        // Get workspace root
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('No workspace folder found');
        }
        
        // Join with workspace root
        return path.join(workspaceRoot, inputPath);
    }
} 