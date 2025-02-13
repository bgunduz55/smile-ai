import * as vscode from 'vscode';
import * as path from 'path';
import { Task, TaskType, TaskResult, TaskExecutor } from '../types';
import { CodeAnalyzer, CodeAnalysis, ClassInfo, FunctionInfo } from '../../utils/CodeAnalyzer';
import { AIEngine } from '../../ai-engine/AIEngine';

export class DocumentationExecutor implements TaskExecutor {
    private codeAnalyzer: CodeAnalyzer;
    private aiEngine: AIEngine;

    constructor(aiEngine: AIEngine) {
        this.codeAnalyzer = CodeAnalyzer.getInstance();
        this.aiEngine = aiEngine;
    }

    public canHandle(task: Task): boolean {
        return task.type === TaskType.DOCUMENTATION;
    }

    public async execute(task: Task): Promise<TaskResult> {
        try {
            if (!task.metadata?.fileContext || !task.metadata?.codeAnalysis) {
                throw new Error('Task metadata is missing required analysis context');
            }

            // Dokümantasyon planı oluştur
            const docPlan = await this.createDocumentationPlan(task);

            // Dokümantasyon üret
            const documentation = await this.generateDocumentation(docPlan);

            // Preview göster ve onay al
            const approved = await this.showDocumentationPreview(documentation, docPlan);
            
            if (!approved) {
                return {
                    success: false,
                    error: 'Documentation generation was cancelled by user'
                };
            }

            // Dokümantasyonu uygula
            await this.applyDocumentation(documentation);

            return {
                success: true,
                data: {
                    documentation,
                    plan: docPlan
                }
            };
        } catch (error) {
            console.error('Error in DocumentationExecutor:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error in documentation generation'
            };
        }
    }

    private async createDocumentationPlan(task: Task): Promise<DocumentationPlan> {
        const { codeAnalysis, fileContext } = task.metadata!;
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }

        const sourceCode = editor.document.getText();
        const prompt = this.buildDocPlanPrompt(sourceCode, codeAnalysis, fileContext);

        const response = await this.aiEngine.generateResponse({
            prompt,
            systemPrompt: this.getDocPlanSystemPrompt()
        });

        return this.parseDocPlan(response.message);
    }

    private buildDocPlanPrompt(sourceCode: string, analysis: CodeAnalysis, fileContext: any): string {
        const classes = analysis.structure.classes
            .map(c => this.formatClassInfo(c))
            .join('\n\n');

        const functions = analysis.structure.functions
            .filter(f => !f.name.startsWith('_')) // Özel metodları hariç tut
            .map(f => this.formatFunctionInfo(f))
            .join('\n\n');

        return `
Please analyze this code and create a comprehensive documentation plan:

Source Code:
\`\`\`${fileContext.language}
${sourceCode}
\`\`\`

Classes:
${classes}

Functions:
${functions}

Requirements:
1. Create clear and concise documentation
2. Follow ${fileContext.language} documentation standards
3. Include examples where appropriate
4. Document public APIs thoroughly
5. Add proper type information
6. Include usage notes and warnings
7. Document error handling

Language: ${fileContext.language}
Framework: ${fileContext.framework || 'None'}
Documentation Style: ${this.detectDocStyle(fileContext)}
`;
    }

    private formatClassInfo(cls: ClassInfo): string {
        return `
Class: ${cls.name}
Extends: ${cls.superClass || 'none'}
Implements: ${cls.interfaces?.join(', ') || 'none'}
Methods: ${cls.methods.map(m => m.name).join(', ')}
Properties: ${cls.properties.map(p => p.name).join(', ')}
Decorators: ${cls.decorators?.join(', ') || 'none'}
`;
    }

    private formatFunctionInfo(func: FunctionInfo): string {
        return `
Function: ${func.name}
Parameters: ${func.parameters.map(p => `${p.name}: ${p.type || 'any'}${p.isOptional ? '?' : ''}`).join(', ')}
Return Type: ${func.returnType || 'void'}
Async: ${func.isAsync}
Complexity: ${func.complexity}
Dependencies: ${func.dependencies.join(', ') || 'none'}
`;
    }

    private getDocPlanSystemPrompt(): string {
        return `You are a documentation expert. Your role is to:
1. Analyze code structure and purpose
2. Identify what needs documentation
3. Plan comprehensive documentation
4. Follow documentation best practices
5. Ensure clarity and completeness
6. Consider developer experience

Please provide your documentation plan in this JSON format:
{
    "overview": {
        "description": "Brief description of the code",
        "purpose": "Main purpose and functionality",
        "dependencies": ["List of dependencies"],
        "usage": "General usage information"
    },
    "sections": [
        {
            "type": "class|function|interface|constant",
            "target": "Name of the item",
            "content": {
                "description": "Detailed description",
                "params": [
                    {
                        "name": "Parameter name",
                        "type": "Parameter type",
                        "description": "Parameter description",
                        "optional": boolean,
                        "defaultValue": "Default value if any"
                    }
                ],
                "returns": {
                    "type": "Return type",
                    "description": "Return value description"
                },
                "throws": [
                    {
                        "type": "Error type",
                        "condition": "When this error occurs"
                    }
                ],
                "examples": [
                    {
                        "description": "Example description",
                        "code": "Example code"
                    }
                ],
                "notes": ["Important notes"],
                "seeAlso": ["Related items"]
            }
        }
    ],
    "style": {
        "format": "Documentation format to use",
        "conventions": ["Documentation conventions to follow"]
    }
}`;
    }

    private parseDocPlan(aiResponse: string): DocumentationPlan {
        try {
            return JSON.parse(aiResponse);
        } catch (error) {
            console.error('Error parsing documentation plan:', error);
            throw new Error('Failed to parse AI response for documentation plan');
        }
    }

    private async generateDocumentation(plan: DocumentationPlan): Promise<Documentation> {
        const prompt = this.buildDocGenerationPrompt(plan);
        
        const response = await this.aiEngine.generateResponse({
            prompt,
            systemPrompt: this.getDocGenerationSystemPrompt()
        });

        return this.parseDocumentation(response.message);
    }

    private buildDocGenerationPrompt(plan: DocumentationPlan): string {
        return `
Please generate documentation based on this plan:

${JSON.stringify(plan, null, 2)}

Requirements:
1. Follow the specified documentation style
2. Use clear and concise language
3. Include all specified sections
4. Add proper formatting
5. Include examples where specified
6. Follow type documentation conventions
7. Maintain consistent style
`;
    }

    private getDocGenerationSystemPrompt(): string {
        return `You are a documentation generator. Your role is to:
1. Generate clear and accurate documentation
2. Follow the documentation plan exactly
3. Use proper formatting and structure
4. Include all necessary details
5. Maintain consistent style
6. Ensure technical accuracy

Generate documentation in this format:
{
    "fileHeader": "File header comment",
    "sections": [
        {
            "target": "Target name",
            "position": {
                "startLine": number,
                "endLine": number
            },
            "content": "Documentation content"
        }
    ]
}`;
    }

    private detectDocStyle(fileContext: any): string {
        // Dile göre dokümantasyon stilini belirle
        switch (fileContext.language) {
            case 'typescript':
            case 'javascript':
                return 'JSDoc';
            case 'python':
                return 'Google Style Python Docstrings';
            case 'java':
                return 'Javadoc';
            default:
                return 'JSDoc';
        }
    }

    private async showDocumentationPreview(documentation: Documentation, plan: DocumentationPlan): Promise<boolean> {
        const panel = vscode.window.createWebviewPanel(
            'documentationPreview',
            'Documentation Preview',
            vscode.ViewColumn.Two,
            {
                enableScripts: true
            }
        );

        panel.webview.html = this.generatePreviewHTML(documentation, plan);

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

    private generatePreviewHTML(documentation: Documentation, plan: DocumentationPlan): string {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Documentation Preview</title>
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

        .overview {
            margin-bottom: 20px;
        }

        .doc-section {
            background-color: var(--background-color);
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .doc-section h4 {
            color: var(--info-color);
            margin: 0 0 10px 0;
        }

        .example {
            margin: 10px 0;
            padding: 10px;
            background-color: #1a1a1a;
            border-radius: 4px;
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
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Documentation Preview</h1>
        </div>

        <div class="section overview">
            <h2>Overview</h2>
            <p>${plan.overview.description}</p>
            <p><strong>Purpose:</strong> ${plan.overview.purpose}</p>
            <p><strong>Dependencies:</strong> ${plan.overview.dependencies.join(', ')}</p>
            <p><strong>Usage:</strong> ${plan.overview.usage}</p>
        </div>

        <div class="section">
            <h2>Documentation Sections</h2>
            ${documentation.sections.map(section => `
                <div class="doc-section">
                    <h4>${section.target}</h4>
                    <pre>${this.escapeHtml(section.content)}</pre>
                    <div class="location">Lines ${section.position.startLine}-${section.position.endLine}</div>
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>File Header</h2>
            <pre>${this.escapeHtml(documentation.fileHeader)}</pre>
        </div>

        <div class="section">
            <h2>Style Guide</h2>
            <p><strong>Format:</strong> ${plan.style.format}</p>
            <ul>
                ${plan.style.conventions.map(conv => `<li>${conv}</li>`).join('')}
            </ul>
        </div>

        <div class="button-container">
            <button class="button reject" onclick="reject()">Cancel</button>
            <button class="button approve" onclick="approve()">Apply Documentation</button>
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

    private async applyDocumentation(documentation: Documentation): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }

        await editor.edit(editBuilder => {
            // Dosya başlığını ekle
            if (documentation.fileHeader) {
                editBuilder.insert(new vscode.Position(0, 0), documentation.fileHeader + '\n\n');
            }

            // Her bölüm için dokümantasyonu ekle
            for (const section of documentation.sections) {
                const position = new vscode.Position(section.position.startLine - 1, 0);
                editBuilder.insert(position, section.content + '\n');
            }
        });
    }

    private parseDocumentation(aiResponse: string): Documentation {
        try {
            return JSON.parse(aiResponse);
        } catch (error) {
            console.error('Error parsing documentation:', error);
            throw new Error('Failed to parse AI response for documentation');
        }
    }
}

interface DocumentationPlan {
    overview: {
        description: string;
        purpose: string;
        dependencies: string[];
        usage: string;
    };
    sections: DocSection[];
    style: {
        format: string;
        conventions: string[];
    };
}

interface DocSection {
    type: 'class' | 'function' | 'interface' | 'constant';
    target: string;
    content: {
        description: string;
        params?: DocParam[];
        returns?: DocReturn;
        throws?: DocError[];
        examples?: DocExample[];
        notes?: string[];
        seeAlso?: string[];
    };
}

interface DocParam {
    name: string;
    type: string;
    description: string;
    optional: boolean;
    defaultValue?: string;
}

interface DocReturn {
    type: string;
    description: string;
}

interface DocError {
    type: string;
    condition: string;
}

interface DocExample {
    description: string;
    code: string;
}

interface Documentation {
    fileHeader: string;
    sections: {
        target: string;
        position: {
            startLine: number;
            endLine: number;
        };
        content: string;
    }[];
} 