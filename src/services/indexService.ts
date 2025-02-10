import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import initSqlJs from 'sql.js';
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

interface FileRow {
    file_path: string;
    content: string;
    language: string;
    last_modified: number;
}

interface RelevantFileRow extends FileRow {
    relevance: number;
}

export class IndexService {
    private static instance: IndexService;
    private db: any;
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
        this.initDatabase();
    }

    public static getInstance(): IndexService {
        if (!IndexService.instance) {
            IndexService.instance = new IndexService();
        }
        return IndexService.instance;
    }

    private async initDatabase(): Promise<void> {
        const SQL = await initSqlJs();
        this.db = new SQL.Database();
        
        this.db.run(`
            CREATE TABLE IF NOT EXISTS files (
                file_path TEXT PRIMARY KEY,
                content TEXT,
                language TEXT,
                last_modified INTEGER
            )
        `);
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

            // Begin transaction
            this.db.run('BEGIN TRANSACTION');

            for (const file of files) {
                try {
                    if (this.shouldIndexFile(file.fsPath)) {
                        const content = fs.readFileSync(file.fsPath, 'utf-8');
                        const stats = fs.statSync(file.fsPath);
                        const language = this.getFileLanguage(file.fsPath);

                        this.db.run(
                            'INSERT OR REPLACE INTO files (file_path, content, language, last_modified) VALUES (?, ?, ?, ?)',
                            [file.fsPath, content, language, stats.mtimeMs]
                        );
                        console.log(`Indexed: ${file.fsPath}`);
                    }
                } catch (error) {
                    console.error(`Error indexing file ${file.fsPath}:`, error);
                }
            }

            // Commit transaction
            this.db.run('COMMIT');

            console.log('Indexing completed');
            vscode.window.showInformationMessage('File indexing completed.');

        } catch (error) {
            // Rollback on error
            this.db.run('ROLLBACK');
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
        const stmt = this.db.prepare('SELECT * FROM files WHERE content LIKE ?');
        const results = stmt.all(['%' + query + '%']);
        stmt.free();

        return results.map((row: FileRow) => ({
            filePath: row.file_path,
            content: row.content,
            language: row.language,
            lastModified: row.last_modified
        }));
    }

    public getFile(filePath: string): IndexedFile | null {
        const stmt = this.db.prepare('SELECT * FROM files WHERE file_path = ?');
        const results = stmt.get([filePath]);
        stmt.free();

        if (!results) {
            return null;
        }

        const row = results as FileRow;
        return {
            filePath: row.file_path,
            content: row.content,
            language: row.language,
            lastModified: row.last_modified
        };
    }

    public searchByWords(words: string[]): IndexedFile[] {
        const placeholders = words.map(() => 'content LIKE ?').join(' OR ');
        const params = words.map(word => '%' + word + '%');
        
        const stmt = this.db.prepare(`SELECT * FROM files WHERE ${placeholders}`);
        const results = stmt.all(params);
        stmt.free();

        return results.map((row: FileRow) => ({
            filePath: row.file_path,
            content: row.content,
            language: row.language,
            lastModified: row.last_modified
        }));
    }

    public getRelevantFiles(context: string): IndexedFile[] {
        const words = context.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        
        if (words.length === 0) {
            return [];
        }

        const query = words.map(() => 'content LIKE ?').join(' OR ');
        const relevanceCalc = words.map(() => 'CASE WHEN content LIKE ? THEN 1 ELSE 0 END').join(' + ');
        const params = words.map(word => '%' + word + '%');
        
        const stmt = this.db.prepare(
            `SELECT file_path, content, language, last_modified,
             (${relevanceCalc}) as relevance
             FROM files
             WHERE ${query}
             ORDER BY relevance DESC
             LIMIT 10`
        );
        const results = stmt.all(params);
        stmt.free();

        return results.map((row: RelevantFileRow) => ({
            filePath: row.file_path,
            content: row.content,
            language: row.language,
            lastModified: row.last_modified
        }));
    }

    public dispose(): void {
        if (this.db) {
            this.db.close();
        }
    }
}

export const indexService = IndexService.getInstance(); 