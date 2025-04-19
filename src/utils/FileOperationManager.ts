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
}

export class FileOperationManager {
    private static instance: FileOperationManager;
    private pendingOperations: Map<string, FileOperation>;
    private webviewView: vscode.WebviewView | undefined;

    private constructor() {
        this.pendingOperations = new Map();
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

    public createAddOperation(filePath: string, content: string, description?: string): FileOperation {
        const operation: FileOperation = {
            id: Date.now().toString(),
            type: 'add',
            filePath,
            newContent: content,
            description,
            created: Date.now()
        };
        
        this.pendingOperations.set(operation.id, operation);
        this.notifyWebview();
        return operation;
    }

    public createUpdateOperation(filePath: string, originalContent: string, newContent: string, description?: string): FileOperation {
        const operation: FileOperation = {
            id: Date.now().toString(),
            type: 'update',
            filePath,
            originalContent,
            newContent,
            description,
            created: Date.now()
        };
        
        this.pendingOperations.set(operation.id, operation);
        this.notifyWebview();
        return operation;
    }

    public createDeleteOperation(filePath: string, originalContent: string, description?: string): FileOperation {
        const operation: FileOperation = {
            id: Date.now().toString(),
            type: 'delete',
            filePath,
            originalContent,
            description,
            created: Date.now()
        };
        
        this.pendingOperations.set(operation.id, operation);
        this.notifyWebview();
        return operation;
    }

    public getPendingOperations(): FileOperation[] {
        return Array.from(this.pendingOperations.values());
    }

    public getOperation(id: string): FileOperation | undefined {
        return this.pendingOperations.get(id);
    }

    public async acceptOperation(id: string): Promise<boolean> {
        const operation = this.pendingOperations.get(id);
        if (!operation) return false;

        try {
            switch (operation.type) {
                case 'add':
                    await this.addFile(operation.filePath, operation.newContent || '');
                    break;
                case 'update':
                    await this.updateFile(operation.filePath, operation.newContent || '');
                    break;
                case 'delete':
                    await this.deleteFile(operation.filePath);
                    break;
            }
            
            this.pendingOperations.delete(id);
            this.notifyWebview();
            return true;
        } catch (error) {
            console.error(`Error applying operation ${operation.type}:`, error);
            return false;
        }
    }

    public async rejectOperation(id: string): Promise<boolean> {
        if (this.pendingOperations.has(id)) {
            this.pendingOperations.delete(id);
            this.notifyWebview();
            return true;
        }
        return false;
    }

    public async acceptAllOperations(): Promise<boolean> {
        try {
            // Process all pending operations
            const operationIds = Array.from(this.pendingOperations.keys());
            for (const id of operationIds) {
                await this.acceptOperation(id);
            }
            return true;
        } catch (error) {
            console.error('Error applying all operations:', error);
            return false;
        }
    }

    public async rejectAllOperations(): Promise<boolean> {
        this.pendingOperations.clear();
        this.notifyWebview();
        return true;
    }

    private async addFile(filePath: string, content: string): Promise<void> {
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
    }

    private async updateFile(filePath: string, content: string): Promise<void> {
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
            await vscode.workspace.applyEdit(edit);
        } catch (error) {
            console.error('Error updating file:', error);
            throw error;
        }
    }

    private async deleteFile(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.workspace.fs.delete(uri, { useTrash: true });
        } catch (error) {
            console.error('Error deleting file:', error);
            throw error;
        }
    }

    private notifyWebview(): void {
        if (this.webviewView?.webview) {
            this.webviewView.webview.postMessage({
                command: 'updatePendingOperations',
                operations: this.getPendingOperations()
            });
        }
    }

    public getDiff(operationId: string): { added: boolean; removed: boolean; value: string; }[] {
        const operation = this.pendingOperations.get(operationId);
        if (!operation || operation.type === 'add') return [];

        const { diffLines } = require('diff');
        return diffLines(operation.originalContent || '', operation.newContent || '');
    }

    public clearOperations(): void {
        this.pendingOperations.clear();
        this.notifyWebview();
    }
} 