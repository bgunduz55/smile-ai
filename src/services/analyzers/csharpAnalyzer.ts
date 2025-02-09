import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

export class CSharpAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeCSharpContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeCSharpContent(content: string): Promise<AnalysisResult> {
        try {
            // C# analiz script'ini oluştur
            const csharpScript = `
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

class CodeAnalyzer
{
    class AnalysisVisitor : CSharpSyntaxWalker
    {
        public int Complexity { get; private set; } = 0;
        public Dictionary<string, object> Symbols { get; } = new Dictionary<string, object>();
        public Dictionary<string, List<string>> Dependencies { get; } = new Dictionary<string, List<string>>();

        public override void VisitUsingDirective(UsingDirectiveSyntax node)
        {
            var name = node.Name.ToString();
            if (!Dependencies.ContainsKey(name))
            {
                Dependencies[name] = new List<string>();
            }
            base.VisitUsingDirective(node);
        }

        public override void VisitClassDeclaration(ClassDeclarationSyntax node)
        {
            Symbols[node.Identifier.Text] = new
            {
                type = "class",
                name = node.Identifier.Text,
                line = node.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
                column = node.GetLocation().GetLineSpan().StartLinePosition.Character,
                endLine = node.GetLocation().GetLineSpan().EndLinePosition.Line + 1,
                endColumn = node.GetLocation().GetLineSpan().EndLinePosition.Character,
                documentation = node.GetLeadingTrivia()
                    .Where(t => t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia))
                    .Select(t => t.ToString())
                    .FirstOrDefault() ?? ""
            };
            base.VisitClassDeclaration(node);
        }

        public override void VisitMethodDeclaration(MethodDeclarationSyntax node)
        {
            Symbols[node.Identifier.Text] = new
            {
                type = "method",
                name = node.Identifier.Text,
                line = node.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
                column = node.GetLocation().GetLineSpan().StartLinePosition.Character,
                endLine = node.GetLocation().GetLineSpan().EndLinePosition.Line + 1,
                endColumn = node.GetLocation().GetLineSpan().EndLinePosition.Character,
                documentation = node.GetLeadingTrivia()
                    .Where(t => t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia))
                    .Select(t => t.ToString())
                    .FirstOrDefault() ?? ""
            };
            base.VisitMethodDeclaration(node);
        }

        public override void VisitIfStatement(IfStatementSyntax node)
        {
            Complexity++;
            base.VisitIfStatement(node);
        }

        public override void VisitForStatement(ForStatementSyntax node)
        {
            Complexity++;
            base.VisitForStatement(node);
        }

        public override void VisitWhileStatement(WhileStatementSyntax node)
        {
            Complexity++;
            base.VisitWhileStatement(node);
        }

        public override void VisitDoStatement(DoStatementSyntax node)
        {
            Complexity++;
            base.VisitDoStatement(node);
        }

        public override void VisitSwitchStatement(SwitchStatementSyntax node)
        {
            Complexity++;
            base.VisitSwitchStatement(node);
        }
    }

    static void Main(string[] args)
    {
        try
        {
            // Stdin'den kodu oku
            string code = Console.In.ReadToEnd();

            // Kodu parse et
            var tree = CSharpSyntaxTree.ParseText(code);
            var root = tree.GetRoot();

            // AST analizi yap
            var visitor = new AnalysisVisitor();
            visitor.Visit(root);

            // Yorum satırlarını say
            var commentLines = code.Split('\\n')
                .Count(line => line.Trim().StartsWith("//") || line.Trim().StartsWith("/*"));

            // Toplam satır sayısı
            var totalLines = code.Split('\\n').Length;

            // Sonucu oluştur
            var result = new
            {
                success = true,
                complexity = visitor.Complexity,
                symbols = visitor.Symbols,
                dependencies = visitor.Dependencies,
                lines_of_code = totalLines,
                comment_lines = commentLines
            };

            Console.WriteLine(JsonSerializer.Serialize(result));
        }
        catch (Exception e)
        {
            var error = new { success = false, error = e.Message };
            Console.WriteLine(JsonSerializer.Serialize(error));
        }
    }
}`;

            // C# process'ini başlat
            const csharpProcess = spawn('dotnet', ['script', '-']);
            
            // Kodu gönder
            csharpProcess.stdin.write(content);
            csharpProcess.stdin.end();

            // Sonucu al
            const output = await new Promise<string>((resolve, reject) => {
                let result = '';
                csharpProcess.stdout.on('data', (data) => {
                    result += data.toString();
                });
                csharpProcess.stderr.on('data', (data) => {
                    console.error('C# analiz hatası:', data.toString());
                });
                csharpProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('C# analizi başarısız oldu'));
                    }
                });
            });

            const analysisResult = JSON.parse(output);
            
            if (!analysisResult.success) {
                throw new Error(analysisResult.error);
            }

            // Sonuçları VSCode formatına dönüştür
            return {
                ast: this.createASTNode(analysisResult),
                symbols: this.createSymbolsMap(analysisResult.symbols),
                dependencies: this.createDependenciesMap(analysisResult.dependencies),
                metrics: this.createMetrics(analysisResult)
            };

        } catch (error) {
            console.error('C# analiz hatası:', error);
            throw error;
        }
    }

    private createASTNode(result: any): SemanticNode {
        return {
            type: 'CompilationUnit',
            name: 'root',
            location: new vscode.Location(
                vscode.Uri.file(''),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: any): Map<string, SemanticNode> {
        const result = new Map<string, SemanticNode>();
        
        for (const [name, info] of Object.entries<any>(symbols)) {
            result.set(name, {
                type: info.type,
                name: name,
                location: new vscode.Location(
                    vscode.Uri.file(''),
                    new vscode.Range(
                        info.line - 1,
                        info.column,
                        info.endLine - 1,
                        info.endColumn
                    )
                ),
                documentation: info.documentation
            });
        }
        
        return result;
    }

    private createDependenciesMap(dependencies: any): Map<string, string[]> {
        return new Map(Object.entries(dependencies));
    }

    private createMetrics(result: any): CodeMetrics {
        return {
            complexity: result.complexity,
            linesOfCode: result.lines_of_code,
            commentLines: result.comment_lines,
            dependencies: Object.keys(result.dependencies || {}).length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                result.complexity,
                result.lines_of_code,
                result.comment_lines
            )
        };
    }

    private calculateMaintainabilityIndex(
        complexity: number,
        linesOfCode: number,
        commentLines: number
    ): number {
        const avgComplexity = complexity / (linesOfCode || 1);
        const commentRatio = commentLines / (linesOfCode || 1);
        
        return Math.max(0, Math.min(100,
            171 -
            5.2 * Math.log(avgComplexity || 1) -
            0.23 * Math.log(linesOfCode || 1) -
            16.2 * Math.log(commentRatio || 0.01)
        ));
    }

    public dispose(): void {
        this.analysisCache.clear();
    }
} 