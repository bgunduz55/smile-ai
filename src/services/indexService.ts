import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { minimatch } from 'minimatch';

interface IndexedFile {
    filePath: string;
    content: string;
    language: string;
    lastModified: number;
}

interface SmileIgnoreConfig {
    excludePatterns: string[];
    includePatterns: string[];
}

export class IndexService {
    private static instance: IndexService;
    private files: Map<string, IndexedFile>;
    private defaultExcludePatterns: string[] = [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/out/**',
        '**/.DS_Store',
        '**/thumbs.db',
        '**/*.min.js',
        '**/*.min.css',
        '**/vendor/**',
        '**/coverage/**',
        '**/tmp/**',
        '**/temp/**'
    ];
    private ignoreConfig: SmileIgnoreConfig = {
        excludePatterns: [...this.defaultExcludePatterns],
        includePatterns: []
    };

    private constructor() {
        this.files = new Map();
    }

    public static getInstance(): IndexService {
        if (!IndexService.instance) {
            IndexService.instance = new IndexService();
        }
        return IndexService.instance;
    }

    private async loadSmileIgnore(workspaceRoot: string): Promise<void> {
        const smileIgnorePath = path.join(workspaceRoot, '.smileignore');
        
        try {
            if (fs.existsSync(smileIgnorePath)) {
                const content = fs.readFileSync(smileIgnorePath, 'utf-8');
                const lines = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'));

                this.ignoreConfig = {
                    excludePatterns: [...this.defaultExcludePatterns],
                    includePatterns: []
                };

                lines.forEach(line => {
                    if (line.startsWith('!')) {
                        // Include pattern (override exclude)
                        this.ignoreConfig.includePatterns.push(line.slice(1));
                    } else {
                        // Exclude pattern
                        this.ignoreConfig.excludePatterns.push(line);
                    }
                });

                vscode.window.showInformationMessage('.smileignore dosyası yüklendi');
            }
        } catch (error) {
            console.error('.smileignore loading error:', error);
            vscode.window.showErrorMessage('.smileignore file loading error');
        }
    }

    public async startIndexing(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        try {
            await this.loadSmileIgnore(workspaceFolder.uri.fsPath);

            // Get all files
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(workspaceFolder, '**/*'),
                '{' + this.ignoreConfig.excludePatterns.join(',') + '}'
            );

            // Clear existing files
            this.files.clear();

            for (const file of files) {
                try {
                    if (this.shouldIndexFile(file.fsPath)) {
                        const content = fs.readFileSync(file.fsPath, 'utf-8');
                        const stats = fs.statSync(file.fsPath);
                        const language = this.getFileLanguage(file.fsPath);

                        this.files.set(file.fsPath, {
                            filePath: file.fsPath,
                            content,
                            language,
                            lastModified: stats.mtimeMs
                        });
                        console.log(`Indexed: ${file.fsPath}`);
                    }
                } catch (error) {
                    console.error(`Error indexing file ${file.fsPath}:`, error);
                }
            }

            console.log('Indexing completed');
            vscode.window.showInformationMessage('File indexing completed.');

        } catch (error) {
            console.error('Error during indexing:', error);
            vscode.window.showErrorMessage('Indexing error: ' + 
                (error instanceof Error ? error.message : 'Unknown error'));
            throw error;
        }
    }

    private shouldIndexFile(filePath: string): boolean {
        const relativePath = vscode.workspace.asRelativePath(filePath);

        // First check include patterns
        for (const pattern of this.ignoreConfig.includePatterns) {
            if (minimatch(relativePath, pattern)) {
                return true;
            }
        }

        // Then check exclude patterns
        for (const pattern of this.ignoreConfig.excludePatterns) {
            if (minimatch(relativePath, pattern)) {
                return false;
            }
        }

        return true;
    }

    private getFileLanguage(filePath: string): string {
        const extension = path.extname(filePath).toLowerCase();
        const languageMap: { [key: string]: string } = {
            '.ts': 'typescript',
            '.js': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.cs': 'csharp',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.html': 'html',
            '.css': 'css',
            '.scss': 'scss',
            '.json': 'json',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.md': 'markdown'
        };
        return languageMap[extension] || 'plaintext';
    }

    public searchFiles(query: string): IndexedFile[] {
        const results: IndexedFile[] = [];
        const queryLower = query.toLowerCase();

        for (const file of this.files.values()) {
            if (file.content.toLowerCase().includes(queryLower)) {
                results.push(file);
            }
        }

        return results;
    }

    public getFile(filePath: string): IndexedFile | null {
        return this.files.get(filePath) || null;
    }

    public searchByWords(words: string[]): IndexedFile[] {
        const results: IndexedFile[] = [];
        const wordsLower = words.map(w => w.toLowerCase());

        for (const file of this.files.values()) {
            const contentLower = file.content.toLowerCase();
            if (wordsLower.some(word => contentLower.includes(word))) {
                results.push(file);
            }
        }

        return results;
    }

    public getRelevantFiles(context: string): IndexedFile[] {
        const words = context.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        
        if (words.length === 0) {
            return [];
        }

        const results = Array.from(this.files.values()).map(file => {
            const contentLower = file.content.toLowerCase();
            const relevance = words.reduce((score, word) => 
                score + (contentLower.includes(word) ? 1 : 0), 0);
            return { file, relevance };
        });

        results.sort((a, b) => b.relevance - a.relevance);
        return results.slice(0, 10).map(r => r.file);
    }

    public dispose(): void {
        this.files.clear();
    }
}

export const indexService = IndexService.getInstance(); 