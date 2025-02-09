import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface AspNetSymbol {
    name: string;
    type: 'controller' | 'service' | 'model' | 'middleware' | 'filter' | 'view' | 'razor' | 'startup';
    route?: string;
    methods?: string[];
    attributes?: string[];
    dependencies?: string[];
    endpoints?: string[];
    documentation?: string;
    location: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
    };
}

export class AspNetAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeAspNetContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeAspNetContent(content: string): Promise<AnalysisResult> {
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

class AspNetAnalyzer
{
    class SymbolInfo
    {
        public string Name { get; set; }
        public string Type { get; set; }
        public string Route { get; set; }
        public List<string> Methods { get; set; }
        public List<string> Attributes { get; set; }
        public List<string> Dependencies { get; set; }
        public List<string> Endpoints { get; set; }
        public string Documentation { get; set; }
        public Location Location { get; set; }
    }

    class Location
    {
        public int Line { get; set; }
        public int Column { get; set; }
        public int EndLine { get; set; }
        public int EndColumn { get; set; }
    }

    class AnalysisResult
    {
        public List<SymbolInfo> Symbols { get; set; }
        public int Complexity { get; set; }
        public int LinesOfCode { get; set; }
        public int CommentLines { get; set; }
        public Dictionary<string, List<string>> Dependencies { get; set; }
    }

    public static void Main()
    {
        try
        {
            // Stdin'den kodu oku
            string code = Console.In.ReadToEnd();

            // Kodu parse et
            var tree = CSharpSyntaxTree.ParseText(code);
            var root = tree.GetRoot();

            var symbols = new List<SymbolInfo>();
            var dependencies = new Dictionary<string, List<string>>();
            var complexity = 0;

            // Controller'ları analiz et
            foreach (var classDecl in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
            {
                if (IsController(classDecl))
                {
                    symbols.Add(AnalyzeController(classDecl));
                    complexity++;
                }
            }

            // Service'leri analiz et
            foreach (var classDecl in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
            {
                if (IsService(classDecl))
                {
                    symbols.Add(AnalyzeService(classDecl));
                    complexity++;
                }
            }

            // Model'leri analiz et
            foreach (var classDecl in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
            {
                if (IsModel(classDecl))
                {
                    symbols.Add(AnalyzeModel(classDecl));
                    complexity++;
                }
            }

            // Middleware'leri analiz et
            foreach (var classDecl in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
            {
                if (IsMiddleware(classDecl))
                {
                    symbols.Add(AnalyzeMiddleware(classDecl));
                    complexity++;
                }
            }

            // Filter'ları analiz et
            foreach (var classDecl in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
            {
                if (IsFilter(classDecl))
                {
                    symbols.Add(AnalyzeFilter(classDecl));
                    complexity++;
                }
            }

            // View'ları analiz et
            foreach (var razorPage in root.DescendantNodes().OfType<FileScopedNamespaceDeclarationSyntax>())
            {
                if (IsRazorPage(razorPage))
                {
                    symbols.Add(AnalyzeRazorPage(razorPage));
                    complexity++;
                }
            }

            // Startup sınıfını analiz et
            var startupClass = root.DescendantNodes()
                .OfType<ClassDeclarationSyntax>()
                .FirstOrDefault(c => c.Identifier.Text == "Startup");

            if (startupClass != null)
            {
                symbols.Add(AnalyzeStartup(startupClass));
                complexity++;
            }

            // Bağımlılıkları analiz et
            foreach (var usingDirective in root.DescendantNodes().OfType<UsingDirectiveSyntax>())
            {
                var namespaceName = usingDirective.Name.ToString();
                if (!dependencies.ContainsKey(namespaceName))
                {
                    dependencies[namespaceName] = new List<string>();
                }
            }

            // Yorum satırlarını say
            var commentLines = root.DescendantTrivia()
                .Count(t => t.IsKind(SyntaxKind.SingleLineCommentTrivia) || 
                          t.IsKind(SyntaxKind.MultiLineCommentTrivia));

            // Sonucu oluştur
            var result = new AnalysisResult
            {
                Symbols = symbols,
                Complexity = complexity,
                LinesOfCode = code.Split('\\n').Length,
                CommentLines = commentLines,
                Dependencies = dependencies
            };

            Console.WriteLine(JsonSerializer.Serialize(result));
        }
        catch (Exception ex)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { error = ex.Message }));
        }
    }

    private static bool IsController(ClassDeclarationSyntax classDecl)
    {
        return classDecl.Identifier.Text.EndsWith("Controller") ||
               classDecl.BaseList?.Types.Any(t => t.ToString().Contains("Controller")) == true;
    }

    private static bool IsService(ClassDeclarationSyntax classDecl)
    {
        return classDecl.Identifier.Text.EndsWith("Service") ||
               classDecl.AttributeLists.Any(a => a.ToString().Contains("Service"));
    }

    private static bool IsModel(ClassDeclarationSyntax classDecl)
    {
        return classDecl.AttributeLists.Any(a => a.ToString().Contains("Table") ||
                                                a.ToString().Contains("Entity"));
    }

    private static bool IsMiddleware(ClassDeclarationSyntax classDecl)
    {
        return classDecl.Identifier.Text.EndsWith("Middleware") ||
               classDecl.BaseList?.Types.Any(t => t.ToString().Contains("IMiddleware")) == true;
    }

    private static bool IsFilter(ClassDeclarationSyntax classDecl)
    {
        return classDecl.Identifier.Text.EndsWith("Filter") ||
               classDecl.BaseList?.Types.Any(t => t.ToString().Contains("Filter")) == true;
    }

    private static bool IsRazorPage(FileScopedNamespaceDeclarationSyntax ns)
    {
        return ns.DescendantNodes()
                .OfType<ClassDeclarationSyntax>()
                .Any(c => c.BaseList?.Types.Any(t => t.ToString().Contains("RazorPage")) == true);
    }

    private static SymbolInfo AnalyzeController(ClassDeclarationSyntax classDecl)
    {
        var methods = classDecl.DescendantNodes()
            .OfType<MethodDeclarationSyntax>()
            .Where(m => m.AttributeLists.Any(a => a.ToString().Contains("Http")))
            .Select(m => m.Identifier.Text)
            .ToList();

        var attributes = classDecl.AttributeLists
            .SelectMany(a => a.Attributes)
            .Select(a => a.Name.ToString())
            .ToList();

        var route = classDecl.AttributeLists
            .SelectMany(a => a.Attributes)
            .FirstOrDefault(a => a.Name.ToString() == "Route")
            ?.ArgumentList?.Arguments.First().ToString()
            .Trim('"');

        return new SymbolInfo
        {
            Name = classDecl.Identifier.Text,
            Type = "controller",
            Route = route,
            Methods = methods,
            Attributes = attributes,
            Documentation = GetDocumentation(classDecl),
            Location = GetLocation(classDecl)
        };
    }

    private static SymbolInfo AnalyzeService(ClassDeclarationSyntax classDecl)
    {
        var methods = classDecl.DescendantNodes()
            .OfType<MethodDeclarationSyntax>()
            .Select(m => m.Identifier.Text)
            .ToList();

        var dependencies = classDecl.DescendantNodes()
            .OfType<ConstructorDeclarationSyntax>()
            .SelectMany(c => c.ParameterList.Parameters)
            .Select(p => p.Type.ToString())
            .ToList();

        return new SymbolInfo
        {
            Name = classDecl.Identifier.Text,
            Type = "service",
            Methods = methods,
            Dependencies = dependencies,
            Documentation = GetDocumentation(classDecl),
            Location = GetLocation(classDecl)
        };
    }

    private static SymbolInfo AnalyzeModel(ClassDeclarationSyntax classDecl)
    {
        var properties = classDecl.DescendantNodes()
            .OfType<PropertyDeclarationSyntax>()
            .Select(p => p.Identifier.Text)
            .ToList();

        var attributes = classDecl.AttributeLists
            .SelectMany(a => a.Attributes)
            .Select(a => a.Name.ToString())
            .ToList();

        return new SymbolInfo
        {
            Name = classDecl.Identifier.Text,
            Type = "model",
            Methods = properties,
            Attributes = attributes,
            Documentation = GetDocumentation(classDecl),
            Location = GetLocation(classDecl)
        };
    }

    private static SymbolInfo AnalyzeMiddleware(ClassDeclarationSyntax classDecl)
    {
        var methods = classDecl.DescendantNodes()
            .OfType<MethodDeclarationSyntax>()
            .Where(m => m.Identifier.Text == "Invoke" || m.Identifier.Text == "InvokeAsync")
            .Select(m => m.Identifier.Text)
            .ToList();

        return new SymbolInfo
        {
            Name = classDecl.Identifier.Text,
            Type = "middleware",
            Methods = methods,
            Documentation = GetDocumentation(classDecl),
            Location = GetLocation(classDecl)
        };
    }

    private static SymbolInfo AnalyzeFilter(ClassDeclarationSyntax classDecl)
    {
        var methods = classDecl.DescendantNodes()
            .OfType<MethodDeclarationSyntax>()
            .Where(m => m.Identifier.Text.Contains("OnAction") || 
                       m.Identifier.Text.Contains("OnResult") ||
                       m.Identifier.Text.Contains("OnException"))
            .Select(m => m.Identifier.Text)
            .ToList();

        return new SymbolInfo
        {
            Name = classDecl.Identifier.Text,
            Type = "filter",
            Methods = methods,
            Documentation = GetDocumentation(classDecl),
            Location = GetLocation(classDecl)
        };
    }

    private static SymbolInfo AnalyzeRazorPage(FileScopedNamespaceDeclarationSyntax ns)
    {
        var pageClass = ns.DescendantNodes()
            .OfType<ClassDeclarationSyntax>()
            .First(c => c.BaseList?.Types.Any(t => t.ToString().Contains("RazorPage")) == true);

        var methods = pageClass.DescendantNodes()
            .OfType<MethodDeclarationSyntax>()
            .Select(m => m.Identifier.Text)
            .ToList();

        return new SymbolInfo
        {
            Name = pageClass.Identifier.Text,
            Type = "razor",
            Methods = methods,
            Documentation = GetDocumentation(pageClass),
            Location = GetLocation(pageClass)
        };
    }

    private static SymbolInfo AnalyzeStartup(ClassDeclarationSyntax classDecl)
    {
        var endpoints = classDecl.DescendantNodes()
            .OfType<InvocationExpressionSyntax>()
            .Where(i => i.ToString().Contains("MapControllers") ||
                       i.ToString().Contains("MapRazorPages") ||
                       i.ToString().Contains("MapHub"))
            .Select(i => i.ToString())
            .ToList();

        var services = classDecl.DescendantNodes()
            .OfType<InvocationExpressionSyntax>()
            .Where(i => i.ToString().Contains("AddScoped") ||
                       i.ToString().Contains("AddSingleton") ||
                       i.ToString().Contains("AddTransient"))
            .Select(i => i.ToString())
            .ToList();

        return new SymbolInfo
        {
            Name = classDecl.Identifier.Text,
            Type = "startup",
            Endpoints = endpoints,
            Dependencies = services,
            Documentation = GetDocumentation(classDecl),
            Location = GetLocation(classDecl)
        };
    }

    private static string GetDocumentation(SyntaxNode node)
    {
        var trivia = node.GetLeadingTrivia()
            .Where(t => t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia) ||
                       t.IsKind(SyntaxKind.MultiLineDocumentationCommentTrivia));

        return string.Join("\\n", trivia.Select(t => t.ToString()));
    }

    private static Location GetLocation(SyntaxNode node)
    {
        var span = node.GetLocation().GetLineSpan();
        return new Location
        {
            Line = span.StartLinePosition.Line + 1,
            Column = span.StartLinePosition.Character,
            EndLine = span.EndLinePosition.Line + 1,
            EndColumn = span.EndLinePosition.Character
        };
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
                    console.error('ASP.NET Core analiz hatası:', data.toString());
                });
                csharpProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('ASP.NET Core analizi başarısız oldu'));
                    }
                });
            });

            const analysisResult = JSON.parse(output);
            
            if (analysisResult.error) {
                throw new Error(analysisResult.error);
            }

            // Sonuçları VSCode formatına dönüştür
            return {
                ast: this.createASTNode(analysisResult),
                symbols: this.createSymbolsMap(analysisResult.Symbols),
                dependencies: this.createDependenciesMap(analysisResult.Dependencies),
                metrics: this.createMetrics(analysisResult)
            };

        } catch (error) {
            console.error('ASP.NET Core analiz hatası:', error);
            throw error;
        }
    }

    private createASTNode(result: any): SemanticNode {
        return {
            type: 'File',
            name: 'root',
            location: new vscode.Location(
                vscode.Uri.file(''),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: any[]): Map<string, SemanticNode> {
        const result = new Map<string, SemanticNode>();
        
        for (const symbol of symbols) {
            result.set(symbol.Name, {
                type: symbol.Type,
                name: symbol.Name,
                location: new vscode.Location(
                    vscode.Uri.file(''),
                    new vscode.Range(
                        symbol.Location.Line - 1,
                        symbol.Location.Column,
                        symbol.Location.EndLine - 1,
                        symbol.Location.EndColumn
                    )
                ),
                documentation: symbol.Documentation
            });
        }
        
        return result;
    }

    private createDependenciesMap(dependencies: any): Map<string, string[]> {
        return new Map(Object.entries(dependencies));
    }

    private createMetrics(result: any): CodeMetrics {
        return {
            complexity: result.Complexity,
            linesOfCode: result.LinesOfCode,
            commentLines: result.CommentLines,
            dependencies: Object.keys(result.Dependencies || {}).length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                result.Complexity,
                result.LinesOfCode,
                result.CommentLines
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