import * as vscode from 'vscode';
import * as path from 'path';
import { CodeAnalysis } from './CodeAnalyzer';

export interface FileContext {
    path: string;
    content: string;
    language: string;
    framework?: string;
    fileType: FileType;
    projectType?: ProjectType;
    dependencies?: string[];
    imports?: string[];
    analysis?: CodeAnalysis;
}

export enum FileType {
    SOURCE = 'SOURCE',
    TEST = 'TEST',
    CONFIG = 'CONFIG',
    DOCUMENTATION = 'DOCUMENTATION',
    STYLE = 'STYLE',
    RESOURCE = 'RESOURCE',
    UNKNOWN = 'UNKNOWN'
}

export enum ProjectType {
    NODE = 'NODE',
    PYTHON = 'PYTHON',
    JAVA = 'JAVA',
    DOTNET = 'DOTNET',
    WEB = 'WEB',
    UNKNOWN = 'UNKNOWN'
}

export class FileAnalyzer {
    private static instance: FileAnalyzer;
    private projectContext: Map<string, FileContext>;

    private constructor() {
        this.projectContext = new Map();
    }

    public static getInstance(): FileAnalyzer {
        if (!FileAnalyzer.instance) {
            FileAnalyzer.instance = new FileAnalyzer();
        }
        return FileAnalyzer.instance;
    }

    public async analyzeFile(uri: vscode.Uri): Promise<FileContext> {
        const filePath = uri.fsPath;
        const extension = path.extname(filePath);
        const fileName = path.basename(filePath);

        // Önce cache'e bakalım
        const cached = this.projectContext.get(filePath);
        if (cached) return cached;

        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();

        const context: FileContext = {
            path: filePath,
            content,
            language: this.detectLanguage(extension, content),
            fileType: this.detectFileType(fileName, extension, content),
            framework: this.detectFramework(content),
            dependencies: this.detectDependencies(content),
            imports: this.extractImports(content)
        };

        // Projenin tipini belirle
        context.projectType = await this.detectProjectType(uri);

        // Context'i cache'le
        this.projectContext.set(filePath, context);

        return context;
    }

    private detectLanguage(extension: string, content: string): string {
        // Dosya uzantısına göre dil tespiti
        const languageMap: Record<string, string> = {
            '.ts': 'typescript',
            '.js': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.cs': 'csharp',
            '.cpp': 'cpp',
            '.html': 'html',
            '.css': 'css',
            '.scss': 'scss',
            '.json': 'json',
            '.md': 'markdown'
        };

        return languageMap[extension.toLowerCase()] || 'plaintext';
    }

    private detectFileType(fileName: string, extension: string, content: string): FileType {
        // Test dosyaları
        if (fileName.includes('.test.') || fileName.includes('.spec.') || 
            fileName.endsWith('Test.ts') || fileName.endsWith('Tests.cs')) {
            return FileType.TEST;
        }

        // Konfigürasyon dosyaları
        if (fileName.includes('config') || extension === '.json' || 
            extension === '.yml' || extension === '.yaml') {
            return FileType.CONFIG;
        }

        // Dokümantasyon
        if (extension === '.md' || extension === '.txt') {
            return FileType.DOCUMENTATION;
        }

        // Stil dosyaları
        if (extension === '.css' || extension === '.scss' || extension === '.less') {
            return FileType.STYLE;
        }

        // Kaynak dosyaları
        if (['.png', '.jpg', '.svg', '.gif'].includes(extension)) {
            return FileType.RESOURCE;
        }

        // Varsayılan olarak kaynak kod
        return FileType.SOURCE;
    }

    private detectFramework(content: string): string | undefined {
        const frameworks = {
            react: ['react', 'jsx', 'tsx'],
            angular: ['@angular', 'ngModule'],
            vue: ['Vue', 'createApp'],
            express: ['express()', 'app.use'],
            django: ['django', 'urls.py'],
            spring: ['@SpringBootApplication', '@Autowired'],
            dotnet: ['Microsoft.AspNetCore', 'IConfiguration']
        };

        for (const [framework, patterns] of Object.entries(frameworks)) {
            if (patterns.some(pattern => content.includes(pattern))) {
                return framework;
            }
        }

        return undefined;
    }

    private detectDependencies(content: string): string[] {
        const dependencies: string[] = [];
        
        // Import/require ifadelerini analiz et
        const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;
        const requireRegex = /require\(['"](.+?)['"]\)/g;
        
        let match;
        while ((match = importRegex.exec(content)) !== null) {
            dependencies.push(match[1]);
        }
        while ((match = requireRegex.exec(content)) !== null) {
            dependencies.push(match[1]);
        }

        return [...new Set(dependencies)];
    }

    private extractImports(content: string): string[] {
        const imports: string[] = [];
        
        // Farklı dillerdeki import/using/require ifadelerini yakala
        const patterns = [
            /import\s+.*?from\s+['"](.+?)['"]/g,  // ES6 imports
            /require\(['"](.+?)['"]\)/g,           // CommonJS
            /using\s+([\w.]+);/g,                 // C#
            /import\s+([\w.]+);/g,                // Java
            /from\s+(['"].*?['"])/g,              // Python
        ];

        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                imports.push(match[1]);
            }
        });

        return [...new Set(imports)];
    }

    private async detectProjectType(uri: vscode.Uri): Promise<ProjectType> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) return ProjectType.UNKNOWN;

        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, '**/*'));
        
        // Proje tipi belirteçleri
        const indicators = {
            [ProjectType.NODE]: ['package.json', 'node_modules'],
            [ProjectType.PYTHON]: ['requirements.txt', 'setup.py', 'pyproject.toml'],
            [ProjectType.JAVA]: ['pom.xml', 'build.gradle'],
            [ProjectType.DOTNET]: ['*.csproj', '*.sln'],
            [ProjectType.WEB]: ['index.html', 'webpack.config.js', 'vite.config.js']
        };

        for (const [type, patterns] of Object.entries(indicators)) {
            for (const file of files) {
                if (patterns.some(pattern => 
                    file.fsPath.includes(pattern) || 
                    path.basename(file.fsPath).match(new RegExp(pattern.replace('*', '.*'))))) {
                    return type as ProjectType;
                }
            }
        }

        return ProjectType.UNKNOWN;
    }

    public clearCache(): void {
        this.projectContext.clear();
    }
} 