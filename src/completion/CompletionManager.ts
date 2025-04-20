import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';
import { CodeCompletionProvider } from './CodeCompletionProvider';
import { InlineCompletionProvider } from './InlineCompletionProvider';

/**
 * Manages code completion features including IntelliSense and inline completions
 */
export class CompletionManager {
    private codeCompletionProvider: CodeCompletionProvider;
    private inlineCompletionProvider: InlineCompletionProvider;
    private context: vscode.ExtensionContext;
    private codeCompletionDisposable: vscode.Disposable | undefined;
    private inlineCompletionDisposable: vscode.Disposable | undefined;
    private isEnabled: boolean = false;
    private isInlineEnabled: boolean = false;
    private completionConfig: any = {};
    
    constructor(aiEngine: AIEngine, codebaseIndexer: CodebaseIndexer, context: vscode.ExtensionContext) {
        this.context = context;
        this.codeCompletionProvider = new CodeCompletionProvider(aiEngine, codebaseIndexer, context);
        this.inlineCompletionProvider = new InlineCompletionProvider(aiEngine, codebaseIndexer, context);
        
        // Set self as reference
        this.codeCompletionProvider.setCompletionManager(this);
        this.inlineCompletionProvider.setCompletionManager(this);
        
        // Initialize based on configuration
        this.updateFromConfig();
        
        // Explicitly enable providers based on configuration
        const config = vscode.workspace.getConfiguration('smile-ai');
        const behavior = config.get('behavior') as any || {};
        
        if (behavior.autoComplete !== false) {
            this.enableCodeCompletion();
        }
        
        if (behavior.inlineCompletion !== false) {
            this.enableInlineCompletion();
        }
        
        console.log('Smile AI: CompletionManager initialized');
        console.log('Smile AI: Code completion is ' + (this.isEnabled ? 'enabled' : 'disabled'));
        console.log('Smile AI: Inline completion is ' + (this.isInlineEnabled ? 'enabled' : 'disabled'));
        
        // Listen for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('smile-ai.behavior') || e.affectsConfiguration('smile-ai.completion')) {
                    this.updateFromConfig();
                }
            })
        );
    }

    /**
     * Update the completion providers based on the current configuration
     */
    public updateFromConfig(): void {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const behavior = config.get('behavior') as any || {};
        
        console.log('Smile AI: Updating from config', { behavior });
        
        const autoCompleteEnabled = behavior.autoComplete !== false;
        const inlineCompletionEnabled = behavior.inlineCompletion !== false;
        
        console.log('Smile AI: Configuration - autoComplete:', autoCompleteEnabled, 'inlineCompletion:', inlineCompletionEnabled);
        
        // Update completion config
        this.completionConfig = config.get('completion') as any || {};
        console.log('Smile AI: Completion config:', this.completionConfig);
        
        // Update code completion provider
        if (autoCompleteEnabled !== this.isEnabled) {
            console.log('Smile AI: Need to update code completion status - was:', this.isEnabled, 'now:', autoCompleteEnabled);
            if (autoCompleteEnabled) {
                this.enableCodeCompletion();
            } else {
                this.disableCodeCompletion();
            }
        }
        
        // Update inline completion provider
        if (inlineCompletionEnabled !== this.isInlineEnabled) {
            console.log('Smile AI: Need to update inline completion status - was:', this.isInlineEnabled, 'now:', inlineCompletionEnabled);
            if (inlineCompletionEnabled) {
                this.enableInlineCompletion();
            } else {
                this.disableInlineCompletion();
            }
        }
    }

    /**
     * Get current completion configuration
     */
    public getCompletionConfig(): any {
        return {
            maxTokens: this.completionConfig.maxTokens || 100,
            temperature: this.completionConfig.temperature || 0.2,
            debounceTime: this.completionConfig.debounceTime || 300
        };
    }

    /**
     * Enable code completion (IntelliSense suggestions)
     */
    public enableCodeCompletion(): void {
        if (!this.codeCompletionDisposable) {
            // Define a broader language selector to support more file types
            const languageSelector: vscode.DocumentSelector = [
                { scheme: 'file' },
                { scheme: 'untitled' },
                // Add specific language IDs that should be supported
                { language: 'typescript' },
                { language: 'javascript' },
                { language: 'typescriptreact' },
                { language: 'javascriptreact' },
                { language: 'html' },
                { language: 'css' },
                { language: 'json' },
                { language: 'python' },
                { language: 'csharp' },
                { language: 'java' },
                { language: 'go' },
                { language: 'rust' },
                { language: 'php' }
            ];
            
            const triggerCharacters = ['.', '(', '[', '{', '<', ' '];
            
            // Log supported languages
            const supportedLanguages = languageSelector
                .filter((selector): selector is vscode.DocumentFilter => 
                    typeof selector === 'object' && 'language' in selector)
                .map(selector => selector.language)
                .join(', ');
            
            console.log('Smile AI: Registering code completion provider for languages:', supportedLanguages);
            
            this.codeCompletionDisposable = vscode.languages.registerCompletionItemProvider(
                languageSelector,
                this.codeCompletionProvider,
                ...triggerCharacters
            );
            
            this.context.subscriptions.push(this.codeCompletionDisposable);
            this.isEnabled = true;
            
            console.log('Smile AI: Code completion enabled');
        }
    }

    /**
     * Disable code completion
     */
    public disableCodeCompletion(): void {
        if (this.codeCompletionDisposable) {
            this.codeCompletionDisposable.dispose();
            this.codeCompletionDisposable = undefined;
            this.isEnabled = false;
            
            console.log('Smile AI: Code completion disabled');
        }
    }

    /**
     * Enable inline completion (ghost text suggestions)
     */
    public enableInlineCompletion(): void {
        if (!this.inlineCompletionDisposable) {
            // Define a broader language selector to support more file types
            const languageSelector: vscode.DocumentSelector = [
                { scheme: 'file' },
                { scheme: 'untitled' },
                // Add specific language IDs that should be supported
                { language: 'typescript' },
                { language: 'javascript' },
                { language: 'typescriptreact' },
                { language: 'javascriptreact' },
                { language: 'html' },
                { language: 'css' },
                { language: 'json' },
                { language: 'python' },
                { language: 'csharp' },
                { language: 'java' },
                { language: 'go' },
                { language: 'rust' },
                { language: 'php' }
            ];
            
            // Log supported languages
            const supportedLanguages = languageSelector
                .filter((selector): selector is vscode.DocumentFilter => 
                    typeof selector === 'object' && 'language' in selector)
                .map(selector => selector.language)
                .join(', ');
            
            console.log('Smile AI: Registering inline completion provider for languages:', supportedLanguages);
            
            this.inlineCompletionDisposable = vscode.languages.registerInlineCompletionItemProvider(
                languageSelector,
                this.inlineCompletionProvider
            );
            
            this.context.subscriptions.push(this.inlineCompletionDisposable);
            this.isInlineEnabled = true;
            
            console.log('Smile AI: Inline completion enabled');
        }
    }

    /**
     * Disable inline completion
     */
    public disableInlineCompletion(): void {
        if (this.inlineCompletionDisposable) {
            this.inlineCompletionDisposable.dispose();
            this.inlineCompletionDisposable = undefined;
            this.isInlineEnabled = false;
            
            console.log('Smile AI: Inline completion disabled');
        }
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        this.disableCodeCompletion();
        this.disableInlineCompletion();
    }
} 