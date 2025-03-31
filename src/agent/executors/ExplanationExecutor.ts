import * as vscode from 'vscode';
import { Task, TaskType, TaskResult, TaskExecutor, ImprovementNoteContext, StatusCallbacks } from '../types';
import { CodeAnalysis } from '../../utils/CodeAnalyzer';
import { AIEngine, AIRequest } from '../../ai-engine/AIEngine';
import { SymbolInfo } from '../../indexing/CodebaseIndex';
import { FileContext } from '../../utils/FileAnalyzer';
import { ImprovementManager } from '../../utils/ImprovementManager';

// Helper function to get a user-friendly name for the symbol kind
function getSymbolKindName(kind: vscode.SymbolKind): string {
    switch (kind) {
        case vscode.SymbolKind.File: return 'file';
        case vscode.SymbolKind.Module: return 'module';
        case vscode.SymbolKind.Namespace: return 'namespace';
        case vscode.SymbolKind.Package: return 'package';
        case vscode.SymbolKind.Class: return 'class';
        case vscode.SymbolKind.Method: return 'method';
        case vscode.SymbolKind.Property: return 'property';
        case vscode.SymbolKind.Field: return 'field';
        case vscode.SymbolKind.Constructor: return 'constructor';
        case vscode.SymbolKind.Enum: return 'enum';
        case vscode.SymbolKind.Interface: return 'interface';
        case vscode.SymbolKind.Function: return 'function';
        case vscode.SymbolKind.Variable: return 'variable';
        case vscode.SymbolKind.Constant: return 'constant';
        case vscode.SymbolKind.String: return 'string';
        case vscode.SymbolKind.Number: return 'number';
        case vscode.SymbolKind.Boolean: return 'boolean';
        case vscode.SymbolKind.Array: return 'array';
        case vscode.SymbolKind.Object: return 'object';
        case vscode.SymbolKind.Key: return 'key';
        case vscode.SymbolKind.Null: return 'null';
        case vscode.SymbolKind.EnumMember: return 'enum member';
        case vscode.SymbolKind.Struct: return 'struct';
        case vscode.SymbolKind.Event: return 'event';
        case vscode.SymbolKind.Operator: return 'operator';
        case vscode.SymbolKind.TypeParameter: return 'type parameter';
        default: return 'symbol';
    }
}

// Define or import the actual Explanation type expected by the system
// Use the detailed Explanation interface instead of the basic ExplanationResult
interface CodeExample {
    language?: string;
    code: string;
    explanation?: string;
}

interface Visualization {
    type: 'mermaid' | 'plantuml' | 'flowchart' | 'diagram' | 'code';
    content: string;
}

interface ExplanationSection {
    title: string;
    level: 'beginner' | 'intermediate' | 'advanced';
    content: string;
    visualizations: Visualization[];
    examples: CodeExample[];
    relatedConcepts: string[];
}

interface Explanation {
    summary?: string;
    sections: ExplanationSection[];
}

interface Location {
    startLine: number;
    endLine: number;
}

interface Overview {
    purpose: string;
    architecture: string;
    keyFeatures: string[];
    dependencies: string[];
}

interface Component {
    name: string;
    type: string;
    purpose: string;
    details: string;
    relationships: string[];
    location: Location;
}

interface Algorithm {
    name: string;
    purpose: string;
    complexity: string;
    steps: string[];
    location: Location;
}

interface BusinessLogic {
    feature: string;
    description: string;
    rules: string[];
    implementation: string;
    location: Location;
}

interface ExplanationPlan {
    overview: Overview;
    components: Component[];
    algorithms: Algorithm[];
    businessLogic: BusinessLogic[];
    examples: CodeExample[];
    levels?: {
        beginner: string[];
        intermediate: string[];
        advanced: string[];
    };
}

export class ExplanationExecutor implements TaskExecutor {
    private aiEngine: AIEngine;
    private showLoading: (message?: string) => void = () => {};
    private showReady: (message?: string) => void = () => {};
    private showError: (message?: string) => void;

    constructor(
        aiEngine: AIEngine,
        private readonly statusCallbacks: StatusCallbacks
    ) {
        this.aiEngine = aiEngine;
        this.showError = statusCallbacks.showError;
        this.showLoading = statusCallbacks.showLoading;
        this.showReady = statusCallbacks.showReady;
    }

    public canHandle(task: Task): boolean {
        return task.type === TaskType.EXPLANATION;
    }

    public async execute(task: Task): Promise<TaskResult> {
        this.showLoading('Explaining...');
        try {
            if (!task.metadata?.fileContext || !task.metadata?.codeAnalysis) {
                throw new Error('Task metadata is missing required analysis context');
            }

            // Create explanation plan
            const explanationPlan = await this.createExplanationPlan(task);

            // Generate explanations (Get raw AI Response)
            const request: AIRequest = {
                messages: [
                    { role: 'system', content: this.getExplanationSystemPrompt() },
                    { role: 'user', content: this.buildExplanationPrompt(explanationPlan) }
                ],
                temperature: 0.7,
                maxTokens: 2000
            };
            const explanationResponse = await this.aiEngine.generateResponse(request);

            // Parse response
            const explanationResult: Explanation = this.parseExplanation(explanationResponse.message);

            // Show explanation (Use parsed result)
            await this.showExplanation(explanationResult, explanationPlan); 
            
            // --- Extract and Note Suggestions --- 
            const improvementManager = ImprovementManager.getInstance();
            const suggestions = this.extractSuggestions(explanationResult);
            if (suggestions.length > 0) {
                console.log(`[ExplanationExecutor] Found ${suggestions.length} improvement suggestions.`);
                const editor = vscode.window.activeTextEditor;
                let noteContext: ImprovementNoteContext | undefined = undefined;
                if (editor) {
                    const filePath = vscode.workspace.asRelativePath(editor.document.uri);
                    noteContext = { filePath };
                    const targetSymbol = await this.findTargetSymbol(editor);
                    if (targetSymbol) { 
                        noteContext.symbolName = targetSymbol.name;
                        noteContext.selection = {
                            startLine: targetSymbol.startLine,
                            startChar: targetSymbol.startChar,
                            endLine: targetSymbol.endLine,
                            endChar: targetSymbol.endChar
                        };
                    } else if (editor.selection && !editor.selection.isEmpty) { 
                        noteContext.selection = {
                            startLine: editor.selection.start.line + 1,
                            startChar: editor.selection.start.character,
                            endLine: editor.selection.end.line + 1,
                            endChar: editor.selection.end.character
                        };
                        noteContext.selectedText = editor.document.getText(editor.selection);
                    }
                }
                for (const suggestion of suggestions) {
                    try {
                        await improvementManager.addNote(suggestion, noteContext, true, 'medium');
                        vscode.window.showInformationMessage(`Improvement suggestion noted: ${suggestion.substring(0, 30)}...`);
                        console.log(`[ExplanationExecutor] Automatically noted improvement: ${suggestion.substring(0, 50)}...`);
                    } catch (noteError) {
                        console.error('Error automatically noting improvement:', noteError);
                    }
                }
            }

            this.showReady();
            return { success: true, data: explanationResult } as TaskResult;
        } catch (error: any) {
            console.error('Error executing explanation task:', error);
            this.showError('Explanation Failed');
            return { success: false, error: error.message } as TaskResult;
        }
    }

    private async findSymbolAtPosition(filePath: string, position: vscode.Position): Promise<SymbolInfo | undefined> {
        const document = await vscode.workspace.openTextDocument(filePath);
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        if (!symbols) return undefined;

        let bestMatch: SymbolInfo | undefined;
        for (const symbol of symbols) {
            if (symbol.range.contains(position)) {
                const range = symbol.range;
                const symbolInfo: SymbolInfo = {
                    name: symbol.name,
                    kind: symbol.kind,
                    location: new vscode.Location(document.uri, range),
                    children: [],
                    startLine: range.start.line + 1,
                    startChar: range.start.character,
                    endLine: range.end.line + 1,
                    endChar: range.end.character
                };
                if (!bestMatch || symbol.range.start.isAfter(bestMatch.location.range.start)) {
                    bestMatch = symbolInfo;
                }
            }
        }
        return bestMatch;
    }

    private async findSymbolsInFile(document: vscode.TextDocument): Promise<SymbolInfo[]> {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        if (!symbols) return [];

        const results: SymbolInfo[] = [];
        for (const symbol of symbols) {
            const range = symbol.range;
            results.push({
                name: symbol.name,
                kind: symbol.kind,
                location: new vscode.Location(document.uri, range),
                children: [],
                startLine: range.start.line + 1,
                startChar: range.start.character,
                endLine: range.end.line + 1,
                endChar: range.end.character
            });
        }
        return results;
    }

    private async findTargetSymbol(editor: vscode.TextEditor): Promise<SymbolInfo | undefined> {
        const cursorPos = editor.selection.active;
        const filePath = vscode.workspace.asRelativePath(editor.document.uri);
        const symbol = await this.findSymbolAtPosition(filePath, cursorPos);
        if (symbol) {
            return symbol;
        }
        return undefined;
    }

    private async createExplanationPlan(task: Task): Promise<ExplanationPlan> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }

        let codeToExplain = '';
        let promptTitle = '';
        const selection = editor.selection;
        const document = editor.document;
        const filePath = vscode.workspace.asRelativePath(document.uri);
        const fileLang = document.languageId;
        let identifiedSymbol: SymbolInfo | undefined;

        if (selection && !selection.isEmpty) {
            // --- User has a selection ---
            const selectionStartPos = selection.start;
            const selectionEndPos = selection.end; 
            // Try to find the most specific symbol containing the selection midpoint
            const midPointLine = Math.floor((selectionStartPos.line + selectionEndPos.line) / 2);
            const midPointChar = Math.floor((selectionStartPos.character + selectionEndPos.character) / 2);
            const midPointPos = new vscode.Position(midPointLine, midPointChar); 

            identifiedSymbol = await this.findSymbolAtPosition(filePath, midPointPos);
            
            if (identifiedSymbol) {
                // Selection seems to be within a known symbol, use the symbol's code
                console.log(`Explaining symbol containing selection: ${identifiedSymbol.name}`);
                const symbolRange = new vscode.Range(
                    identifiedSymbol.startLine - 1, identifiedSymbol.startChar, 
                    identifiedSymbol.endLine - 1, identifiedSymbol.endChar
                );
                codeToExplain = document.getText(symbolRange);
                promptTitle = `Please analyze the ${getSymbolKindName(identifiedSymbol.kind)} '${identifiedSymbol.name}' from ${filePath} and create a comprehensive explanation plan:`;
            } else {
                // Selection doesn't clearly map to a single symbol, use selected text
                console.log('Explaining selected text.');
                codeToExplain = document.getText(selection);
                promptTitle = `Please analyze the following code snippet from ${filePath} (lines ${selection.start.line + 1}-${selection.end.line + 1}) and create a comprehensive explanation plan:`;
                identifiedSymbol = undefined; // Clear symbol if we are just using selection text
            }
        } else {
            // --- No selection, use cursor position ---
            const cursorPos = editor.selection.active;
            identifiedSymbol = await this.findSymbolAtPosition(filePath, cursorPos);

            if (identifiedSymbol) {
                // Found symbol at cursor, use its code
                console.log(`Explaining symbol at cursor: ${identifiedSymbol.name}`);
                const symbolRange = new vscode.Range(
                    identifiedSymbol.startLine - 1, identifiedSymbol.startChar, 
                    identifiedSymbol.endLine - 1, identifiedSymbol.endChar
                );
                codeToExplain = document.getText(symbolRange);
                promptTitle = `Please analyze the ${getSymbolKindName(identifiedSymbol.kind)} '${identifiedSymbol.name}' from ${filePath} and create a comprehensive explanation plan:`;
            } else {
                // No symbol at cursor, fall back to entire file
                console.log('No specific symbol found at cursor, explaining the entire file.');
                codeToExplain = document.getText();
                promptTitle = `Please analyze the entire file ${filePath} and create a comprehensive explanation plan:`;
            }
        }
        
        const { codeAnalysis, fileContext } = task.metadata!; 
        // Adjust fileContext if needed, e.g., use determined language if different
        const actualFileContext = { ...fileContext, language: fileLang }; 

        // --- Get Imports for Context --- 
        let relevantImports: string[] = [];
        const fileSymbols = await this.findSymbolsInFile(document);
        const importSymbols = fileSymbols.filter(symbol => symbol.kind === vscode.SymbolKind.Module);
        relevantImports = importSymbols.map(symbol => document.getText(symbol.location.range));

        // Build the explanation plan request
        const request: AIRequest = {
            messages: [
                { role: 'system', content: this.getExplanationPlanSystemPrompt() },
                { role: 'user', content: this.buildExplanationPlanPrompt(promptTitle, codeToExplain, codeAnalysis, actualFileContext, relevantImports) }
            ],
            temperature: 0.7,
            maxTokens: 2000
        };

        const response = await this.aiEngine.generateResponse(request);
        return this.parseExplanationPlan(response.message);
    }

    private buildExplanationPlanPrompt(
        title: string,
        code: string,
        codeAnalysis: CodeAnalysis,
        fileContext: FileContext,
        imports: string[]
    ): string {
        return `${title}

Code:
\`\`\`${fileContext.language}
${code}
\`\`\`

Imports:
${imports.join('\n')}

Code Analysis:
${JSON.stringify(codeAnalysis, null, 2)}

File Context:
${JSON.stringify(fileContext, null, 2)}`;
    }

    private getExplanationPlanSystemPrompt(): string {
        return `You are an expert code analyzer. Your task is to create a comprehensive explanation plan for the given code.
The plan should include:
1. Overview (purpose, architecture, key features, dependencies)
2. Components (classes, functions, interfaces)
3. Algorithms (data structures, complexity, optimizations)
4. Business Logic (rules, validations, edge cases)
5. Examples (usage, common patterns)
6. Different levels of understanding (beginner, intermediate, advanced)`;
    }

    private parseExplanationPlan(message: string): ExplanationPlan {
        try {
            return JSON.parse(message);
        } catch (error) {
            console.error('Error parsing explanation plan:', error);
            return {
                overview: {
                    purpose: '',
                    architecture: '',
                    keyFeatures: [],
                    dependencies: []
                },
                components: [],
                algorithms: [],
                businessLogic: [],
                examples: [],
                levels: {
                    beginner: [],
                    intermediate: [],
                    advanced: []
                }
            };
        }
    }

    private buildExplanationPrompt(plan: ExplanationPlan): string {
        return JSON.stringify(plan, null, 2);
    }

    private getExplanationSystemPrompt(): string {
        return `You are an expert code explainer. Your task is to explain the code based on the provided explanation plan.
Please provide detailed explanations for each section of the plan, including:
1. Overview of the code's purpose and architecture
2. Detailed explanation of each component
3. Analysis of algorithms and their complexity
4. Description of business logic and validation rules
5. Usage examples and common patterns
6. Explanations tailored for different expertise levels`;
    }

    private parseExplanation(message: string): Explanation {
        try {
            return JSON.parse(message);
        } catch (error) {
            console.error('Error parsing explanation:', error);
            return {
                summary: '',
                sections: []
            };
        }
    }

    private async showExplanation(explanation: Explanation, plan: ExplanationPlan): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'codeExplanation',
            'Code Explanation',
            vscode.ViewColumn.Two,
            {
                enableScripts: true
            }
        );

        panel.webview.html = this.generateExplanationHTML(explanation, plan);
    }

    private generateExplanationHTML(explanation: Explanation, plan: ExplanationPlan): string {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Code Explanation</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            margin: 0;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }

        .section {
            margin-bottom: 20px;
            padding: 10px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }

        h1, h2, h3 {
            color: var(--vscode-editor-foreground);
        }

        pre {
            background-color: var(--vscode-editor-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }

        code {
            font-family: 'Courier New', Courier, monospace;
        }

        .tag {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
            margin-right: 6px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
    </style>
</head>
<body>
            <h1>Code Explanation</h1>

    <div class="section">
            <h2>Overview</h2>
            <p><strong>Purpose:</strong> ${plan.overview.purpose}</p>
            <p><strong>Architecture:</strong> ${plan.overview.architecture}</p>
            <div>
                <strong>Key Features:</strong>
                <ul>
                    ${plan.overview.keyFeatures.map(feature => `<li>${feature}</li>`).join('')}
                </ul>
            </div>
            <div>
                <strong>Dependencies:</strong>
                <ul>
                    ${plan.overview.dependencies.map(dep => `<li>${dep}</li>`).join('')}
                </ul>
            </div>
        </div>

        <div class="section">
            <h2>Components</h2>
            ${plan.components.map(component => `
                <div class="component">
                    <h3>${component.name}</h3>
                    <p><strong>Type:</strong> ${component.type}</p>
                    <p><strong>Purpose:</strong> ${component.purpose}</p>
                    <p><strong>Details:</strong> ${component.details}</p>
                    <p><strong>Related to:</strong> ${component.relationships.join(', ')}</p>
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Algorithms</h2>
            ${plan.algorithms.map(algorithm => `
                <div class="algorithm">
                    <h3>${algorithm.name}</h3>
                    <p><strong>Purpose:</strong> ${algorithm.purpose}</p>
                    <p><strong>Complexity:</strong> ${algorithm.complexity}</p>
                    <div>
                        <strong>Steps:</strong>
                        <ol>
                            ${algorithm.steps.map(step => `<li>${step}</li>`).join('')}
                        </ol>
                    </div>
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Business Logic</h2>
            ${plan.businessLogic.map(logic => `
                <div class="business-logic">
                    <h3>${logic.feature}</h3>
                    <p><strong>Description:</strong> ${logic.description}</p>
                    <div>
                        <strong>Business Rules:</strong>
                        <ul>
                            ${logic.rules.map(rule => `<li>${rule}</li>`).join('')}
                        </ul>
                    </div>
                    <p><strong>Implementation:</strong> ${logic.implementation}</p>
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Examples</h2>
            ${plan.examples.map(example => `
                <div class="example">
                ${example.language ? `<h3>Language: ${example.language}</h3>` : ''}
                <pre><code>${this.escapeHtml(example.code)}</code></pre>
                ${example.explanation ? `<p>${example.explanation}</p>` : ''}
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Detailed Explanations</h2>
            ${explanation.sections.map(section => `
            <div class="explanation-section">
                    <h3>
                        ${section.title}
                    <span class="tag">${section.level}</span>
                    </h3>
                    <div class="content">${section.content}</div>
                    ${section.visualizations.map(vis => `
                        <div class="visualization">
                            ${vis.type === 'code' ? 
                            `<pre><code>${this.escapeHtml(vis.content)}</code></pre>` :
                                `<div class="diagram">${vis.content}</div>`
                            }
                        </div>
                    `).join('')}
                    ${section.examples.map(example => `
                        <div class="example">
                        ${example.language ? `<h3>Language: ${example.language}</h3>` : ''}
                        <pre><code>${this.escapeHtml(example.code)}</code></pre>
                        ${example.explanation ? `<p>${example.explanation}</p>` : ''}
                        </div>
                    `).join('')}
                    <div class="related-concepts">
                    Related: ${section.relatedConcepts.join(', ')}
                    </div>
                </div>
            `).join('')}
        </div>
</body>
</html>`;
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    private extractSuggestions(explanation: Explanation): string[] {
        const suggestions: string[] = [];
        const regex = /\[IMPROVEMENT_SUGGESTION\]:\s*(.*)/gi;

        for (const section of explanation.sections) {
            let match;
            while ((match = regex.exec(section.content)) !== null) {
                if (match[1]) suggestions.push(match[1].trim());
            }
        }

        return suggestions;
    }
} 