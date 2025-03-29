import * as vscode from 'vscode';
import { Task, TaskType, TaskResult, TaskExecutor } from '../types';
import { CodeAnalyzer, CodeAnalysis, CodeMetrics } from '../../utils/CodeAnalyzer';
import { AIEngine } from '../../ai-engine/AIEngine';
import { CodebaseIndex, SymbolInfo, FileIndexData } from '../../indexing/CodebaseIndex';
import * as ts from 'typescript';

function getSymbolKindName(kind: ts.SyntaxKind): string {
    switch (kind) {
        case ts.SyntaxKind.FunctionDeclaration: case ts.SyntaxKind.MethodDeclaration: return 'function';
        case ts.SyntaxKind.ClassDeclaration: return 'class';
        case ts.SyntaxKind.InterfaceDeclaration: return 'interface';
        case ts.SyntaxKind.EnumDeclaration: return 'enum';
        case ts.SyntaxKind.TypeAliasDeclaration: return 'type alias';
        case ts.SyntaxKind.VariableDeclaration: return 'variable';
        default: return 'symbol';
    }
}

export class RefactoringExecutor implements TaskExecutor {
    private codeAnalyzer: CodeAnalyzer;
    private aiEngine: AIEngine;
    private codebaseIndexer: CodebaseIndex;

    constructor(aiEngine: AIEngine, codebaseIndexer: CodebaseIndex) {
        this.codeAnalyzer = CodeAnalyzer.getInstance();
        this.aiEngine = aiEngine;
        this.codebaseIndexer = codebaseIndexer;
    }

    public canHandle(task: Task): boolean {
        return task.type === TaskType.REFACTORING;
    }

    public async execute(task: Task): Promise<TaskResult> {
        try {
            if (!task.metadata?.fileContext || !task.metadata?.codeAnalysis) {
                throw new Error('Task metadata is missing required analysis context');
            }

            // Refactoring planı oluştur
            const refactoringPlan = await this.createRefactoringPlan(task);

            // Refactoring değişikliklerini üret
            const changes = await this.generateRefactoringChanges(refactoringPlan);

            // Preview göster ve onay al
            const approved = await this.showRefactoringPreview(changes, refactoringPlan);
            
            if (!approved) {
                return {
                    success: false,
                    error: 'Refactoring was cancelled by user'
                };
            }

            // Değişiklikleri uygula
            await this.applyRefactoring(changes);

            return {
                success: true,
                data: {
                    changes,
                    plan: refactoringPlan
                }
            };
        } catch (error) {
            console.error('Error in RefactoringExecutor:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error in refactoring'
            };
        }
    }

    private async createRefactoringPlan(task: Task): Promise<RefactoringPlan> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }

        const document = editor.document;
        const filePath = vscode.workspace.asRelativePath(document.uri);
        const selection = editor.selection;
        let codeToRefactor = '';
        let promptContext = '';
        let targetSymbol: SymbolInfo | undefined;
        let baseLineOffset = 0;

        if (selection && !selection.isEmpty) {
            const midPointPos = new vscode.Position(
                Math.floor((selection.start.line + selection.end.line) / 2),
                Math.floor((selection.start.character + selection.end.character) / 2)
            );
            targetSymbol = this.codebaseIndexer.findSymbolAtPosition(filePath, midPointPos);

            if (targetSymbol && 
                targetSymbol.startLine <= selection.start.line + 1 && targetSymbol.endLine >= selection.end.line + 1 &&
                (targetSymbol.startLine !== selection.start.line + 1 || targetSymbol.startChar <= selection.start.character) &&
                (targetSymbol.endLine !== selection.end.line + 1 || targetSymbol.endChar >= selection.end.character)) 
            {
                 console.log(`Refactoring symbol containing selection: ${targetSymbol.name}`);
                 const symbolRange = new vscode.Range(targetSymbol.startLine - 1, targetSymbol.startChar, targetSymbol.endLine - 1, targetSymbol.endChar);
                 codeToRefactor = document.getText(symbolRange);
                 promptContext = `the ${getSymbolKindName(targetSymbol.kind)} '${targetSymbol.name}' in file ${filePath}`;
                 baseLineOffset = targetSymbol.startLine - 1;
            } else {
                console.log('Refactoring selected text.');
                codeToRefactor = document.getText(selection);
                promptContext = `the selected code snippet in ${filePath} (lines ${selection.start.line + 1}-${selection.end.line + 1})`;
                targetSymbol = undefined; 
                baseLineOffset = selection.start.line;
            }
        } else {
            const cursorPos = editor.selection.active;
            targetSymbol = this.codebaseIndexer.findSymbolAtPosition(filePath, cursorPos);

            if (targetSymbol) {
                console.log(`Refactoring symbol at cursor: ${targetSymbol.name}`);
                const symbolRange = new vscode.Range(targetSymbol.startLine - 1, targetSymbol.startChar, targetSymbol.endLine - 1, targetSymbol.endChar);
                codeToRefactor = document.getText(symbolRange);
                promptContext = `the ${getSymbolKindName(targetSymbol.kind)} '${targetSymbol.name}' in file ${filePath}`;
                baseLineOffset = targetSymbol.startLine - 1;
            } else {
                console.error('Cannot determine target for refactoring without selection or symbol at cursor.');
                throw new Error('Please select the code to refactor or place the cursor inside a specific symbol.');
            }
        }

        const { codeAnalysis, fileContext } = task.metadata!;
        const actualFileContext = { ...fileContext, language: document.languageId };
        const prompt = this.buildRefactoringPlanPrompt(promptContext, codeToRefactor, codeAnalysis, actualFileContext);

        const response = await this.aiEngine.generateResponse({
            prompt,
            systemPrompt: this.getRefactoringPlanSystemPrompt()
        });

        const plan = this.parseRefactoringPlan(response.message);

        if (plan.analysis?.codeSmells) {
            plan.analysis.codeSmells.forEach(smell => {
                if (smell.location) {
                    smell.location.startLine = Math.max(1, smell.location.startLine) + baseLineOffset;
                    smell.location.endLine = Math.max(1, smell.location.endLine) + baseLineOffset;
                }
            });
        }
        
        if (plan.changes) {
            plan.changes.forEach(change => {
                if (change.steps) {
                    change.steps.forEach(step => {
                        if (step.target) {
                             step.target.startLine = Math.max(1, step.target.startLine) + baseLineOffset;
                             step.target.endLine = Math.max(1, step.target.endLine) + baseLineOffset;
                        }
                    });
                }
            });
        }

        return plan;
    }

    private buildRefactoringPlanPrompt(contextInfo: string, codeSnippet: string, analysis: CodeAnalysis, fileContext: any): string {
        const metrics = this.formatMetrics(analysis.metrics);
        const suggestions = analysis.suggestions
            .map(s => `- ${s.type}: ${s.description} (Priority: ${s.priority})`)
            .join('\n');

        return `
Please analyze the code snippet below and create a focused refactoring plan for it. You are working on: ${contextInfo}.

Code Snippet to Refactor:
\`\`\`${fileContext.language}
${codeSnippet}
\`\`\`

Overall File Metrics (for context, but focus analysis on the snippet):
${metrics}

Overall File Issues and Suggestions (for context, but focus analysis on the snippet):
${suggestions}

Refactoring Requirements (apply these primarily to the snippet):
1. Identify code smells and anti-patterns WITHIN the snippet.
2. Suggest design pattern implementations if appropriate for the snippet.
3. Consider performance improvements relevant to the snippet.
4. Maintain backwards compatibility for the snippet's external interface (if applicable).
5. Ensure type safety within the snippet.
6. Follow ${fileContext.language} best practices for the snippet.
7. Consider test impact for the snippet's functionality.

Language: ${fileContext.language}
Framework: ${fileContext.framework || 'None'}

Please provide a plan focusing ONLY on refactoring the provided snippet. Locations should be relative to the START of the snippet (1-based).`;
    }

    private formatMetrics(metrics: CodeMetrics): string {
        return `
Complexity: ${metrics.complexity}
Maintainability: ${metrics.maintainability}
Testability: ${metrics.testability}
Documentation: ${metrics.documentation}
Duplications: ${metrics.duplications}
`;
    }

    private getRefactoringPlanSystemPrompt(): string {
        return `You are a refactoring expert. Your role is to:
1. Analyze code quality and structure
2. Identify improvement opportunities
3. Plan safe and effective refactoring
4. Consider code maintainability
5. Ensure backward compatibility
6. Follow clean code principles

Please provide your refactoring plan in this JSON format:
{
    "analysis": {
        "codeSmells": [
            {
                "type": "smell type",
                "description": "smell description",
                "severity": "high|medium|low",
                "location": {
                    "startLine": number,
                    "endLine": number
                }
            }
        ],
        "designIssues": [
            {
                "type": "issue type",
                "description": "issue description",
                "suggestedPattern": "design pattern name",
                "rationale": "why this pattern"
            }
        ],
        "performanceIssues": [
            {
                "description": "issue description",
                "impact": "impact description",
                "suggestion": "improvement suggestion"
            }
        ]
    },
    "changes": [
        {
            "id": "unique change id",
            "type": "extract|move|rename|inline|split|merge",
            "description": "change description",
            "rationale": "why this change",
            "impact": {
                "complexity": "impact on complexity",
                "maintainability": "impact on maintainability",
                "scope": ["affected areas"]
            },
            "steps": [
                {
                    "order": number,
                    "action": "what to do",
                    "target": {
                        "startLine": number,
                        "endLine": number
                    },
                    "code": "new code"
                }
            ]
        }
    ],
    "risks": [
        {
            "type": "risk type",
            "description": "risk description",
            "mitigation": "how to mitigate"
        }
    ],
    "testingStrategy": {
        "impactedTests": ["test names"],
        "newTestsNeeded": ["test descriptions"],
        "regressionRisks": ["risk descriptions"]
    }
}`;
    }

    private parseRefactoringPlan(aiResponse: string): RefactoringPlan {
        try {
            return JSON.parse(aiResponse);
        } catch (error) {
            console.error('Error parsing refactoring plan:', error);
            throw new Error('Failed to parse AI response for refactoring plan');
        }
    }

    private async generateRefactoringChanges(plan: RefactoringPlan): Promise<RefactoringChanges> {
        const prompt = this.buildRefactoringChangesPrompt(plan);
        
        const response = await this.aiEngine.generateResponse({
            prompt,
            systemPrompt: this.getRefactoringChangesSystemPrompt()
        });

        return this.parseRefactoringChanges(response.message);
    }

    private buildRefactoringChangesPrompt(plan: RefactoringPlan): string {
        return `
Please generate detailed refactoring changes based on this plan:

${JSON.stringify(plan, null, 2)}

Requirements:
1. Generate precise code changes
2. Maintain code style and formatting
3. Include all necessary imports
4. Update related documentation
5. Consider dependencies
6. Ensure type safety
7. Follow clean code principles
`;
    }

    private getRefactoringChangesSystemPrompt(): string {
        return `You are a code refactoring implementer. Your role is to:
1. Generate precise code changes
2. Follow the refactoring plan exactly
3. Maintain code quality
4. Ensure backward compatibility
5. Consider edge cases
6. Preserve functionality

Generate changes in this format:
{
    "fileChanges": [
        {
            "type": "modify|create|delete",
            "path": "file path",
            "changes": [
                {
                    "type": "insert|update|delete",
                    "position": {
                        "startLine": number,
                        "endLine": number
                    },
                    "content": "new content",
                    "description": "change description"
                }
            ]
        }
    ],
    "orderOfExecution": [
        {
            "step": number,
            "fileChange": "file path",
            "changeIndex": number,
            "dependencies": ["step numbers"]
        }
    ]
}`;
    }

    private parseRefactoringChanges(aiResponse: string): RefactoringChanges {
        try {
            return JSON.parse(aiResponse);
        } catch (error) {
            console.error('Error parsing refactoring changes:', error);
            throw new Error('Failed to parse AI response for refactoring changes');
        }
    }

    private async showRefactoringPreview(changes: RefactoringChanges, plan: RefactoringPlan): Promise<boolean> {
        const panel = vscode.window.createWebviewPanel(
            'refactoringPreview',
            'Refactoring Preview',
            vscode.ViewColumn.Two,
            {
                enableScripts: true
            }
        );

        panel.webview.html = this.generatePreviewHTML(changes, plan);

        return new Promise((resolve) => {
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'approve':
                            panel.dispose();
                            resolve(true);
                            break;
                        case 'reject':
                            panel.dispose();
                            resolve(false);
                            break;
                    }
                },
                undefined
            );
        });
    }

    private generatePreviewHTML(changes: RefactoringChanges, plan: RefactoringPlan): string {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Refactoring Preview</title>
    <style>
        :root {
            --primary-color: #007acc;
            --secondary-color: #3d3d3d;
            --background-color: #1e1e1e;
            --text-color: #d4d4d4;
            --border-color: #404040;
            --success-color: #4caf50;
            --warning-color: #ff9800;
            --error-color: #f44336;
            --info-color: #2196f3;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            margin: 0;
            padding: 20px;
            background-color: var(--background-color);
            color: var(--text-color);
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            margin-bottom: 20px;
        }

        .section {
            background-color: var(--secondary-color);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .section h2 {
            color: var(--primary-color);
            margin-top: 0;
        }

        pre {
            margin: 0;
            padding: 10px;
            background-color: #1a1a1a;
            border-radius: 4px;
            overflow-x: auto;
        }

        .analysis {
            margin-bottom: 20px;
        }

        .issue {
            background-color: var(--background-color);
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .issue h4 {
            color: var(--info-color);
            margin: 0 0 10px 0;
        }

        .change {
            background-color: var(--background-color);
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .change-content {
            margin: 10px 0;
        }

        .risk {
            color: var(--warning-color);
        }

        .step {
            background-color: var(--background-color);
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .button-container {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 20px;
        }

        .button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        }

        .approve {
            background-color: var(--success-color);
            color: white;
        }

        .reject {
            background-color: var(--error-color);
            color: white;
        }

        .button:hover {
            opacity: 0.9;
        }

        .tag {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
            margin-right: 6px;
        }

        .tag.high { background-color: var(--error-color); }
        .tag.medium { background-color: var(--warning-color); }
        .tag.low { background-color: var(--success-color); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Refactoring Preview</h1>
        </div>

        <div class="section analysis">
            <h2>Analysis</h2>
            
            <h3>Code Smells</h3>
            ${plan.analysis.codeSmells.map(smell => `
                <div class="issue">
                    <span class="tag ${smell.severity}">${smell.severity}</span>
                    <h4>${smell.type}</h4>
                    <p>${smell.description}</p>
                    <div>Location: Lines ${smell.location.startLine}-${smell.location.endLine}</div>
                </div>
            `).join('')}

            <h3>Design Issues</h3>
            ${plan.analysis.designIssues.map(issue => `
                <div class="issue">
                    <h4>${issue.type}</h4>
                    <p>${issue.description}</p>
                    <p><strong>Suggested Pattern:</strong> ${issue.suggestedPattern}</p>
                    <p><strong>Rationale:</strong> ${issue.rationale}</p>
                </div>
            `).join('')}

            <h3>Performance Issues</h3>
            ${plan.analysis.performanceIssues.map(issue => `
                <div class="issue">
                    <p>${issue.description}</p>
                    <p><strong>Impact:</strong> ${issue.impact}</p>
                    <p><strong>Suggestion:</strong> ${issue.suggestion}</p>
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Proposed Changes</h2>
            ${changes.fileChanges.map(file => `
                <div class="change">
                    <h4>${file.path}</h4>
                    ${file.changes.map(change => `
                        <div class="change-content">
                            <div>Type: ${change.type}</div>
                            <div>Lines: ${change.position.startLine}-${change.position.endLine}</div>
                            <div>${change.description}</div>
                            <pre>${this.escapeHtml(change.content)}</pre>
                        </div>
                    `).join('')}
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Execution Plan</h2>
            ${changes.orderOfExecution.map(step => `
                <div class="step">
                    <h4>Step ${step.step}</h4>
                    <div>File: ${step.fileChange}</div>
                    <div>Dependencies: ${step.dependencies.join(', ') || 'None'}</div>
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Risks and Testing</h2>
            <div class="risks">
                <h3>Identified Risks</h3>
                <ul>
                    ${plan.risks.map(risk => `
                        <li class="risk">
                            <strong>${risk.type}:</strong> ${risk.description}
                            <br>
                            <strong>Mitigation:</strong> ${risk.mitigation}
                        </li>
                    `).join('')}
                </ul>
            </div>

            <div class="testing">
                <h3>Testing Strategy</h3>
                <p><strong>Impacted Tests:</strong></p>
                <ul>
                    ${plan.testingStrategy.impactedTests.map(test => `<li>${test}</li>`).join('')}
                </ul>
                <p><strong>New Tests Needed:</strong></p>
                <ul>
                    ${plan.testingStrategy.newTestsNeeded.map(test => `<li>${test}</li>`).join('')}
                </ul>
                <p><strong>Regression Risks:</strong></p>
                <ul>
                    ${plan.testingStrategy.regressionRisks.map(risk => `<li>${risk}</li>`).join('')}
                </ul>
            </div>
        </div>

        <div class="button-container">
            <button class="button reject" onclick="reject()">Cancel</button>
            <button class="button approve" onclick="approve()">Apply Refactoring</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function approve() {
            vscode.postMessage({ command: 'approve' });
        }

        function reject() {
            vscode.postMessage({ command: 'reject' });
        }
    </script>
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

    private async applyRefactoring(changes: RefactoringChanges): Promise<void> {
        for (const step of changes.orderOfExecution) {
            const fileChange = changes.fileChanges.find(f => f.path === step.fileChange);
            if (!fileChange) continue;

            const change = fileChange.changes[step.changeIndex];
            if (!change) continue;

            const uri = vscode.Uri.file(fileChange.path);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);

            await editor.edit(editBuilder => {
                const range = new vscode.Range(
                    new vscode.Position(change.position.startLine - 1, 0),
                    new vscode.Position(change.position.endLine, 0)
                );

                switch (change.type) {
                    case 'insert':
                        editBuilder.insert(range.start, change.content);
                        break;
                    case 'update':
                        editBuilder.replace(range, change.content);
                        break;
                    case 'delete':
                        editBuilder.delete(range);
                        break;
                }
            });
        }
    }
}

interface RefactoringPlan {
    analysis: {
        codeSmells: {
            type: string;
            description: string;
            severity: 'high' | 'medium' | 'low';
            location: {
                startLine: number;
                endLine: number;
            };
        }[];
        designIssues: {
            type: string;
            description: string;
            suggestedPattern: string;
            rationale: string;
        }[];
        performanceIssues: {
            description: string;
            impact: string;
            suggestion: string;
        }[];
    };
    changes: {
        id: string;
        type: 'extract' | 'move' | 'rename' | 'inline' | 'split' | 'merge';
        description: string;
        rationale: string;
        impact: {
            complexity: string;
            maintainability: string;
            scope: string[];
        };
        steps: {
            order: number;
            action: string;
            target: {
                startLine: number;
                endLine: number;
            };
            code: string;
        }[];
    }[];
    risks: {
        type: string;
        description: string;
        mitigation: string;
    }[];
    testingStrategy: {
        impactedTests: string[];
        newTestsNeeded: string[];
        regressionRisks: string[];
    };
}

interface RefactoringChanges {
    fileChanges: {
        type: 'modify' | 'create' | 'delete';
        path: string;
        changes: {
            type: 'insert' | 'update' | 'delete';
            position: {
                startLine: number;
                endLine: number;
            };
            content: string;
            description: string;
        }[];
    }[];
    orderOfExecution: {
        step: number;
        fileChange: string;
        changeIndex: number;
        dependencies: number[];
    }[];
} 