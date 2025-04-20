import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';
import { CompletionManager } from './CompletionManager';

/**
 * Provides AI-powered code completions in the editor
 */
export class CodeCompletionProvider implements vscode.CompletionItemProvider {
    private aiEngine: AIEngine;
    private codebaseIndexer: CodebaseIndexer;
    private completionManager: CompletionManager | undefined;

    constructor(aiEngine: AIEngine, codebaseIndexer: CodebaseIndexer, _context: vscode.ExtensionContext) {
        this.aiEngine = aiEngine;
        this.codebaseIndexer = codebaseIndexer;
    }
    
    /**
     * Set the completion manager reference
     */
    public setCompletionManager(completionManager: CompletionManager): void {
        this.completionManager = completionManager;
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList> {
        try {
            console.log(`Smile AI: Providing code completions for ${document.fileName}`);
            
            // Get current line up to cursor position
            const linePrefix = document.lineAt(position.line).text.substring(0, position.character);
            console.log(`Smile AI: Line prefix: "${linePrefix}"`);
            
            // Skip if line is empty or within a comment
            if (!linePrefix.trim()) {
                console.log('Smile AI: Empty line, skipping completion');
                return [];
            }
            
            if (this.isInComment(document, position)) {
                console.log('Smile AI: In comment, skipping completion');
                return [];
            }

            // Get context from the current file
            const fileContext = this.getFileContext(document, position);
            
            // Get completion settings
            const config = this.completionManager ? 
                this.completionManager.getCompletionConfig() : 
                { maxTokens: 100, temperature: 0.2 };
            
            console.log('Smile AI: Requesting completion with config:', config);
            
            // Create prompt for the AI model
            const prompt = `Complete the following code. Only give me the completion, not the entire line:
File: ${document.fileName}
Current line: ${linePrefix}

${fileContext}

Provide at most 3 concise completions that would help finish the current code construct.`;

            // Get AI-generated completions
            console.log('Smile AI: Sending completion request to AI model');
            const completionResponse = await this.aiEngine.processMessage(prompt, {
                options: {
                    mode: 'completion',
                    temperature: config.temperature,
                    maxTokens: config.maxTokens
                },
                codebaseIndex: this.codebaseIndexer
            });

            console.log(`Smile AI: Received completion response: ${completionResponse.substring(0, 100)}...`);
            
            // Parse the completions from the response
            const completions = this.parseCompletions(completionResponse, linePrefix);
            console.log(`Smile AI: Generated ${completions.length} completion items`);
            
            return completions;
        } catch (error) {
            console.error('Error providing code completions:', error);
            return [];
        }
    }

    resolveCompletionItem(
        item: vscode.CompletionItem, 
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CompletionItem> {
        // Could add additional information to the item when selected
        return item;
    }

    private parseCompletions(
        completionText: string,
        linePrefix: string
    ): vscode.CompletionItem[] {
        // Remove any markdown code block indicators
        completionText = completionText.replace(/```[\w]*\n/g, '').replace(/```/g, '');
        
        // Split completions if multiple options are provided
        const completions = completionText.split('\n').filter(line => line.trim().length > 0);
        
        return completions.map(completion => {
            const item = new vscode.CompletionItem(completion, vscode.CompletionItemKind.Text);
            item.insertText = completion;
            
            // Try to determine if this is a method/function, property, or class
            if (completion.includes('(')) {
                item.kind = vscode.CompletionItemKind.Method;
            } else if (completion.startsWith('class ') || completion.startsWith('interface ')) {
                item.kind = vscode.CompletionItemKind.Class;
            } else if (linePrefix.endsWith('.')) {
                item.kind = vscode.CompletionItemKind.Property;
            }
            
            item.detail = 'Smile AI';
            item.documentation = new vscode.MarkdownString('AI-suggested completion');
            
            return item;
        });
    }

    private getFileContext(document: vscode.TextDocument, position: vscode.Position): string {
        // Get surrounding code for context (limit to 1000 characters)
        const maxLines = 50;
        const startLine = Math.max(0, position.line - maxLines);
        const endLine = Math.min(document.lineCount - 1, position.line + maxLines);

        let context = '';
        for (let i = startLine; i <= endLine; i++) {
            context += document.lineAt(i).text + '\n';
        }
        
        // Add imports if they exist
        let imports = '';
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            if (line.startsWith('import ') || line.startsWith('from ')) {
                imports += line + '\n';
            }
        }

        if (imports) {
            context = 'Imports:\n' + imports + '\nCode:\n' + context;
        }
        
        return context;
    }

    private isInComment(document: vscode.TextDocument, position: vscode.Position): boolean {
        // Simple check for comments
        const line = document.lineAt(position.line).text;
        const textBeforeCursor = line.substring(0, position.character);
        
        // Check for single line comments
        if (textBeforeCursor.includes('//') || textBeforeCursor.trim().startsWith('#')) {
            return true;
        }
        
        // This is a simplified check and may not catch all comment types
        return false;
    }
} 