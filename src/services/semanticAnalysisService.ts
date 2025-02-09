import * as vscode from 'vscode';
import { TypeScriptAnalyzer } from './analyzers/typescriptAnalyzer';
import { PythonAnalyzer } from './analyzers/pythonAnalyzer';
import { JavaAnalyzer } from './analyzers/javaAnalyzer';
import { CSharpAnalyzer } from './analyzers/csharpAnalyzer';
import { CppAnalyzer } from './analyzers/cppAnalyzer';
import { GoAnalyzer } from './analyzers/goAnalyzer';
import { RustAnalyzer } from './analyzers/rustAnalyzer';
import { PHPAnalyzer } from './analyzers/phpAnalyzer';
import { RubyAnalyzer } from './analyzers/rubyAnalyzer';
import { AngularAnalyzer } from './analyzers/angularAnalyzer';
import { ReactAnalyzer } from './analyzers/reactAnalyzer';
import { VueAnalyzer } from './analyzers/vueAnalyzer';
import { SvelteAnalyzer } from './analyzers/svelteAnalyzer';
import { ExpressAnalyzer } from './analyzers/expressAnalyzer';
import { LanguageAnalyzer, AnalysisResult } from './types/analysis';
import { NestAnalyzer } from './analyzers/nestAnalyzer';
import { SpringBootAnalyzer } from './analyzers/springBootAnalyzer';
import { DjangoAnalyzer } from './analyzers/djangoAnalyzer';
import { LaravelAnalyzer } from './analyzers/laravelAnalyzer';
import { RailsAnalyzer } from './analyzers/railsAnalyzer';

export class SemanticAnalysisService {
    private static instance: SemanticAnalysisService;
    private analyzers: Map<string, LanguageAnalyzer> = new Map();
    private disposables: vscode.Disposable[] = [];

    private constructor() {
        this.registerEventHandlers();
        this.initializeAnalyzers();
    }

    public static getInstance(): SemanticAnalysisService {
        if (!SemanticAnalysisService.instance) {
            SemanticAnalysisService.instance = new SemanticAnalysisService();
        }
        return SemanticAnalysisService.instance;
    }

    private registerEventHandlers(): void {
        // Dosya değişikliklerini izle
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                this.invalidateAnalysis(e.document.uri.fsPath);
            })
        );
    }

    private invalidateAnalysis(filePath: string): void {
        this.analyzers.forEach(analyzer => analyzer.dispose());
        this.analyzers.clear();
        this.initializeAnalyzers();
    }

    private initializeAnalyzers(): void {
        // TypeScript/JavaScript için aynı analyzer'ı kullan
        const tsAnalyzer = new TypeScriptAnalyzer();
        this.analyzers.set('typescript', tsAnalyzer);
        this.analyzers.set('javascript', tsAnalyzer);
        
        // Python analyzer'ı ekle
        const pythonAnalyzer = new PythonAnalyzer();
        this.analyzers.set('python', pythonAnalyzer);
        this.analyzers.set('django', pythonAnalyzer);
        this.analyzers.set('django-python', pythonAnalyzer);

        // Java analyzer'ı ekle
        this.analyzers.set('java', new JavaAnalyzer());

        // C# analyzer'ı ekle
        this.analyzers.set('csharp', new CSharpAnalyzer());

        // C/C++ analyzer'ı ekle
        const cppAnalyzer = new CppAnalyzer();
        this.analyzers.set('cpp', cppAnalyzer);
        this.analyzers.set('c', cppAnalyzer);

        // Go analyzer'ı ekle
        this.analyzers.set('go', new GoAnalyzer());

        // Rust analyzer'ı ekle
        this.analyzers.set('rust', new RustAnalyzer());

        // PHP analyzer'ı ekle
        const phpAnalyzer = new PHPAnalyzer();
        this.analyzers.set('php', phpAnalyzer);

        // Ruby analyzer'ı ekle
        const rubyAnalyzer = new RubyAnalyzer();
        this.analyzers.set('ruby', rubyAnalyzer);

        // Angular analyzer'ı ekle
        const angularAnalyzer = new AngularAnalyzer();
        this.analyzers.set('angular-ts', angularAnalyzer);
        this.analyzers.set('angular-html', angularAnalyzer);
        this.analyzers.set('angular-css', angularAnalyzer);

        // React analyzer'ı ekle
        const reactAnalyzer = new ReactAnalyzer();
        this.analyzers.set('react-ts', reactAnalyzer);
        this.analyzers.set('react-jsx', reactAnalyzer);
        this.analyzers.set('react-tsx', reactAnalyzer);

        // Vue.js analyzer'ı ekle
        const vueAnalyzer = new VueAnalyzer();
        this.analyzers.set('vue', vueAnalyzer);
        this.analyzers.set('vue-html', vueAnalyzer);
        this.analyzers.set('vue-css', vueAnalyzer);
        this.analyzers.set('vue-ts', vueAnalyzer);
        this.analyzers.set('vue-js', vueAnalyzer);

        // Svelte analyzer'ı ekle
        const svelteAnalyzer = new SvelteAnalyzer();
        this.analyzers.set('svelte', svelteAnalyzer);
        this.analyzers.set('svelte-ts', svelteAnalyzer);
        this.analyzers.set('svelte-js', svelteAnalyzer);

        // Express.js analyzer'ı ekle
        const expressAnalyzer = new ExpressAnalyzer();
        this.analyzers.set('javascript', expressAnalyzer);
        this.analyzers.set('typescript', expressAnalyzer);
        this.analyzers.set('express', expressAnalyzer);
        this.analyzers.set('node', expressAnalyzer);

        // NestJS analyzer'ı ekle
        const nestAnalyzer = new NestAnalyzer();
        this.analyzers.set('typescript', nestAnalyzer);
        this.analyzers.set('javascript', nestAnalyzer);
        this.analyzers.set('nest', nestAnalyzer);
        this.analyzers.set('nestjs', nestAnalyzer);

        // Spring Boot analyzer'ı ekle
        const springAnalyzer = new SpringBootAnalyzer();
        this.analyzers.set('java', springAnalyzer);
        this.analyzers.set('spring', springAnalyzer);
        this.analyzers.set('spring-boot', springAnalyzer);

        // Django analyzer'ı ekle
        const djangoAnalyzer = new DjangoAnalyzer();
        this.analyzers.set('python', djangoAnalyzer);
        this.analyzers.set('django', djangoAnalyzer);
        this.analyzers.set('django-python', djangoAnalyzer);

        // Laravel analyzer'ı ekle
        const laravelAnalyzer = new LaravelAnalyzer();
        this.analyzers.set('php', laravelAnalyzer);
        this.analyzers.set('laravel', laravelAnalyzer);
        this.analyzers.set('blade', laravelAnalyzer);

        // Ruby on Rails analyzer'ı ekle
        const railsAnalyzer = new RailsAnalyzer();
        this.analyzers.set('ruby', railsAnalyzer);
        this.analyzers.set('rails', railsAnalyzer);
        this.analyzers.set('erb', railsAnalyzer);
    }

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const analyzer = this.analyzers.get(document.languageId);
        if (!analyzer) {
            throw new Error(`Desteklenmeyen dil: ${document.languageId}`);
        }
        return await analyzer.analyzeFile(document);
    }

    public getSupportedLanguages(): string[] {
        return Array.from(this.analyzers.keys());
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.analyzers.forEach(analyzer => analyzer.dispose());
        this.analyzers.clear();
    }
}

export const semanticAnalysisService = SemanticAnalysisService.getInstance(); 