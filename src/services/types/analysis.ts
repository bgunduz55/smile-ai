import * as vscode from 'vscode';

export interface SemanticNode {
    type: string;
    name: string;
    location: vscode.Location;
    children?: SemanticNode[];
    references?: vscode.Location[];
    documentation?: string;
}

export interface AnalysisResult {
    ast: SemanticNode;
    symbols: Map<string, SemanticNode>;
    dependencies: Map<string, string[]>;
    metrics: CodeMetrics;
}

export interface CodeMetrics {
    complexity: number;
    linesOfCode: number;
    commentLines: number;
    dependencies: number;
    maintainabilityIndex: number;
}

export interface LanguageAnalyzer {
    analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult>;
    dispose(): void;
} 