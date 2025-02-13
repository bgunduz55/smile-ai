import * as vscode from 'vscode';
import { Task, TaskType, TaskResult, TaskExecutor } from '../types';
import { CodeAnalyzer, CodeAnalysis } from '../../utils/CodeAnalyzer';
import { AIEngine } from '../../ai-engine/AIEngine';

export class ExplanationExecutor implements TaskExecutor {
    private codeAnalyzer: CodeAnalyzer;
    private aiEngine: AIEngine;

    constructor(aiEngine: AIEngine) {
        this.codeAnalyzer = CodeAnalyzer.getInstance();
        this.aiEngine = aiEngine;
    }

    public canHandle(task: Task): boolean {
        return task.type === TaskType.EXPLANATION;
    }

    public async execute(task: Task): Promise<TaskResult> {
        try {
            if (!task.metadata?.fileContext || !task.metadata?.codeAnalysis) {
                throw new Error('Task metadata is missing required analysis context');
            }

            // Açıklama planı oluştur
            const explanationPlan = await this.createExplanationPlan(task);

            // Açıklamaları üret
            const explanation = await this.generateExplanation(explanationPlan);

            // Açıklamaları görselleştir
            await this.showExplanation(explanation, explanationPlan);

            return {
                success: true,
                data: {
                    explanation,
                    plan: explanationPlan
                }
            };
        } catch (error) {
            console.error('Error in ExplanationExecutor:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error in explanation generation'
            };
        }
    }

    private async createExplanationPlan(task: Task): Promise<ExplanationPlan> {
        const { codeAnalysis, fileContext } = task.metadata!;
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }

        const sourceCode = editor.document.getText();
        const prompt = this.buildExplanationPlanPrompt(sourceCode, codeAnalysis, fileContext);

        const response = await this.aiEngine.generateResponse({
            prompt,
            systemPrompt: this.getExplanationPlanSystemPrompt()
        });

        return this.parseExplanationPlan(response.message);
    }

    private buildExplanationPlanPrompt(sourceCode: string, analysis: CodeAnalysis, fileContext: any): string {
        return `
Please analyze this code and create a comprehensive explanation plan:

Source Code:
\`\`\`${fileContext.language}
${sourceCode}
\`\`\`

Code Structure:
- Classes: ${analysis.structure.classes.length}
- Functions: ${analysis.structure.functions.length}
- Dependencies: ${analysis.dependencies.length}

Requirements:
1. Explain the overall purpose and architecture
2. Break down complex algorithms
3. Identify key components and their relationships
4. Explain business logic and implementation details
5. Highlight important patterns and practices
6. Include usage examples
7. Consider different expertise levels

Language: ${fileContext.language}
Framework: ${fileContext.framework || 'None'}
`;
    }

    private getExplanationPlanSystemPrompt(): string {
        return `You are a code explanation expert. Your role is to:
1. Analyze code structure and purpose
2. Break down complex concepts
3. Provide clear explanations
4. Consider different audience levels
5. Highlight key patterns and practices
6. Create comprehensive documentation

Please provide your explanation plan in this JSON format:
{
    "overview": {
        "purpose": "Main purpose of the code",
        "architecture": "Architectural overview",
        "keyFeatures": ["List of key features"],
        "dependencies": ["Important dependencies"]
    },
    "components": [
        {
            "name": "Component name",
            "type": "class|function|module",
            "purpose": "Component purpose",
            "details": "Implementation details",
            "relationships": ["Related components"],
            "location": {
                "startLine": number,
                "endLine": number
            }
        }
    ],
    "algorithms": [
        {
            "name": "Algorithm name",
            "purpose": "What it does",
            "complexity": "Time/Space complexity",
            "steps": ["Algorithm steps"],
            "location": {
                "startLine": number,
                "endLine": number
            }
        }
    ],
    "businessLogic": [
        {
            "feature": "Feature name",
            "description": "What it does",
            "rules": ["Business rules"],
            "implementation": "How it's implemented",
            "location": {
                "startLine": number,
                "endLine": number
            }
        }
    ],
    "examples": [
        {
            "scenario": "Usage scenario",
            "code": "Example code",
            "explanation": "How it works"
        }
    ],
    "levels": {
        "beginner": ["Basic concepts to understand"],
        "intermediate": ["More advanced concepts"],
        "advanced": ["Complex implementation details"]
    }
}`;
    }

    private parseExplanationPlan(aiResponse: string): ExplanationPlan {
        try {
            return JSON.parse(aiResponse);
        } catch (error) {
            console.error('Error parsing explanation plan:', error);
            throw new Error('Failed to parse AI response for explanation plan');
        }
    }

    private async generateExplanation(plan: ExplanationPlan): Promise<Explanation> {
        const prompt = this.buildExplanationPrompt(plan);
        
        const response = await this.aiEngine.generateResponse({
            prompt,
            systemPrompt: this.getExplanationSystemPrompt()
        });

        return this.parseExplanation(response.message);
    }

    private buildExplanationPrompt(plan: ExplanationPlan): string {
        return `
Please generate detailed explanations based on this plan:

${JSON.stringify(plan, null, 2)}

Requirements:
1. Use clear and concise language
2. Provide detailed explanations
3. Include relevant examples
4. Explain complex concepts simply
5. Add helpful diagrams where needed
6. Consider different expertise levels
7. Link related concepts
`;
    }

    private getExplanationSystemPrompt(): string {
        return `You are a code explanation generator. Your role is to:
1. Generate clear and comprehensive explanations
2. Break down complex concepts
3. Provide helpful examples
4. Create visual representations
5. Consider different expertise levels
6. Link related concepts

Generate explanations in this format:
{
    "sections": [
        {
            "title": "Section title",
            "content": "Detailed explanation",
            "level": "beginner|intermediate|advanced",
            "visualizations": [
                {
                    "type": "flowchart|diagram|code",
                    "content": "Visual content"
                }
            ],
            "examples": [
                {
                    "code": "Example code",
                    "explanation": "How it works"
                }
            ],
            "relatedConcepts": ["Related topics"]
        }
    ],
    "diagrams": [
        {
            "type": "flowchart|component|sequence",
            "content": "Mermaid diagram content"
        }
    ]
}`;
    }

    private parseExplanation(aiResponse: string): Explanation {
        try {
            return JSON.parse(aiResponse);
        } catch (error) {
            console.error('Error parsing explanation:', error);
            throw new Error('Failed to parse AI response for explanation');
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

        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'showCode':
                        await this.highlightCode(message.location);
                        break;
                    case 'showDiagram':
                        await this.showDiagram(message.diagram);
                        break;
                }
            },
            undefined
        );
    }

    private generateExplanationHTML(explanation: Explanation, plan: ExplanationPlan): string {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Code Explanation</title>
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

        .component {
            background-color: var(--background-color);
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .algorithm {
            background-color: var(--background-color);
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .business-logic {
            background-color: var(--background-color);
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .example {
            background-color: var(--background-color);
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .visualization {
            margin: 15px 0;
            padding: 10px;
            background-color: #1a1a1a;
            border-radius: 4px;
        }

        .level-selector {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }

        .level-button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            background-color: var(--secondary-color);
            color: var(--text-color);
            transition: background-color 0.2s;
        }

        .level-button.active {
            background-color: var(--primary-color);
        }

        .level-button:hover {
            opacity: 0.9;
        }

        .tag {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
            margin-right: 6px;
        }

        .tag.beginner { background-color: var(--success-color); }
        .tag.intermediate { background-color: var(--warning-color); }
        .tag.advanced { background-color: var(--error-color); }

        .related-concepts {
            margin-top: 10px;
            font-size: 14px;
        }

        .related-concepts a {
            color: var(--primary-color);
            text-decoration: none;
            margin-right: 10px;
        }

        .related-concepts a:hover {
            text-decoration: underline;
        }

        .diagram {
            margin: 15px 0;
            text-align: center;
        }

        .code-link {
            color: var(--primary-color);
            cursor: pointer;
            text-decoration: underline;
        }

        .code-link:hover {
            opacity: 0.8;
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Code Explanation</h1>
        </div>

        <div class="level-selector">
            <button class="level-button" onclick="filterLevel('all')">All Levels</button>
            <button class="level-button" onclick="filterLevel('beginner')">Beginner</button>
            <button class="level-button" onclick="filterLevel('intermediate')">Intermediate</button>
            <button class="level-button" onclick="filterLevel('advanced')">Advanced</button>
        </div>

        <div class="section overview">
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
                    <div class="code-link" onclick="showCode(${JSON.stringify(component.location)})">
                        View Code (Lines ${component.location.startLine}-${component.location.endLine})
                    </div>
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
                    <div class="code-link" onclick="showCode(${JSON.stringify(algorithm.location)})">
                        View Implementation (Lines ${algorithm.location.startLine}-${algorithm.location.endLine})
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
                    <div class="code-link" onclick="showCode(${JSON.stringify(logic.location)})">
                        View Implementation (Lines ${logic.location.startLine}-${logic.location.endLine})
                    </div>
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Examples</h2>
            ${plan.examples.map(example => `
                <div class="example">
                    <h3>${example.scenario}</h3>
                    <pre>${this.escapeHtml(example.code)}</pre>
                    <p>${example.explanation}</p>
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Detailed Explanations</h2>
            ${explanation.sections.map(section => `
                <div class="explanation-section" data-level="${section.level}">
                    <h3>
                        ${section.title}
                        <span class="tag ${section.level}">${section.level}</span>
                    </h3>
                    <div class="content">${section.content}</div>
                    ${section.visualizations.map(vis => `
                        <div class="visualization">
                            ${vis.type === 'code' ? 
                                `<pre>${this.escapeHtml(vis.content)}</pre>` :
                                `<div class="diagram">${vis.content}</div>`
                            }
                        </div>
                    `).join('')}
                    ${section.examples.map(example => `
                        <div class="example">
                            <pre>${this.escapeHtml(example.code)}</pre>
                            <p>${example.explanation}</p>
                        </div>
                    `).join('')}
                    <div class="related-concepts">
                        Related: ${section.relatedConcepts.map(concept => 
                            `<a href="#" onclick="showConcept('${concept}')">${concept}</a>`
                        ).join(' | ')}
                    </div>
                </div>
            `).join('')}
        </div>

        <div class="section">
            <h2>Diagrams</h2>
            ${explanation.diagrams.map((diagram, index) => `
                <div class="diagram">
                    <div class="mermaid">
                        ${diagram.content}
                    </div>
                </div>
            `).join('')}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function showCode(location) {
            vscode.postMessage({
                command: 'showCode',
                location: location
            });
        }

        function showDiagram(diagram) {
            vscode.postMessage({
                command: 'showDiagram',
                diagram: diagram
            });
        }

        function filterLevel(level) {
            const sections = document.querySelectorAll('.explanation-section');
            sections.forEach(section => {
                if (level === 'all' || section.dataset.level === level) {
                    section.style.display = 'block';
                } else {
                    section.style.display = 'none';
                }
            });

            document.querySelectorAll('.level-button').forEach(button => {
                button.classList.remove('active');
                if (button.textContent.toLowerCase().includes(level)) {
                    button.classList.add('active');
                }
            });
        }

        function showConcept(concept) {
            // Scroll to the related concept section if it exists
            const elements = document.querySelectorAll('h3');
            for (const element of elements) {
                if (element.textContent.includes(concept)) {
                    element.scrollIntoView({ behavior: 'smooth' });
                    break;
                }
            }
        }

        // Initialize Mermaid
        mermaid.initialize({
            startOnLoad: true,
            theme: 'dark',
            securityLevel: 'loose',
            themeVariables: {
                primaryColor: '#007acc',
                primaryTextColor: '#d4d4d4',
                primaryBorderColor: '#404040',
                lineColor: '#d4d4d4',
                secondaryColor: '#3d3d3d',
                tertiaryColor: '#1e1e1e'
            }
        });
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

    private async highlightCode(location: CodeLocation): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const range = new vscode.Range(
            new vscode.Position(location.startLine - 1, 0),
            new vscode.Position(location.endLine - 1, Number.MAX_VALUE)
        );

        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(range.start, range.end);

        // Highlight the range temporarily
        const decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            isWholeLine: true
        });

        editor.setDecorations(decoration, [range]);

        // Remove the highlight after a delay
        setTimeout(() => {
            decoration.dispose();
        }, 3000);
    }

    private async showDiagram(diagram: Diagram): Promise<void> {
        // TODO: Implement diagram visualization in a separate panel or modal
    }
}

interface ExplanationPlan {
    overview: {
        purpose: string;
        architecture: string;
        keyFeatures: string[];
        dependencies: string[];
    };
    components: {
        name: string;
        type: string;
        purpose: string;
        details: string;
        relationships: string[];
        location: CodeLocation;
    }[];
    algorithms: {
        name: string;
        purpose: string;
        complexity: string;
        steps: string[];
        location: CodeLocation;
    }[];
    businessLogic: {
        feature: string;
        description: string;
        rules: string[];
        implementation: string;
        location: CodeLocation;
    }[];
    examples: {
        scenario: string;
        code: string;
        explanation: string;
    }[];
    levels: {
        beginner: string[];
        intermediate: string[];
        advanced: string[];
    };
}

interface Explanation {
    sections: {
        title: string;
        content: string;
        level: 'beginner' | 'intermediate' | 'advanced';
        visualizations: Visualization[];
        examples: CodeExample[];
        relatedConcepts: string[];
    }[];
    diagrams: Diagram[];
}

interface CodeLocation {
    startLine: number;
    endLine: number;
}

interface Visualization {
    type: 'flowchart' | 'diagram' | 'code';
    content: string;
}

interface CodeExample {
    code: string;
    explanation: string;
}

interface Diagram {
    type: 'flowchart' | 'component' | 'sequence';
    content: string;
} 