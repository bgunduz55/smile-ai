import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';
import { CompletionManager } from './CompletionManager';

/**
 * Provides inline code completions (like GitHub Copilot)
 */
export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private aiEngine: AIEngine;
    private codebaseIndexer: CodebaseIndexer;
    private completionManager: CompletionManager | undefined;
    
    constructor(aiEngine: AIEngine, codebaseIndexer: CodebaseIndexer, _context: vscode.ExtensionContext) {
        this.aiEngine = aiEngine;
        this.codebaseIndexer = codebaseIndexer;
        // No need to store context since it's not used
    }
    
    /**
     * Set the completion manager reference
     */
    public setCompletionManager(completionManager: CompletionManager): void {
        this.completionManager = completionManager;
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
        try {
            console.log(`Smile AI: Providing inline completions for ${document.fileName}`);
            
            // Skip if within comments
            if (this.isInComment(document, position)) {
                console.log('Smile AI: In comment, skipping inline completion');
                return null;
            }

            // Get file context
            const fileContext = this.getFileContext(document, position);
            
            // Get completion settings
            const config = this.completionManager ? 
                this.completionManager.getCompletionConfig() : 
                { maxTokens: 200, temperature: 0.2 };
            
            console.log('Smile AI: Requesting inline completion with config:', config);
            
            // Create prompt for the AI
            const prompt = `Complete the following code. Only provide the completion, not the entire code snippet.
File: ${document.fileName}
Current cursor position: Line ${position.line + 1}, Column ${position.character + 1}

${fileContext}

Provide a concise and accurate continuation of the code, not more than 5-10 lines.`;

            // Get completions from the AI model
            console.log('Smile AI: Sending inline completion request to AI model');
            const completionResponse = await this.aiEngine.processMessage(prompt, {
                options: {
                    mode: 'completion',
                    temperature: config.temperature,
                    maxTokens: config.maxTokens
                },
                codebaseIndex: this.codebaseIndexer
            });

            if (!completionResponse || token.isCancellationRequested) {
                console.log('Smile AI: No inline completion response or request cancelled');
                return null;
            }

            console.log(`Smile AI: Received inline completion response: ${completionResponse.substring(0, 100)}...`);
            
            // Parse the response into inline completion items
            const items = this.parseInlineCompletions(completionResponse, position);
            console.log(`Smile AI: Generated ${items.length} inline completion items`);
            
            return items;
        } catch (error) {
            console.error('Error providing inline completions:', error);
            return null;
        }
    }

    private parseInlineCompletions(
        completionText: string,
        position: vscode.Position
    ): vscode.InlineCompletionItem[] {
        // Clean up the response
        completionText = completionText.replace(/```[\w]*\n/g, '').replace(/```/g, '');
        
        // Create a single inline completion item
        const item = new vscode.InlineCompletionItem(completionText, new vscode.Range(position, position));
        
        return [item];
    }

    private getFileContext(document: vscode.TextDocument, position: vscode.Position): string {
        // Get the lines before the cursor position
        const maxLinesBefore = 30;
        const startLine = Math.max(0, position.line - maxLinesBefore);
        
        let beforeContext = '';
        for (let i = startLine; i <= position.line; i++) {
            let lineText = document.lineAt(i).text;
            if (i === position.line) {
                // Only include text up to the cursor position
                lineText = lineText.substring(0, position.character);
            }
            beforeContext += lineText + '\n';
        }

        // Add some lines after the cursor position for context
        const maxLinesAfter = 10;
        const endLine = Math.min(document.lineCount - 1, position.line + maxLinesAfter);
        
        let afterContext = '';
        for (let i = position.line; i <= endLine; i++) {
            // Skip the current line as it's already included in beforeContext
            if (i === position.line) {
                continue;
            }
            afterContext += document.lineAt(i).text + '\n';
        }
        
        // Add imports for additional context
        let imports = '';
        for (let i = 0; i < Math.min(document.lineCount, 50); i++) {
            const line = document.lineAt(i).text;
            if (line.startsWith('import ') || line.startsWith('from ')) {
                imports += line + '\n';
            }
        }

        // Construct the full context
        let fullContext = '';
        if (imports) {
            fullContext += 'Imports:\n' + imports + '\n';
        }
        
        fullContext += 'Code before cursor:\n' + beforeContext;
        
        if (afterContext) {
            fullContext += 'Code after cursor:\n' + afterContext;
        }
        
        return fullContext;
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