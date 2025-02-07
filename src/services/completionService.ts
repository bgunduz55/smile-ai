import * as vscode from 'vscode';
import { aiService } from './aiService';
import { indexService } from './indexService';
import { CompletionContext } from '../types';

export class CompletionService {
    private enabled: boolean = false;
    private disposable: vscode.Disposable | undefined;

    constructor() {
        this.enabled = false;
    }

    public registerCompletionProvider(): vscode.Disposable {
        this.disposable = vscode.languages.registerCompletionItemProvider(
            ['typescript', 'javascript', 'python'],
            {
                provideCompletionItems: async (document, position, token, context) => {
                    if (!this.enabled) {
                        return [];
                    }

                    const completionContext: CompletionContext = {
                        document,
                        position,
                        token,
                        context
                    };

                    return this.generateCompletionItems(completionContext);
                }
            },
            '.', '(', '{', '[', '<', ' ', '\n'
        );
        return this.disposable;
    }

    public toggleCompletion(): void {
        this.enabled = !this.enabled;
        vscode.window.showInformationMessage(
            `Code completion is now ${this.enabled ? 'enabled' : 'disabled'}`
        );
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public async generateCompletionItems(context: CompletionContext): Promise<vscode.CompletionItem[]> {
        if (context.token.isCancellationRequested) {
            return [];
        }

        const line = context.document.lineAt(context.position.line).text;
        const wordRange = context.document.getWordRangeAtPosition(context.position);
        
        if (!wordRange) {
            return [];
        }

        const word = context.document.getText(wordRange);
        if (word.length < 2) {
            return [];
        }

        try {
            const fileContent = context.document.getText();
            const relevantFiles = await indexService.getRelevantFiles(fileContent);
            const prompt = this.buildCompletionPrompt(word, line, fileContent, relevantFiles);
            
            const suggestions = await aiService.generateCode(prompt);
            return this.parseSuggestions(suggestions);
        } catch (error) {
            console.error('Error generating completion items:', error);
            return [];
        }
    }

    private buildCompletionPrompt(word: string, line: string, fileContent: string, relevantFiles: any[]): string {
        return `Generate code completion suggestions for:
            Word: ${word}
            Line: ${line}
            File Content: ${fileContent}
            Related Files: ${JSON.stringify(relevantFiles)}`;
    }

    private parseSuggestions(suggestions: string): vscode.CompletionItem[] {
        try {
            const items: vscode.CompletionItem[] = [];
            const lines = suggestions.split('\n');

            for (const line of lines) {
                if (line.trim()) {
                    const item = new vscode.CompletionItem(line.trim(), vscode.CompletionItemKind.Method);
                    item.detail = 'AI Suggestion';
                    items.push(item);
                }
            }

            return items;
        } catch (error) {
            console.error('Error parsing suggestions:', error);
            return [];
        }
    }

    public dispose() {
        if (this.disposable) {
            this.disposable.dispose();
        }
    }
} 