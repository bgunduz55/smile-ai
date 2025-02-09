import * as vscode from 'vscode';
import { indexService } from './indexService';

export class WorkspaceIndexer {
    private static instance: WorkspaceIndexer;
    private isIndexing: boolean = false;

    private constructor() {}

    public static getInstance(): WorkspaceIndexer {
        if (!WorkspaceIndexer.instance) {
            WorkspaceIndexer.instance = new WorkspaceIndexer();
        }
        return WorkspaceIndexer.instance;
    }

    public async startIndexing(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        if (this.isIndexing) {
            return;
        }

        this.isIndexing = true;
        try {
            await indexService.startIndexing(workspaceFolder);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Indexing error: ${errorMessage}`);
        } finally {
            this.isIndexing = false;
        }
    }

    public async searchFiles(_query: string): Promise<void> {
        // TODO: Later, search functionality will be added
    }

    public dispose(): void {
        // Clean up resources
    }
}

export const workspaceIndexer = WorkspaceIndexer.getInstance(); 