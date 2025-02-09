import * as vscode from 'vscode';
import { AIService } from '../aiService';
// import { LlamaService } from './llamaService';
import { OllamaService } from './ollamaService';
import { AgentTask, TaskResult } from './types';
import { suggestionService } from '../suggestionService';
import { SuggestionItem } from '../suggestionService';

export class AgentService {
    private static instance: AgentService;
    private aiService: AIService;
    // private llamaService: LlamaService;
    private ollamaService: OllamaService;
    private disposables: vscode.Disposable[] = [];
    private statusBarItem: vscode.StatusBarItem;

    private constructor() {
        this.aiService = AIService.getInstance();
        // this.llamaService = new LlamaService();
        this.ollamaService = new OllamaService();
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.statusBarItem.text = "$(hubot) Smile AI";
        this.statusBarItem.tooltip = "Smile AI Agent";
        this.statusBarItem.show();
    }

    public static getInstance(): AgentService {
        if (!AgentService.instance) {
            AgentService.instance = new AgentService();
        }
        return AgentService.instance;
    }

    public async initialize(): Promise<void> {
        try {
            // await this.llamaService.initialize();
            this.registerCommands();
            this.statusBarItem.text = "$(check) Smile AI";
        } catch (error) {
            this.statusBarItem.text = "$(error) Smile AI";
            throw error;
        }
    }

    private registerCommands(): void {
        // Register all agent-related commands
        this.disposables.push(
            vscode.commands.registerCommand('smile-ai.executeTask', async (task: AgentTask) => {
                return await this.ollamaService.processTask(task);
            })
        );
    }

    private async handleCodeCompletion(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        const context = this.getCodeContext(document, position);
        
        const task: AgentTask = {
            type: 'code_completion' as const,
            input: document.getText(editor.selection),
            context,
            constraints: {
                language: document.languageId,
                maxLength: 1000
            }
        };

        await this.executeTask(task);
    }

    private async handleCodeAnalysis(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const task: AgentTask = {
            type: 'code_analysis' as const,
            input: 'Analyze the following code for quality, potential issues, and improvements',
            context: document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        const result = await this.executeTask(task);
        
        // Analiz sonucunda bulunan geliştirme önerilerini kaydet
        if (result.success) {
            const suggestions = this.extractSuggestionsFromAnalysis(result.output, document);
            for (const suggestion of suggestions) {
                await suggestionService.addSuggestion(suggestion);
            }
        }
    }

    private extractSuggestionsFromAnalysis(analysis: string, document: vscode.TextDocument): Array<Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>> {
        const suggestions: Array<Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>> = [];
        
        // Analiz metnini satırlara böl
        const lines = analysis.split('\n');
        let currentSuggestion: Partial<Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>> | null = null;
        const editor = vscode.window.activeTextEditor;

        for (const line of lines) {
            // Yeni bir öneri başlangıcını kontrol et
            if (line.includes('SUGGESTION:') || line.includes('IMPROVEMENT:') || line.includes('TODO:')) {
                // Önceki öneriyi kaydet
                if (currentSuggestion?.title && currentSuggestion.description) {
                    suggestions.push(currentSuggestion as Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>);
                }

                // Yeni öneri başlat
                currentSuggestion = {
                    type: line.toLowerCase().includes('todo') ? 'todo' : 'improvement',
                    title: line.split(':')[1]?.trim() || 'Unnamed Suggestion',
                    description: '',
                    priority: 'medium',
                    status: 'pending',
                    context: {
                        language: document.languageId,
                        framework: this.detectFramework(document),
                        codeSnippet: editor?.selection ? document.getText(editor.selection) : undefined
                    },
                    tags: []
                };
            } else if (currentSuggestion && line.trim()) {
                // Mevcut öneriye açıklama ekle
                currentSuggestion.description += line.trim() + '\n';

                // Öncelik belirle
                if (line.toLowerCase().includes('critical') || line.toLowerCase().includes('high priority')) {
                    currentSuggestion.priority = 'high';
                } else if (line.toLowerCase().includes('low priority')) {
                    currentSuggestion.priority = 'low';
                }

                // Etiketleri çıkar
                const tags = line.match(/#\w+/g);
                if (tags) {
                    currentSuggestion.tags = [...new Set([...(currentSuggestion.tags || []), ...tags.map(t => t.slice(1))])];
                }
            }
        }

        // Son öneriyi ekle
        if (currentSuggestion?.title && currentSuggestion.description) {
            suggestions.push(currentSuggestion as Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>);
        }

        return suggestions;
    }

    private detectFramework(document: vscode.TextDocument): string | undefined {
        const content = document.getText().toLowerCase();
        const frameworks = {
            'react': ['react', 'jsx', 'createelement'],
            'angular': ['@angular', 'component', 'ngmodule'],
            'vue': ['vue', 'createapp', 'definecomponent'],
            'express': ['express', 'app.get', 'app.post'],
            'nest': ['@nestjs', 'injectable', 'controller'],
            'django': ['django', 'models.model', 'views.view'],
            'flask': ['flask', 'blueprint', 'route'],
            'spring': ['@springbootapplication', '@controller', '@service'],
            'laravel': ['illuminate', 'artisan', 'eloquent'],
            'rails': ['activerecord', 'actioncontroller', 'railties']
        };

        for (const [framework, patterns] of Object.entries(frameworks)) {
            if (patterns.some(pattern => content.includes(pattern))) {
                return framework;
            }
        }

        return undefined;
    }

    private async handleCodeGeneration(): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: 'Ne tür bir kod üretmek istersiniz?',
            placeHolder: 'Örn: Bir REST API endpoint\'i oluştur'
        });

        if (!input) return;

        const task: AgentTask = {
            type: 'code_generation' as const,
            input,
            constraints: {
                language: await this.promptForLanguage()
            }
        };

        await this.executeTask(task);
    }

    private async handleDocGeneration(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const task: AgentTask = {
            type: 'documentation' as const,
            input: 'Generate comprehensive documentation for the following code',
            context: document.getText(editor.selection) || document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        await this.executeTask(task);
    }

    private async handleTestGeneration(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const task: AgentTask = {
            type: 'test_generation' as const,
            input: 'Generate comprehensive test cases for the following code',
            context: document.getText(editor.selection) || document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        const result = await this.executeTask(task);

        // Test eksikliklerini öneri olarak kaydet
        if (result.success) {
            const suggestions = this.extractTestSuggestions(result.output, document);
            for (const suggestion of suggestions) {
                await suggestionService.addSuggestion(suggestion);
            }
        }
    }

    private extractTestSuggestions(output: string, document: vscode.TextDocument): Array<Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>> {
        const suggestions: Array<Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>> = [];
        
        // Test önerilerini çıkar
        const testCases = output.split('\n\n').filter(block => 
            block.toLowerCase().includes('test') || 
            block.toLowerCase().includes('should') ||
            block.toLowerCase().includes('scenario')
        );

        for (const testCase of testCases) {
            suggestions.push({
                type: 'todo',
                title: `Add Test: ${testCase.split('\n')[0].trim()}`,
                description: testCase,
                priority: 'medium',
                status: 'pending',
                context: {
                    language: document.languageId,
                    framework: this.detectFramework(document),
                    codeSnippet: testCase
                },
                tags: ['test', 'automation', document.languageId]
            });
        }

        return suggestions;
    }

    private async handleRefactoring(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const task: AgentTask = {
            type: 'refactoring' as const,
            input: 'Refactor the following code to improve its quality and maintainability',
            context: document.getText(editor.selection) || document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        const result = await this.executeTask(task);

        // Refactoring önerilerini kaydet
        if (result.success) {
            const suggestions = this.extractRefactoringSuggestions(result.output, document);
            for (const suggestion of suggestions) {
                await suggestionService.addSuggestion(suggestion);
            }
        }
    }

    private extractRefactoringSuggestions(output: string, document: vscode.TextDocument): Array<Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>> {
        const suggestions: Array<Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>> = [];
        const editor = vscode.window.activeTextEditor;
        
        // Refactoring önerilerini çıkar
        const patterns = [
            { regex: /REFACTOR:([^\n]+)/g, type: 'improvement' },
            { regex: /SUGGESTION:([^\n]+)/g, type: 'improvement' },
            { regex: /TODO:([^\n]+)/g, type: 'todo' }
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.regex.exec(output)) !== null) {
                const title = match[1].trim();
                const nextNewline = output.indexOf('\n', match.index + match[0].length);
                const description = output.slice(match.index + match[0].length, nextNewline > -1 ? nextNewline : undefined).trim();

                suggestions.push({
                    type: pattern.type as 'improvement' | 'todo',
                    title,
                    description,
                    priority: title.toLowerCase().includes('critical') ? 'high' : 'medium',
                    status: 'pending',
                    context: {
                        language: document.languageId,
                        framework: this.detectFramework(document),
                        codeSnippet: editor?.selection ? document.getText(editor.selection) : undefined
                    },
                    tags: ['refactoring', document.languageId]
                });
            }
        }

        return suggestions;
    }

    private async handleBugFix(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Lütfen bir dosya açın');
            return;
        }

        const document = editor.document;
        const description = await vscode.window.showInputBox({
            prompt: 'Hatayı açıklayın',
            placeHolder: 'Örn: Fonksiyon beklendiği gibi çalışmıyor'
        });

        if (!description) return;

        const task: AgentTask = {
            type: 'bug_fix' as const,
            input: description,
            context: document.getText(editor.selection) || document.getText(),
            constraints: {
                language: document.languageId
            }
        };

        const result = await this.executeTask(task);

        // Bulunan hataları ve çözüm önerilerini kaydet
        if (result.success) {
            const suggestions = this.extractBugFixSuggestions(result.output, document);
            for (const suggestion of suggestions) {
                await suggestionService.addSuggestion(suggestion);
            }
        }
    }

    private extractBugFixSuggestions(output: string, document: vscode.TextDocument): Array<Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>> {
        const suggestions: Array<Omit<SuggestionItem, 'id' | 'createdAt' | 'updatedAt'>> = [];
        const editor = vscode.window.activeTextEditor;
        
        // Bug fix önerilerini çıkar
        const patterns = [
            { regex: /BUG:([^\n]+)/g, priority: 'high' as const },
            { regex: /FIX:([^\n]+)/g, priority: 'high' as const },
            { regex: /ISSUE:([^\n]+)/g, priority: 'medium' as const }
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.regex.exec(output)) !== null) {
                const title = match[1].trim();
                const nextNewline = output.indexOf('\n', match.index + match[0].length);
                const description = output.slice(match.index + match[0].length, nextNewline > -1 ? nextNewline : undefined).trim();

                suggestions.push({
                    type: 'todo',
                    title: `Fix: ${title}`,
                    description,
                    priority: pattern.priority,
                    status: 'pending',
                    context: {
                        language: document.languageId,
                        framework: this.detectFramework(document),
                        codeSnippet: editor?.selection ? document.getText(editor.selection) : undefined
                    },
                    tags: ['bug', 'fix', document.languageId]
                });
            }
        }

        return suggestions;
    }

    private getCodeContext(document: vscode.TextDocument, position: vscode.Position): string {
        // Get relevant code context around the cursor position
        const startLine = Math.max(0, position.line - 10);
        const endLine = Math.min(document.lineCount, position.line + 10);
        
        return document.getText(new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine, 0)
        ));
    }

    private async promptForLanguage(): Promise<string> {
        const languages = ['typescript', 'javascript', 'python'];
        const selected = await vscode.window.showQuickPick(languages, {
            placeHolder: 'Programlama dilini seçin'
        });
        return selected || 'typescript';
    }

    private async executeTask(task: AgentTask): Promise<TaskResult> {
        this.statusBarItem.text = "$(sync~spin) Smile AI";
        
        try {
            // const result = await this.llamaService.executeTask(task);
            await this.handleTaskResult({
                success: true,
                output: '',
                error: '',
                metadata: {
                    tokensUsed: 0,
                    executionTime: 0,
                    modelName: 'unknown'
                }
            });
            return {
                success: true,
                output: '',
                error: '',
                metadata: {
                    tokensUsed: 0,
                    executionTime: 0,
                    modelName: 'unknown'
                }
            };
        } catch (error) {
            vscode.window.showErrorMessage(
                error instanceof Error ? error.message : 'Görev yürütülürken bir hata oluştu'
            );
            return {
                success: false,
                output: '',
                error: error instanceof Error ? error.message : 'Unknown error occurred',
                metadata: {
                    tokensUsed: 0,
                    executionTime: 0,
                    modelName: 'unknown'
                }
            };
        } finally {
            this.statusBarItem.text = "$(hubot) Smile AI";
        }
    }

    private async handleTaskResult(result: TaskResult): Promise<void> {
        if (!result.success) {
            vscode.window.showErrorMessage(`Hata: ${result.error}`);
            return;
        }

        // Create or show output channel
        const channel = vscode.window.createOutputChannel('Smile AI');
        channel.clear();
        
        // Add metadata
        if (result.metadata) {
            channel.appendLine('--- Metadata ---');
            channel.appendLine(`Model: ${result.metadata.modelName}`);
            channel.appendLine(`Execution Time: ${result.metadata.executionTime}ms`);
            channel.appendLine(`Tokens Used: ${result.metadata.tokensUsed}`);
            channel.appendLine('---------------\n');
        }

        // Add result
        channel.appendLine(result.output);
        channel.show();
    }

    public dispose(): void {
        // this.llamaService.dispose();
        this.statusBarItem.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.ollamaService.dispose();
    }
} 