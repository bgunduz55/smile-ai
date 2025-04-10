import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodebaseIndex } from './CodebaseIndex';
import ignore from 'ignore';
import { AIEngine } from '../ai-engine/AIEngine';

export interface IndexedFile {
    uri: vscode.Uri;
    content: string;
    embedding: number[];
    path: string;
}

export class CodebaseIndexer {
    private static instance: CodebaseIndexer;
    private readonly aiEngine: AIEngine;
    private index: CodebaseIndex;
    private isIndexing: boolean = false;
    private ignoreFilter: any;
    private attachedFiles: Set<string> = new Set();
    private attachedFolders: Set<string> = new Set();

    private constructor(aiEngine: AIEngine) {
        this.aiEngine = aiEngine;
        this.index = new CodebaseIndex();
        this.loadIgnorePatterns();
    }

    public static getInstance(aiEngine: AIEngine): CodebaseIndexer {
        if (!CodebaseIndexer.instance) {
            CodebaseIndexer.instance = new CodebaseIndexer(aiEngine);
        }
        return CodebaseIndexer.instance;
    }

    private loadIgnorePatterns(): void {
        this.ignoreFilter = ignore();
        
        // Default patterns
        const defaultPatterns = [
            'node_modules',
            'dist',
            'out',
            '.git',
            '*.log'
        ];
        this.ignoreFilter.add(defaultPatterns);

        // Load .smileignore if exists
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const smileIgnorePath = path.join(workspaceFolders[0].uri.fsPath, '.smileignore');
            if (fs.existsSync(smileIgnorePath)) {
                const ignoreContent = fs.readFileSync(smileIgnorePath, 'utf8');
                this.ignoreFilter.add(ignoreContent);
            }
        }
    }

    public async indexWorkspace(progressCallback?: (message: string) => void): Promise<void> {
        if (this.isIndexing) {
            return;
        }

        this.isIndexing = true;

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('No workspace folder is open');
            }

            for (const folder of workspaceFolders) {
                await this.indexFolder(folder.uri.fsPath, progressCallback);
            }
        } finally {
            this.isIndexing = false;
        }
    }

    private async indexFolder(folderPath: string, progressCallback?: (message: string) => void): Promise<void> {
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folderPath, '**/*'),
            '**/node_modules/**'
        );

        for (const file of files) {
            if (progressCallback) {
                progressCallback(`Indexing ${vscode.workspace.asRelativePath(file)}`);
            }
            await this.attachFile(file.fsPath);
        }
    }

    public async attachFile(filePath: string): Promise<void> {
        const fileUri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(fileUri);
        const content = document.getText();
        const embedding = await this.aiEngine.generateEmbeddings(content);
        
        await this.index.addDocument({
            uri: fileUri,
            content,
            embedding,
            path: filePath
        });
    }

    public async attachFolder(folderPath: string): Promise<void> {
        await this.indexFolder(folderPath);
    }

    public getAttachedFiles(): string[] {
        return Array.from(this.attachedFiles);
    }

    public getAttachedFolders(): string[] {
        return Array.from(this.attachedFolders);
    }

    public getIndex(): CodebaseIndex {
        return this.index;
    }

    public clearIndex(): void {
        this.index = new CodebaseIndex();
    }

    public async findSymbolAtPosition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.SymbolInformation | undefined> {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeDocumentSymbolProvider',
            uri
        );

        if (!symbols) return undefined;

        return symbols.find(symbol => {
            const range = symbol.location.range;
            return range.contains(position);
        });
    }

    public async findReferences(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[]> {
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        );

        return references || [];
    }
}