import * as vscode from 'vscode';
import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';

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
    private db: sqlite3.Database;
    private watcher: chokidar.FSWatcher | null = null;
    private indexingPromise: Promise<void> | null = null;
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
    private run: (sql: string, params?: any) => Promise<void>;
    private get: (sql: string, params?: any) => Promise<any>;
    private all: (sql: string, params?: any) => Promise<any[]>;

    private constructor() {
        this.db = new sqlite3.Database(':memory:');
        this.run = promisify(this.db.run.bind(this.db));
        this.get = promisify(this.db.get.bind(this.db));
        this.all = promisify(this.db.all.bind(this.db));
        this.initDatabase();
    }

    public static getInstance(): IndexService {
        if (!IndexService.instance) {
            IndexService.instance = new IndexService();
        }
        return IndexService.instance;
    }

    private async initDatabase(): Promise<void> {
        await this.run(`
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
            } else {
                // .smileignore yoksa varsayılan bir tane oluştur
                const defaultContent = `# Smile AI tarafından indexlenmeyecek dosya ve klasörler
# Her satır bir glob pattern içermelidir
# ! ile başlayan satırlar dahil edilecek öğeleri belirtir

# Genel dışlamalar
**/node_modules/**
**/dist/**
**/build/**
**/.git/**
**/out/**
**/.DS_Store
**/thumbs.db
**/*.min.js
**/*.min.css
**/vendor/**
**/coverage/**
**/tmp/**
**/temp/**

# Büyük dosyalar
**/*.{png,jpg,jpeg,gif,ico,svg,woff,woff2,ttf,eot}
**/*.{zip,tar,gz,rar,7z}
**/*.{mp3,mp4,avi,mov,wmv}
**/*.{pdf,doc,docx,xls,xlsx,ppt,pptx}

# IDE ve editör dosyaları
**/.idea/**
**/.vscode/**
**/.vs/**
**/*.sublime-*
**/*.swp
**/*.swo

# Log ve veritabanı dosyaları
**/*.log
**/*.sqlite
**/*.db

# Özel dışlamalar
# my-secret-folder/**

# Özel dahil etmeler (dışlanan klasörlerdeki belirli dosyaları dahil et)
# !**/node_modules/önemli-paket/önemli-dosya.js
# !**/dist/index.html`;

                fs.writeFileSync(smileIgnorePath, defaultContent, 'utf-8');
                vscode.window.showInformationMessage('Varsayılan .smileignore dosyası oluşturuldu');
            }
        } catch (error) {
            console.error('.smileignore yükleme hatası:', error);
            vscode.window.showErrorMessage('.smileignore dosyası yüklenirken hata oluştu');
        }
    }

    public async startIndexing(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        if (this.indexingPromise) {
            return this.indexingPromise;
        }

        await this.loadSmileIgnore(workspaceFolder.uri.fsPath);
        this.indexingPromise = this.doIndexing(workspaceFolder);
        return this.indexingPromise;
    }

    private async doIndexing(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        try {
            // Mevcut dosyaları indexle
            const files = await glob('**/*', {
                cwd: workspaceFolder.uri.fsPath,
                ignore: this.ignoreConfig.excludePatterns,
                nodir: true,
                dot: true
            });

            for (const file of files) {
                const filePath = path.join(workspaceFolder.uri.fsPath, file);
                if (this.shouldIndexFile(filePath)) {
                    await this.indexFile(filePath);
                }
            }

            // Dosya değişikliklerini izle
            this.startWatching(workspaceFolder);

            vscode.window.showInformationMessage('Dosya indeksleme tamamlandı.');
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            vscode.window.showErrorMessage(`İndeksleme hatası: ${errorMessage}`);
        } finally {
            this.indexingPromise = null;
        }
    }

    private shouldIndexFile(filePath: string): boolean {
        const relativePath = vscode.workspace.asRelativePath(filePath);

        // Önce include pattern'leri kontrol et
        for (const pattern of this.ignoreConfig.includePatterns) {
            if (minimatch(relativePath, pattern)) {
                return true;
            }
        }

        // Sonra exclude pattern'leri kontrol et
        for (const pattern of this.ignoreConfig.excludePatterns) {
            if (minimatch(relativePath, pattern)) {
                return false;
            }
        }

        return true;
    }

    public async indexFile(filePath: string): Promise<void> {
        try {
            if (!this.shouldIndexFile(filePath)) {
                return;
            }

            const stats = fs.statSync(filePath);
            const lastModified = stats.mtimeMs;

            // Dosya içeriğini oku
            const content = fs.readFileSync(filePath, 'utf-8');
            const language = this.getFileLanguage(filePath);

            // Veritabanını güncelle
            await this.run(
                `INSERT OR REPLACE INTO files (file_path, content, language, last_modified)
                 VALUES (?, ?, ?, ?)`,
                [filePath, content, language, lastModified]
            );
        } catch (error) {
            console.error(`Dosya indekslenirken hata: ${filePath}`, error);
        }
    }

    private startWatching(workspaceFolder: vscode.WorkspaceFolder): void {
        if (this.watcher) {
            this.watcher.close();
        }

        this.watcher = chokidar.watch('**/*', {
            cwd: workspaceFolder.uri.fsPath,
            ignored: this.ignoreConfig.excludePatterns,
            ignoreInitial: true,
            persistent: true,
            ignorePermissionErrors: true,
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100
            }
        });

        this.watcher
            .on('add', (filePath) => this.indexFile(path.join(workspaceFolder.uri.fsPath, filePath)))
            .on('change', (filePath) => this.indexFile(path.join(workspaceFolder.uri.fsPath, filePath)))
            .on('unlink', (filePath) => this.removeFile(path.join(workspaceFolder.uri.fsPath, filePath)));

        // .smileignore değişikliklerini izle
        const smileIgnorePath = path.join(workspaceFolder.uri.fsPath, '.smileignore');
        fs.watch(smileIgnorePath, async (eventType) => {
            if (eventType === 'change') {
                await this.loadSmileIgnore(workspaceFolder.uri.fsPath);
                // Yeniden indexleme başlat
                this.indexingPromise = null;
                await this.startIndexing(workspaceFolder);
            }
        });
    }

    public async removeFile(filePath: string): Promise<void> {
        const sql = 'DELETE FROM files WHERE file_path = ?';
        await this.run(sql, [filePath]);
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

    public async searchFiles(query: string): Promise<IndexedFile[]> {
        const sql = `
            SELECT * FROM files 
            WHERE content LIKE ?
        `;
        const results = await this.all(sql, [`%${query}%`]);
        return results.map(row => ({
            filePath: row.file_path,
            content: row.content,
            language: row.language,
            lastModified: row.last_modified
        }));
    }

    public async getFile(filePath: string): Promise<IndexedFile | null> {
        const sql = 'SELECT * FROM files WHERE file_path = ?';
        const row = await this.get(sql, [filePath]);
        
        if (!row) {
            return null;
        }

        return {
            filePath: row.file_path,
            content: row.content,
            language: row.language,
            lastModified: row.last_modified
        };
    }

    public async searchByWords(words: string[]): Promise<IndexedFile[]> {
        const placeholders = words.map(() => 'content LIKE ?').join(' OR ');
        const sql = `SELECT * FROM files WHERE ${placeholders}`;
        const params = words.map(word => `%${word}%`);
        
        const results = await this.all(sql, params);
        return results.map(row => ({
            filePath: row.file_path,
            content: row.content,
            language: row.language,
            lastModified: row.last_modified
        }));
    }

    public async getRelevantFiles(context: string): Promise<IndexedFile[]> {
        // Basit bir benzerlik skoru hesapla
        const words = context.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        
        if (words.length === 0) {
            return [];
        }

        const query = words.map(word => `content LIKE '%${word}%'`).join(' OR ');
        const results = await this.all(
            `SELECT file_path, content, language, last_modified,
             (${words.map(() => 'CASE WHEN content LIKE ? THEN 1 ELSE 0 END').join(' + ')}) as relevance
             FROM files
             WHERE ${query}
             ORDER BY relevance DESC
             LIMIT 10`,
            words.map(word => `%${word}%`)
        );

        return results.map(row => ({
            filePath: row.file_path,
            content: row.content,
            language: row.language,
            lastModified: row.last_modified
        }));
    }

    public dispose(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.db.close();
    }
}

export const indexService = IndexService.getInstance(); 