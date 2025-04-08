import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodebaseIndex } from './CodebaseIndex';
import { FileAnalyzer } from '../utils/FileAnalyzer';
import { CodeAnalyzer } from '../utils/CodeAnalyzer';
import ignore from 'ignore';

export class CodebaseIndexer {
    private static instance: CodebaseIndexer;
    private index: CodebaseIndex;
    private fileAnalyzer: FileAnalyzer;
    private codeAnalyzer: CodeAnalyzer;
    private isIndexing: boolean = false;
    private ignoreFilter: any;
    private attachedFiles: Set<string> = new Set();
    private attachedFolders: Set<string> = new Set();

    private constructor() {
        this.index = new CodebaseIndex();
        this.fileAnalyzer = FileAnalyzer.getInstance();
        this.codeAnalyzer = CodeAnalyzer.getInstance();
        this.loadIgnorePatterns();
    }

    public static getInstance(): CodebaseIndexer {
        if (!CodebaseIndexer.instance) {
            CodebaseIndexer.instance = new CodebaseIndexer();
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

    public async indexWorkspace(): Promise<void> {
        if (this.isIndexing) {
            return;
        }

        this.isIndexing = true;
        const progress = vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Indexing workspace...",
            cancellable: true
        }, async (progress) => {
            try {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    return;
                }

                this.index.clear();
                
                for (const folder of workspaceFolders) {
                    await this.indexDirectory(folder.uri.fsPath, progress);
                }

                vscode.window.showInformationMessage('Workspace indexing completed');
            } catch (error) {
                console.error('Error during indexing:', error);
                vscode.window.showErrorMessage('Failed to index workspace');
            } finally {
                this.isIndexing = false;
            }
        });

        return progress;
    }

    private async indexDirectory(dirPath: string, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = vscode.workspace.asRelativePath(fullPath);

            // Skip if path matches ignore patterns
            if (this.ignoreFilter.ignores(relativePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                await this.indexDirectory(fullPath, progress);
            } else {
                progress.report({ message: `Indexing ${relativePath}` });
                await this.indexFile(fullPath);
            }
        }
    }

    private async indexFile(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const fileContext = await this.fileAnalyzer.analyzeFile(uri);
            const analysis = await this.codeAnalyzer.analyzeCode(uri, fileContext);
            
            this.index.addFile({
                uri,
                path: filePath,
                context: fileContext,
                analysis
            });
        } catch (error) {
            console.warn(`Failed to index file ${filePath}:`, error);
        }
    }

    public attachFile(filePath: string): void {
        const fullPath = path.resolve(filePath);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            this.attachedFiles.add(fullPath);
            this.indexFile(fullPath);
        }
    }

    public attachFolder(folderPath: string): void {
        const fullPath = path.resolve(folderPath);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            this.attachedFolders.add(fullPath);
            this.indexDirectory(fullPath, {
                report: () => {} // No-op progress for attached folders
            });
        }
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

    public dispose(): void {
        this.index.clear();
        this.attachedFiles.clear();
        this.attachedFolders.clear();
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