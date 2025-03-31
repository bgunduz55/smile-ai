import * as vscode from 'vscode';
import { Task, TaskType, TaskResult, TaskExecutor } from '../types';
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

export class CodeModificationExecutor implements TaskExecutor {
    private aiEngine: AIEngine;
    private codebaseIndexer: CodebaseIndex;

    constructor(aiEngine: AIEngine, codebaseIndexer: CodebaseIndex) {
        this.aiEngine = aiEngine;
        this.codebaseIndexer = codebaseIndexer;
    }

    public canHandle(task: Task): boolean {
        return task.type === TaskType.CODE_MODIFICATION;
    }

    public async execute(task: Task): Promise<TaskResult> {
        try {
            if (!task.metadata?.fileContext || !task.metadata?.codeAnalysis) {
                throw new Error('Task metadata is missing required analysis context');
            }

            // Değişiklik önerisi al
            const modificationPlan = await this.planModification(task);

            // Değişikliği preview olarak göster
            const approved = await this.showModificationPreview(modificationPlan);
            
            if (!approved) {
                return {
                    success: false,
                    error: 'Modification was cancelled by user'
                };
            }

            // Değişikliği uygula
            await this.applyModification(modificationPlan);

            return {
                success: true,
                data: modificationPlan
            };
        } catch (error) {
            console.error('Error in CodeModificationExecutor:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error in code modification'
            };
        }
    }

    private async planModification(task: Task): Promise<ModificationPlan> {
        // const { codeAnalysis, fileContext } = task.metadata!; // Keep for now if needed
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }

        const document = editor.document;
        const filePath = vscode.workspace.asRelativePath(document.uri);
        const selection = editor.selection;
        let codeToModify = '';
        let promptContext = '';
        let targetSymbol: SymbolInfo | undefined;

        if (selection && !selection.isEmpty) {
            // --- User has a selection ---
            const midPointPos = new vscode.Position(
                Math.floor((selection.start.line + selection.end.line) / 2),
                Math.floor((selection.start.character + selection.end.character) / 2)
            );
            targetSymbol = this.codebaseIndexer.findSymbolAtPosition(filePath, midPointPos);

            // Check if the found symbol actually contains the selection
            if (targetSymbol && 
                targetSymbol.startLine <= selection.start.line + 1 && targetSymbol.endLine >= selection.end.line + 1 &&
                (targetSymbol.startLine !== selection.start.line + 1 || targetSymbol.startChar <= selection.start.character) &&
                (targetSymbol.endLine !== selection.end.line + 1 || targetSymbol.endChar >= selection.end.character)) 
            {
                 console.log(`Modifying symbol containing selection: ${targetSymbol.name}`);
                 const symbolRange = new vscode.Range(targetSymbol.startLine - 1, targetSymbol.startChar, targetSymbol.endLine - 1, targetSymbol.endChar);
                 codeToModify = document.getText(symbolRange);
                 promptContext = `the ${getSymbolKindName(targetSymbol.kind)} '${targetSymbol.name}' in file ${filePath}`;
            } else {
                console.log('Modifying selected text.');
                codeToModify = document.getText(selection);
                promptContext = `the selected code snippet in ${filePath} (lines ${selection.start.line + 1}-${selection.end.line + 1})`;
                targetSymbol = undefined; 
            }
        } else {
            // --- No selection, use cursor position ---
            const cursorPos = editor.selection.active;
            targetSymbol = this.codebaseIndexer.findSymbolAtPosition(filePath, cursorPos);

            if (targetSymbol) {
                console.log(`Modifying symbol at cursor: ${targetSymbol.name}`);
                const symbolRange = new vscode.Range(targetSymbol.startLine - 1, targetSymbol.startChar, targetSymbol.endLine - 1, targetSymbol.endChar);
                codeToModify = document.getText(symbolRange);
                promptContext = `the ${getSymbolKindName(targetSymbol.kind)} '${targetSymbol.name}' in file ${filePath}`;
            } else {
                // Cannot determine target, maybe ask user or throw error?
                // For now, throw an error as modifying the whole file without context is risky.
                console.error('Cannot determine target for modification without selection or symbol at cursor.');
                throw new Error('Please select the code to modify or place the cursor inside a function/class/variable.'); 
                // Alternatively, could fall back to whole file modification if desired:
                // codeToModify = document.getText();
                // promptContext = `the entire file ${filePath}`;
            }
        }

        // Build prompt with the specific code and context
        const fileContext = task.metadata?.fileContext; // Get original file context if available
        const prompt = this.buildModificationPrompt(task.description, promptContext, codeToModify, fileContext);

        const response = await this.aiEngine.generateResponse({
            prompt,
            systemPrompt: this.getModificationSystemPrompt() // Keep or adapt the system prompt
        });

        // Parse the plan (needs to handle potential changes in AI response format)
        const plan = this.parseModificationPlan(response.message);

        // --- IMPORTANT: Adjust plan locations --- 
        // The AI plan's locations are relative to the snippet sent.
        // Adjust them back to be relative to the entire document.
        let baseLineOffset = 0;
        if (targetSymbol) {
            baseLineOffset = targetSymbol.startLine - 1; // 0-based start line of the symbol
        } else if (selection && !selection.isEmpty) { // If we used selection text
             baseLineOffset = selection.start.line; // 0-based start line of the selection
        }
        // If modifying the whole file (currently disabled), offset is 0.
        
        plan.modifications.forEach(mod => {
            // Adjust start and end lines by adding the base offset
            // Ensure the lines remain at least 1 after adjustment relative to snippet start
            mod.location.startLine = Math.max(1, mod.location.startLine) + baseLineOffset;
            mod.location.endLine = Math.max(1, mod.location.endLine) + baseLineOffset;
        });

        return plan; // Ensure the adjusted plan is returned
    }

    private buildModificationPrompt(description: string, contextInfo: string, code: string, fileContext: any): string {
        const language = fileContext?.language || 'typescript'; // Infer language if possible
        return `
Please analyze the following code and provide a detailed modification plan based on this request:
"${description}"

Context: You are modifying ${contextInfo}.

Code to modify:
\`\`\`${language}
${code}
\`\`\`

Provide a plan to modify ONLY the code snippet above. Focus on the user's request.
Consider potential risks or side effects WITHIN the context of this snippet.

Please provide your modification plan in this JSON format (ensure startLine/endLine are relative to the START of the snippet above, 1-based):
{
    "description": "Clear explanation of the changes to be made to the snippet",
    "modifications": [
        {
            "type": "add|modify|delete",
            "location": {
                "startLine": number, // Relative to snippet start (1-based)
                "endLine": number   // Relative to snippet start (1-based)
            },
            "code": "The new code to insert/replace/add",
            "explanation": "Why this change is needed for the snippet"
        }
        // Usually expect only one modification block for a focused snippet change
    ],
    "risks": [
        "Potential risk 1 (within snippet context)",
    ],
    "tests": [
        "Test case 1 (relevant to snippet change)",
    ]
}`;
    }

    private getModificationSystemPrompt(): string {
        return `You are a code modification expert. Your role is to:
1. Analyze the requested changes carefully
2. Plan modifications with minimal impact
3. Consider backward compatibility
4. Follow language best practices
5. Ensure code quality and maintainability
6. Provide clear and actionable modification steps

Please provide your modification plan in this JSON format:
{
    "description": "Clear explanation of the changes",
    "modifications": [
        {
            "type": "add|modify|delete",
            "location": {
                "startLine": number,
                "endLine": number
            },
            "code": "The new code to insert/modify",
            "explanation": "Why this change is needed"
        }
    ],
    "risks": [
        "Potential risk 1",
        "Potential risk 2"
    ],
    "tests": [
        "Test case 1",
        "Test case 2"
    ]
}`;
    }

    private parseModificationPlan(aiResponse: string): ModificationPlan {
        try {
            return JSON.parse(aiResponse);
        } catch (error) {
            console.error('Error parsing modification plan:', error);
            throw new Error('Failed to parse AI response for modification plan');
        }
    }

    private async showModificationPreview(plan: ModificationPlan): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }

        // Değişiklikleri geçici olarak uygula
        const tempDoc = editor.document.getText();
        const preview = this.generatePreview(tempDoc, plan);

        // Preview paneli oluştur
        const panel = vscode.window.createWebviewPanel(
            'codeModification',
            'Code Modification Preview',
            vscode.ViewColumn.Two,
            {
                enableScripts: true
            }
        );

        // Panel içeriğini oluştur
        panel.webview.html = this.generatePreviewHTML(preview, plan);

        // Kullanıcı onayı bekle
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

    private generatePreview(originalCode: string, plan: ModificationPlan): PreviewResult {
        const lines = originalCode.split('\n');
        const modifications = [...plan.modifications].sort((a, b) => 
            b.location.startLine - a.location.startLine
        );

        const preview: PreviewResult = {
            original: originalCode,
            modified: [...lines],
            changes: []
        };

        for (const mod of modifications) {
            const { startLine, endLine } = mod.location;
            const originalLines = lines.slice(startLine - 1, endLine).join('\n');

            switch (mod.type) {
                case 'add':
                    preview.modified.splice(startLine - 1, 0, mod.code);
                    preview.changes.push({
                        type: 'addition',
                        startLine,
                        endLine,
                        oldCode: '',
                        newCode: mod.code,
                        explanation: mod.explanation
                    });
                    break;

                case 'modify':
                    preview.modified.splice(startLine - 1, endLine - startLine + 1, mod.code);
                    preview.changes.push({
                        type: 'modification',
                        startLine,
                        endLine,
                        oldCode: originalLines,
                        newCode: mod.code,
                        explanation: mod.explanation
                    });
                    break;

                case 'delete':
                    preview.modified.splice(startLine - 1, endLine - startLine + 1);
                    preview.changes.push({
                        type: 'deletion',
                        startLine,
                        endLine,
                        oldCode: originalLines,
                        newCode: '',
                        explanation: mod.explanation
                    });
                    break;
            }
        }

        return preview;
    }

    private generatePreviewHTML(preview: PreviewResult, plan: ModificationPlan): string {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Code Modification Preview</title>
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

        .description {
            background-color: var(--secondary-color);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .diff-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }

        .diff-panel {
            background-color: var(--secondary-color);
            padding: 15px;
            border-radius: 8px;
        }

        .diff-panel h3 {
            margin-top: 0;
            color: var(--primary-color);
        }

        pre {
            margin: 0;
            padding: 10px;
            background-color: #1a1a1a;
            border-radius: 4px;
            overflow-x: auto;
        }

        .changes {
            margin-bottom: 20px;
        }

        .change-item {
            background-color: var(--secondary-color);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 10px;
        }

        .change-item .type {
            font-weight: bold;
            margin-bottom: 5px;
        }

        .type.addition { color: var(--success-color); }
        .type.modification { color: var(--warning-color); }
        .type.deletion { color: var(--error-color); }

        .risks {
            background-color: var(--secondary-color);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .risks h3 {
            color: var(--warning-color);
            margin-top: 0;
        }

        .risks ul {
            margin: 0;
            padding-left: 20px;
        }

        .button-container {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
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
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Code Modification Preview</h1>
        </div>

        <div class="description">
            <h3>Modification Description</h3>
            <p>${plan.description}</p>
        </div>

        <div class="changes">
            <h3>Changes</h3>
            ${preview.changes.map(change => `
                <div class="change-item">
                    <div class="type ${change.type}">${change.type.toUpperCase()}</div>
                    <div class="location">Lines ${change.startLine}-${change.endLine}</div>
                    <div class="explanation">${change.explanation}</div>
                    ${change.oldCode ? `
                        <h4>Original Code:</h4>
                        <pre>${this.escapeHtml(change.oldCode)}</pre>
                    ` : ''}
                    ${change.newCode ? `
                        <h4>New Code:</h4>
                        <pre>${this.escapeHtml(change.newCode)}</pre>
                    ` : ''}
                </div>
            `).join('')}
        </div>

        <div class="diff-container">
            <div class="diff-panel">
                <h3>Original Code</h3>
                <pre>${this.escapeHtml(preview.original)}</pre>
            </div>
            <div class="diff-panel">
                <h3>Modified Code</h3>
                <pre>${this.escapeHtml(preview.modified.join('\n'))}</pre>
            </div>
        </div>

        <div class="risks">
            <h3>Potential Risks</h3>
            <ul>
                ${plan.risks.map(risk => `<li>${risk}</li>`).join('')}
            </ul>
        </div>

        <div class="button-container">
            <button class="button reject" onclick="reject()">Cancel</button>
            <button class="button approve" onclick="approve()">Apply Changes</button>
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

    private async applyModification(plan: ModificationPlan): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }

        // Değişiklikleri sıralı bir şekilde uygula
        const modifications = [...plan.modifications].sort((a, b) => 
            b.location.startLine - a.location.startLine
        );

        await editor.edit(editBuilder => {
            for (const mod of modifications) {
                const range = new vscode.Range(
                    new vscode.Position(mod.location.startLine - 1, 0),
                    new vscode.Position(mod.location.endLine, 0)
                );

                switch (mod.type) {
                    case 'add':
                        editBuilder.insert(range.start, mod.code + '\n');
                        break;
                    case 'modify':
                        editBuilder.replace(range, mod.code);
                        break;
                    case 'delete':
                        editBuilder.delete(range);
                        break;
                }
            }
        });
    }
}

interface ModificationPlan {
    description: string;
    modifications: Modification[];
    risks: string[];
    tests: string[];
}

interface Modification {
    type: 'add' | 'modify' | 'delete';
    location: {
        startLine: number;
        endLine: number;
    };
    code: string;
    explanation: string;
}

interface PreviewResult {
    original: string;
    modified: string[];
    changes: Change[];
}

interface Change {
    type: 'addition' | 'modification' | 'deletion';
    startLine: number;
    endLine: number;
    oldCode: string;
    newCode: string;
    explanation: string;
} 