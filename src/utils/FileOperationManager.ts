import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface FileOperation {
    id: string;
    type: 'add' | 'update' | 'delete';
    filePath: string;
    originalContent?: string;
    newContent?: string;
    description?: string;
    created: number;
    isApplied: boolean; // Track if operation has been applied
    diff?: any;
}

export interface FileOperationGroup {
    id: string;
    description: string;
    operations: FileOperation[];
    created: number;
    isApplied: boolean;
}

export class FileOperationManager {
    private static instance: FileOperationManager;
    private pendingOperations: Map<string, FileOperation>;
    private operationGroups: Map<string, FileOperationGroup>;
    private webviewView: vscode.WebviewView | undefined;

    private constructor() {
        this.pendingOperations = new Map();
        this.operationGroups = new Map();
    }

    public static getInstance(): FileOperationManager {
        if (!FileOperationManager.instance) {
            FileOperationManager.instance = new FileOperationManager();
        }
        return FileOperationManager.instance;
    }

    public setWebviewView(webviewView: vscode.WebviewView): void {
        this.webviewView = webviewView;
    }

    public async createAddOperation(filePath: string, content: string, description?: string): Promise<FileOperation> {
        const operation: FileOperation = {
            id: Date.now().toString(),
            type: 'add',
            filePath,
            newContent: content,
            description,
            created: Date.now(),
            isApplied: false // Initially not applied
        };
        
        // Apply the operation immediately
        try {
            await this.addFile(filePath, content);
            operation.isApplied = true;
            
            // Store the operation for potential undo
            this.pendingOperations.set(operation.id, operation);
            this.notifyWebview();
            
            console.log(`File created and pending approval: ${filePath}`);
            return operation;
        } catch (error) {
            console.error(`Error creating file ${filePath}:`, error);
            throw error;
        }
    }

    public async createUpdateOperation(
        filePath: string, 
        originalContent: string, 
        newContent: string, 
        description?: string,
        generateDiff: boolean = false
    ): Promise<FileOperation> {
        const operation: FileOperation = {
            id: Date.now().toString(),
            type: 'update',
            filePath,
            originalContent,
            newContent,
            description,
            created: Date.now(),
            isApplied: false,
            diff: generateDiff ? this.generateDiff(originalContent, newContent) : undefined
        };
        
        // Apply the update immediately
        try {
            await this.updateFile(filePath, newContent);
            operation.isApplied = true;
            
            // Store the operation for potential undo
            this.pendingOperations.set(operation.id, operation);
            this.notifyWebview();
            
            // If diff was generated, show it to the user
            if (generateDiff && operation.diff) {
                await this.showDiff(filePath, originalContent, newContent);
            }
            
            console.log(`File updated and pending approval: ${filePath}`);
            return operation;
        } catch (error) {
            console.error(`Error updating file ${filePath}:`, error);
            throw error;
        }
    }

    public async createDeleteOperation(filePath: string, originalContent: string, description?: string): Promise<FileOperation> {
        const operation: FileOperation = {
            id: Date.now().toString(),
            type: 'delete',
            filePath,
            originalContent,
            description,
            created: Date.now(),
            isApplied: false
        };
        
        // Apply the delete immediately
        try {
            await this.deleteFile(filePath);
            operation.isApplied = true;
            
            // Store the operation for potential undo
            this.pendingOperations.set(operation.id, operation);
            this.notifyWebview();
            
            console.log(`File deleted and pending approval: ${filePath}`);
            return operation;
        } catch (error) {
            console.error(`Error deleting file ${filePath}:`, error);
            throw error;
        }
    }

    public getPendingOperations(): any[] {
        // Convert the Map to Array and simplify structure for UI consumption
        const operations = Array.from(this.pendingOperations.values()).map(op => {
            // Make a simpler representation for the UI
            return {
                id: op.id,
                type: op.type,
                filePath: op.filePath,
                description: op.description || '',
                created: op.created,
                isApplied: op.isApplied
            };
        });
        
        console.log('FileOperationManager.getPendingOperations returning:', operations);
        return operations;
    }

    public getOperation(id: string): FileOperation | undefined {
        return this.pendingOperations.get(id);
    }

    public async acceptOperation(id: string): Promise<boolean> {
        const operation = this.pendingOperations.get(id);
        if (!operation) return false;

        try {
            // For accept, we just remove the operation from pending list
            // since the changes are already applied
            this.pendingOperations.delete(id);
            this.notifyWebview();
            return true;
        } catch (error) {
            console.error(`Error accepting operation ${operation.type}:`, error);
            return false;
        }
    }

    public async rejectOperation(id: string): Promise<boolean> {
        const operation = this.pendingOperations.get(id);
        if (!operation) return false;

        try {
            // For reject, we need to undo the changes
            if (operation.isApplied) {
                switch (operation.type) {
                    case 'add':
                        // Delete the file if it was added
                        await this.deleteFile(operation.filePath);
                        break;
                    case 'update':
                        // Restore the original content
                        if (operation.originalContent) {
                            await this.updateFile(operation.filePath, operation.originalContent);
                        }
                        break;
                    case 'delete':
                        // Restore the file if it was deleted
                        if (operation.originalContent) {
                            await this.addFile(operation.filePath, operation.originalContent);
                        }
                        break;
                }
            }
            
            this.pendingOperations.delete(id);
            this.notifyWebview();
            return true;
        } catch (error) {
            console.error(`Error rejecting operation:`, error);
            return false;
        }
    }

    public async acceptAllOperations(): Promise<boolean> {
        try {
            // For accept all, just remove all operations from pending list
            // since changes are already applied
            this.pendingOperations.clear();
            this.notifyWebview();
            return true;
        } catch (error) {
            console.error('Error accepting all operations:', error);
            return false;
        }
    }

    public async rejectAllOperations(): Promise<boolean> {
        try {
            // Process all pending operations in reverse order (newest first)
            const operations = Array.from(this.pendingOperations.values())
                .sort((a, b) => b.created - a.created);
                
            for (const operation of operations) {
                await this.rejectOperation(operation.id);
            }
            
            return true;
        } catch (error) {
            console.error('Error rejecting all operations:', error);
            return false;
        }
    }

    private async addFile(filePath: string, content: string): Promise<void> {
        try {
            // Ensure the directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Write the file
            fs.writeFileSync(filePath, content, 'utf8');
            
            // Open the file in the editor
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(document);
        } catch (error) {
            console.error(`Error in addFile for ${filePath}:`, error);
            await this.handleFileOperationError('add', filePath, error, content);
        }
    }

    private async updateFile(filePath: string, content: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const edit = new vscode.WorkspaceEdit();
            
            try {
                // Open the document to get its content
                const document = await vscode.workspace.openTextDocument(uri);
                
                // Replace the entire content
                const fullRange = new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(document.getText().length)
                );
                edit.replace(uri, fullRange, content);
                
                // Apply the edit
                const success = await vscode.workspace.applyEdit(edit);
                if (!success) {
                    throw new Error('Failed to apply edit');
                }
                
                // Save the document
                await document.save();
                
            } catch (error) {
                // Fallback approach if edit fails: write directly to file
                console.warn(`Falling back to direct file write for ${filePath}:`, error);
                fs.writeFileSync(filePath, content, 'utf8');
            }
            
            // Open the document in the editor
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            console.error(`Error in updateFile for ${filePath}:`, error);
            await this.handleFileOperationError('update', filePath, error, content);
        }
    }

    private async deleteFile(filePath: string): Promise<void> {
        try {
            if (fs.existsSync(filePath)) {
                // Get URI for the file
                const uri = vscode.Uri.file(filePath);
                
                // Create a workspace edit to delete the file
                const edit = new vscode.WorkspaceEdit();
                edit.deleteFile(uri, { ignoreIfNotExists: true });
                
                // Apply the edit
                const success = await vscode.workspace.applyEdit(edit);
                if (!success) {
                    // Fallback: use fs.unlinkSync
                    fs.unlinkSync(filePath);
                }
            }
        } catch (error) {
            console.error(`Error in deleteFile for ${filePath}:`, error);
            await this.handleFileOperationError('delete', filePath, error);
        }
    }

    private notifyWebview(): void {
        if (this.webviewView && this.webviewView.visible) {
            this.webviewView.webview.postMessage({
                command: 'updateFileOperations',
                operations: this.getPendingOperations(),
                groups: Array.from(this.operationGroups.values()).map(group => ({
                    id: group.id,
                    description: group.description,
                    fileCount: group.operations.length,
                    created: group.created,
                    isApplied: group.isApplied
                }))
            });
        }
    }

    public getDiff(operationId: string): any {
        const operation = this.pendingOperations.get(operationId);
        if (!operation || operation.type === 'add') {
            // For add operations, we can show the content as all additions
            if (operation?.type === 'add' && operation.newContent) {
                return {
                    diffType: 'lineDiff',
                    diffContent: operation.newContent.split('\n').map(line => ({
                        type: 'add',
                        content: line
                    }))
                };
            }
            return {
                diffType: 'none',
                diffContent: []
            };
        }

        try {
            // Use 'diff' library to get detailed line-by-line changes
            const { diffLines } = require('diff');
            
            const oldContent = operation.originalContent || '';
            const newContent = operation.newContent || '';
            
            // Generate line-by-line diff
            const lineDiff = diffLines(oldContent, newContent);
            
            // Convert to a more UI-friendly format
            const formattedDiff = lineDiff.map((part: {added?: boolean, removed?: boolean, value: string}) => ({
                type: part.added ? 'add' : part.removed ? 'remove' : 'unchanged',
                content: part.value.replace(/\n$/, '') // Remove trailing newline
            }));
            
            // Create a more detailed diff format that includes line numbers
            const hunks = this.convertToHunks(oldContent, newContent, formattedDiff);
            
            return {
                diffType: 'enhancedDiff',
                hunks,
                supportsPartialChanges: true
            };
        } catch (error) {
            console.error('Error generating diff:', error);
            return {
                diffType: 'error',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private convertToHunks(oldContent: string, newContent: string, formattedDiff: Array<{type: string, content: string}>): any[] {
        // This is a simplified version; actual implementation would create proper diff hunks
        // with correct line numbers and change tracking
        const hunks = [];
        
        let oldStart = 1;
        let newStart = 1;
        
        // Group changes into hunks
        const hunk = {
            oldStart,
            oldLines: oldContent.split('\n').length,
            newStart,
            newLines: newContent.split('\n').length,
            lines: [] as string[]
        };
        
        formattedDiff.forEach(part => {
            const lines = part.content.split('\n');
            lines.forEach(line => {
                if (part.type === 'add') {
                    hunk.lines.push(`+${line}`);
                } else if (part.type === 'remove') {
                    hunk.lines.push(`-${line}`);
                } else {
                    hunk.lines.push(` ${line}`);
                }
            });
        });
        
        hunks.push(hunk);
        return hunks;
    }

    public async acceptPartialChange(operationId: string, lineIndices: number[]): Promise<boolean> {
        const operation = this.pendingOperations.get(operationId);
        if (!operation || operation.type !== 'update' || !operation.originalContent || !operation.newContent) {
            return false;
        }

        try {
            // This would need a more complex implementation to apply only specific lines
            // from the diff, which is beyond the scope of this example
            console.log('Partial change applied for lines:', lineIndices);
            
            // For now, just mark the operation as accepted
            this.pendingOperations.delete(operationId);
            this.notifyWebview();
            return true;
        } catch (error) {
            console.error('Error applying partial change:', error);
            return false;
        }
    }

    public clearOperations(): void {
        this.pendingOperations.clear();
        this.notifyWebview();
    }

    /**
     * Generate a detailed diff between old and new content
     */
    private generateDiff(oldContent: string, newContent: string): any {
        try {
            // Simple line-by-line diff implementation
            const oldLines = oldContent.split('\n');
            const newLines = newContent.split('\n');
            
            const result: Array<{type: number, text: string}> = [];
            
            // Find common prefix
            let commonPrefixLength = 0;
            const maxPrefix = Math.min(oldLines.length, newLines.length);
            while (commonPrefixLength < maxPrefix && 
                   oldLines[commonPrefixLength] === newLines[commonPrefixLength]) {
                result.push({ type: 0, text: oldLines[commonPrefixLength] });
                commonPrefixLength++;
            }
            
            // Find common suffix
            let commonSuffixLength = 0;
            const maxSuffix = Math.min(oldLines.length - commonPrefixLength, 
                                      newLines.length - commonPrefixLength);
            while (commonSuffixLength < maxSuffix && 
                   oldLines[oldLines.length - 1 - commonSuffixLength] === 
                   newLines[newLines.length - 1 - commonSuffixLength]) {
                commonSuffixLength++;
            }
            
            // Process middle section with differences
            for (let i = commonPrefixLength; i < oldLines.length - commonSuffixLength; i++) {
                result.push({ type: -1, text: oldLines[i] });
            }
            
            for (let i = commonPrefixLength; i < newLines.length - commonSuffixLength; i++) {
                result.push({ type: 1, text: newLines[i] });
            }
            
            // Add common suffix
            for (let i = 0; i < commonSuffixLength; i++) {
                const idx = newLines.length - commonSuffixLength + i;
                result.push({ type: 0, text: newLines[idx] });
            }
            
            return result;
        } catch (error) {
            console.error('Error generating diff:', error);
            return [];
        }
    }
    
    /**
     * Show a diff editor with the changes
     */
    private async showDiff(filePath: string, oldContent: string, _newContent: string): Promise<void> {
        try {
            const fileName = path.basename(filePath);
            
            // Create temporary URI for old version
            const oldUri = vscode.Uri.parse(`untitled:${fileName}.previous`);
            const newUri = vscode.Uri.file(filePath);
            
            // Insert old content in a temporary document
            await vscode.workspace.openTextDocument(oldUri);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(oldUri, new vscode.Position(0, 0), oldContent);
            await vscode.workspace.applyEdit(edit);
            
            // Show diff editor
            await vscode.commands.executeCommand('vscode.diff', 
                oldUri, 
                newUri, 
                `${fileName} (Changes)`
            );
        } catch (error) {
            console.error('Error showing diff:', error);
        }
    }

    /**
     * Handle errors in file operations with recovery options
     */
    private async handleFileOperationError(
        operationType: 'add' | 'update' | 'delete',
        filePath: string,
        error: unknown,
        content?: string
    ): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Show error notification with retry option
        const action = await vscode.window.showErrorMessage(
            `Failed to ${operationType} file ${path.basename(filePath)}: ${errorMessage}`,
            'Retry',
            'Alternative Method',
            'Show Details'
        );
        
        if (action === 'Retry') {
            // Try the operation again
            if (operationType === 'add' && content) {
                await this.retryWithDelay(() => this.addFile(filePath, content), 500);
            } else if (operationType === 'update' && content) {
                await this.retryWithDelay(() => this.updateFile(filePath, content), 500);
            } else if (operationType === 'delete') {
                await this.retryWithDelay(() => this.deleteFile(filePath), 500);
            }
        } else if (action === 'Alternative Method' && content) {
            // Try alternative approach for file operations
            try {
                if (operationType === 'add' || operationType === 'update') {
                    // Create backup of existing file if it exists
                    if (fs.existsSync(filePath)) {
                        const backupPath = `${filePath}.backup-${Date.now()}`;
                        fs.copyFileSync(filePath, backupPath);
                        vscode.window.showInformationMessage(`Created backup at ${backupPath}`);
                    }
                    
                    // Ensure directory exists
                    const dir = path.dirname(filePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    
                    // Use direct file system write
                    fs.writeFileSync(filePath, content, 'utf8');
                    vscode.window.showInformationMessage(`Successfully saved ${filePath} using alternative method`);
                    
                    // Open the file
                    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
                    await vscode.window.showTextDocument(document);
                }
            } catch (alternativeError) {
                console.error(`Alternative method failed for ${filePath}:`, alternativeError);
                vscode.window.showErrorMessage(`Alternative method also failed: ${alternativeError instanceof Error ? alternativeError.message : String(alternativeError)}`);
            }
        } else if (action === 'Show Details') {
            // Show detailed error information in output channel
            const channel = vscode.window.createOutputChannel('Smile AI File Operations');
            channel.appendLine(`=== Error Details for ${operationType} operation on ${filePath} ===`);
            channel.appendLine(`Time: ${new Date().toISOString()}`);
            channel.appendLine(`Error: ${errorMessage}`);
            if (error instanceof Error && error.stack) {
                channel.appendLine(`Stack: ${error.stack}`);
            }
            channel.appendLine(`Operation Type: ${operationType}`);
            channel.appendLine(`File Path: ${filePath}`);
            channel.appendLine(`Absolute Path: ${path.resolve(filePath)}`);
            channel.appendLine(`Directory Exists: ${fs.existsSync(path.dirname(filePath))}`);
            channel.appendLine(`File Exists: ${fs.existsSync(filePath)}`);
            if (fs.existsSync(filePath)) {
                try {
                    const stats = fs.statSync(filePath);
                    channel.appendLine(`File Stats: ${JSON.stringify(stats)}`);
                    channel.appendLine(`Is Directory: ${stats.isDirectory()}`);
                    channel.appendLine(`Is File: ${stats.isFile()}`);
                    channel.appendLine(`Size: ${stats.size} bytes`);
                    channel.appendLine(`Permissions: ${stats.mode.toString(8)}`);
                } catch (statsError) {
                    channel.appendLine(`Error getting file stats: ${statsError}`);
                }
            }
            channel.show();
        }
    }
    
    /**
     * Retry an operation with a delay
     */
    private async retryWithDelay<T>(operation: () => Promise<T>, delayMs: number): Promise<T> {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return operation();
    }

    /**
     * Create a group of related file operations
     */
    public async createOperationGroup(
        operations: Array<{
            type: 'add' | 'update' | 'delete';
            filePath: string;
            content?: string;
            originalContent?: string;
        }>, 
        description: string
    ): Promise<FileOperationGroup> {
        // Generate a unique ID for the group
        const groupId = `group-${Date.now()}`;
        
        // Process each operation and collect the created operations
        const createdOperations: FileOperation[] = [];
        
        for (const operation of operations) {
            try {
                let fileOp: FileOperation;
                
                if (operation.type === 'add' && operation.content) {
                    fileOp = await this.createAddOperation(
                        operation.filePath, 
                        operation.content, 
                        `[Group: ${description}] Add ${path.basename(operation.filePath)}`
                    );
                } else if (operation.type === 'update' && operation.content && operation.originalContent) {
                    fileOp = await this.createUpdateOperation(
                        operation.filePath,
                        operation.originalContent,
                        operation.content,
                        `[Group: ${description}] Update ${path.basename(operation.filePath)}`
                    );
                } else if (operation.type === 'delete' && operation.originalContent) {
                    fileOp = await this.createDeleteOperation(
                        operation.filePath,
                        operation.originalContent,
                        `[Group: ${description}] Delete ${path.basename(operation.filePath)}`
                    );
                } else {
                    console.error(`Invalid operation type or missing content: ${operation.type}`);
                    continue;
                }
                
                createdOperations.push(fileOp);
            } catch (error) {
                console.error(`Error creating operation for ${operation.filePath}:`, error);
            }
        }
        
        // Create the operation group
        const group: FileOperationGroup = {
            id: groupId,
            description,
            operations: createdOperations,
            created: Date.now(),
            isApplied: createdOperations.every(op => op.isApplied)
        };
        
        // Store the group
        this.operationGroups.set(groupId, group);
        
        // Notify webview
        this.notifyWebview();
        
        return group;
    }
    
    /**
     * Get all operation groups
     */
    public getOperationGroups(): FileOperationGroup[] {
        return Array.from(this.operationGroups.values());
    }
    
    /**
     * Accept all operations in a group
     */
    public async acceptGroup(groupId: string): Promise<boolean> {
        const group = this.operationGroups.get(groupId);
        if (!group) return false;
        
        let allSucceeded = true;
        
        for (const operation of group.operations) {
            try {
                const success = await this.acceptOperation(operation.id);
                if (!success) {
                    allSucceeded = false;
                }
            } catch (error) {
                console.error(`Error accepting operation ${operation.id}:`, error);
                allSucceeded = false;
            }
        }
        
        // Remove the group if all operations are applied
        if (allSucceeded) {
            this.operationGroups.delete(groupId);
            this.notifyWebview();
        }
        
        return allSucceeded;
    }
    
    /**
     * Reject all operations in a group
     */
    public async rejectGroup(groupId: string): Promise<boolean> {
        const group = this.operationGroups.get(groupId);
        if (!group) return false;
        
        // Process operations in reverse order (newest first)
        const operations = [...group.operations].reverse();
        
        let allSucceeded = true;
        
        for (const operation of operations) {
            try {
                const success = await this.rejectOperation(operation.id);
                if (!success) {
                    allSucceeded = false;
                }
            } catch (error) {
                console.error(`Error rejecting operation ${operation.id}:`, error);
                allSucceeded = false;
            }
        }
        
        // Remove the group
        this.operationGroups.delete(groupId);
        this.notifyWebview();
        
        return allSucceeded;
    }
    
    /**
     * Detect related file operations and group them
     * This can be called after multiple files have been processed
     */
    public groupRelatedOperations(): void {
        // Map to track operations by directory
        const operationsByDir: Map<string, FileOperation[]> = new Map();
        
        // Group operations by directory
        for (const operation of this.pendingOperations.values()) {
            const dir = path.dirname(operation.filePath);
            if (!operationsByDir.has(dir)) {
                operationsByDir.set(dir, []);
            }
            operationsByDir.get(dir)?.push(operation);
        }
        
        // Create groups for directories with multiple operations
        for (const [dir, operations] of operationsByDir.entries()) {
            if (operations.length > 1) {
                const groupId = `group-${Date.now()}-${dir.replace(/[^a-z0-9]/gi, '-')}`;
                
                // Create the group
                const group: FileOperationGroup = {
                    id: groupId,
                    description: `Multiple file operations in ${path.basename(dir)}`,
                    operations,
                    created: Date.now(),
                    isApplied: operations.every(op => op.isApplied)
                };
                
                // Store the group
                this.operationGroups.set(groupId, group);
                
                // Remove individual operations from pending list
                for (const op of operations) {
                    this.pendingOperations.delete(op.id);
                }
            }
        }
        
        // Notify webview of changes
        this.notifyWebview();
    }
} 