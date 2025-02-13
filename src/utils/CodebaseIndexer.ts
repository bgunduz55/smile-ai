import * as vscode from 'vscode';
import * as path from 'path';
import { FileAnalyzer, FileContext } from './FileAnalyzer';
import { CodeAnalyzer, CodeAnalysis } from './CodeAnalyzer';

interface IndexedFile extends FileContext {
    uri: vscode.Uri;
    lastModified: number;
    symbols: CodeSymbol[];
}

interface CodeSymbol {
    name: string;
    kind: vscode.SymbolKind;
    location: vscode.Location;
    containerName?: string;
}

export class CodebaseIndexer {
    private static instance: CodebaseIndexer;
    private fileAnalyzer: FileAnalyzer;
    private codeAnalyzer: CodeAnalyzer;
    private indexedFiles: Map<string, IndexedFile>;
    private isIndexing: boolean;
    private lastIndexTime: number;
    private watcher: vscode.FileSystemWatcher | undefined;

    private constructor() {
        this.fileAnalyzer = FileAnalyzer.getInstance();
        this.codeAnalyzer = CodeAnalyzer.getInstance();
        this.indexedFiles = new Map();
        this.isIndexing = false;
        this.lastIndexTime = 0;
    }

    public static getInstance(): CodebaseIndexer {
        if (!CodebaseIndexer.instance) {
            CodebaseIndexer.instance = new CodebaseIndexer();
        }
        return CodebaseIndexer.instance;
    }

    private setupFileWatcher() {
        if (this.watcher) {
            return;
        }

        // Dosya değişikliklerini izle
        this.watcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{ts,tsx,js,jsx,json,md}',
            false, // create
            false, // change
            false  // delete
        );

        this.watcher.onDidCreate(uri => this.handleFileChange(uri));
        this.watcher.onDidChange(uri => this.handleFileChange(uri));
        this.watcher.onDidDelete(uri => this.handleFileDelete(uri));
    }

    private async handleFileChange(uri: vscode.Uri) {
        try {
            // Dosyayı yeniden indexle
            await this.indexFile(uri);
            
            // Bağımlı dosyaları bul ve güncelle
            const dependencies = await this.findDependentFiles(uri);
            for (const dep of dependencies) {
                await this.indexFile(dep);
            }
        } catch (error) {
            console.error(`File change handling error: ${error}`);
        }
    }

    private handleFileDelete(uri: vscode.Uri) {
        // Index'ten dosyayı kaldır
        this.indexedFiles.delete(uri.fsPath);
    }

    public async indexWorkspace() {
        if (this.isIndexing) return;
        this.isIndexing = true;

        try {
            // File watcher'ı başlat
            this.setupFileWatcher();

            // Tüm workspace dosyalarını bul
            const files = await vscode.workspace.findFiles(
                '**/*.{ts,tsx,js,jsx,json,md}',
                '**/node_modules/**'
            );

            // Her dosyayı indexle
            for (const file of files) {
                await this.indexFile(file);
            }

            this.lastIndexTime = Date.now();
        } catch (error) {
            console.error(`Workspace indexing error: ${error}`);
        } finally {
            this.isIndexing = false;
        }
    }

    private async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            
            // Dosya analizi yap
            const context = await this.fileAnalyzer.analyzeFile(uri);
            const analysis = await this.codeAnalyzer.analyzeCode(document, context);
            
            // Sembolleri çıkar
            const symbols = await this.extractSymbols(document);

            // Index'e ekle
            const indexedFile: IndexedFile = {
                ...context,
                uri,
                lastModified: Date.now(),
                symbols,
                analysis
            };

            this.indexedFiles.set(uri.fsPath, indexedFile);
        } catch (error) {
            console.error(`File indexing error: ${error}`);
        }
    }

    private async extractSymbols(document: vscode.TextDocument): Promise<CodeSymbol[]> {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        return (symbols || []).map(symbol => ({
            name: symbol.name,
            kind: symbol.kind,
            location: symbol.location,
            containerName: symbol.containerName
        }));
    }

    private async findDependentFiles(uri: vscode.Uri): Promise<vscode.Uri[]> {
        const dependents: vscode.Uri[] = [];
        const targetPath = uri.fsPath;

        for (const [filePath, file] of this.indexedFiles) {
            if (file.dependencies?.some(dep => {
                const depPath = path.resolve(path.dirname(filePath), dep);
                return depPath === targetPath;
            })) {
                dependents.push(file.uri);
            }
        }

        return dependents;
    }

    public getFileContext(uri: vscode.Uri): FileContext | undefined {
        const indexedFile = this.indexedFiles.get(uri.fsPath);
        if (!indexedFile) return undefined;

        // FileContext arayüzüne uygun alanları döndür
        const { uri: _, lastModified: __, symbols: ___, ...fileContext } = indexedFile;
        return fileContext;
    }

    public searchSymbols(query: string): CodeSymbol[] {
        const results: CodeSymbol[] = [];
        
        for (const file of this.indexedFiles.values()) {
            const matches = file.symbols.filter(symbol => 
                symbol.name.toLowerCase().includes(query.toLowerCase())
            );
            results.push(...matches);
        }

        return results;
    }

    public findReferences(symbolName: string): vscode.Location[] {
        const references: vscode.Location[] = [];

        for (const file of this.indexedFiles.values()) {
            // Sembol kullanımlarını bul
            const regex = new RegExp(`\\b${symbolName}\\b`, 'g');
            let match;
            
            while ((match = regex.exec(file.content)) !== null) {
                const position = file.content.substr(0, match.index).split('\n');
                const line = position.length - 1;
                const character = position[position.length - 1].length;

                references.push(new vscode.Location(
                    file.uri,
                    new vscode.Position(line, character)
                ));
            }
        }

        return references;
    }

    public getProjectStructure(): any {
        const structure: any = {};

        for (const [path, file] of this.indexedFiles) {
            const parts = path.split('/');
            let current = structure;

            for (const part of parts) {
                if (!current[part]) {
                    current[part] = {};
                }
                current = current[part];
            }

            current._file = {
                symbols: file.symbols,
                dependencies: file.dependencies
            };
        }

        return structure;
    }

    public dispose() {
        if (this.watcher) {
            this.watcher.dispose();
        }
        this.indexedFiles.clear();
    }
} 