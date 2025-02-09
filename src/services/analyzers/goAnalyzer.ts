import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

export class GoAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeGoContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeGoContent(content: string): Promise<AnalysisResult> {
        try {
            // Go analiz script'ini oluştur
            const goScript = `
package main

import (
    "encoding/json"
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
    "io/ioutil"
    "os"
    "strings"
)

type Symbol struct {
    Type         string \`json:"type"\`
    Name         string \`json:"name"\`
    Line         int    \`json:"line"\`
    Column       int    \`json:"column"\`
    EndLine      int    \`json:"endLine"\`
    EndColumn    int    \`json:"endColumn"\`
    Documentation string \`json:"documentation"\`
}

type Analysis struct {
    Success      bool              \`json:"success"\`
    Complexity   int               \`json:"complexity"\`
    Symbols      map[string]Symbol \`json:"symbols"\`
    Dependencies map[string][]string \`json:"dependencies"\`
    LinesOfCode  int               \`json:"lines_of_code"\`
    CommentLines int               \`json:"comment_lines"\`
}

func main() {
    // Stdin'den kodu oku
    content, err := ioutil.ReadAll(os.Stdin)
    if err != nil {
        json.NewEncoder(os.Stdout).Encode(map[string]interface{}{
            "success": false,
            "error":   err.Error(),
        })
        return
    }

    // AST oluştur
    fset := token.NewFileSet()
    file, err := parser.ParseFile(fset, "", string(content), parser.ParseComments)
    if err != nil {
        json.NewEncoder(os.Stdout).Encode(map[string]interface{}{
            "success": false,
            "error":   err.Error(),
        })
        return
    }

    analysis := Analysis{
        Success:      true,
        Complexity:   0,
        Symbols:      make(map[string]Symbol),
        Dependencies: make(map[string][]string),
        LinesOfCode:  len(strings.Split(string(content), "\\n")),
        CommentLines: len(file.Comments),
    }

    // AST'yi dolaş
    ast.Inspect(file, func(n ast.Node) bool {
        switch node := n.(type) {
        case *ast.FuncDecl:
            // Fonksiyon analizi
            pos := fset.Position(node.Pos())
            end := fset.Position(node.End())
            analysis.Symbols[node.Name.Name] = Symbol{
                Type:      "function",
                Name:      node.Name.Name,
                Line:      pos.Line,
                Column:    pos.Column,
                EndLine:   end.Line,
                EndColumn: end.Column,
                Documentation: getDocString(node.Doc),
            }
            analysis.Complexity++

        case *ast.TypeSpec:
            // Tip tanımı analizi
            if _, ok := node.Type.(*ast.StructType); ok {
                pos := fset.Position(node.Pos())
                end := fset.Position(node.End())
                analysis.Symbols[node.Name.Name] = Symbol{
                    Type:      "struct",
                    Name:      node.Name.Name,
                    Line:      pos.Line,
                    Column:    pos.Column,
                    EndLine:   end.Line,
                    EndColumn: end.Column,
                    Documentation: getDocString(node.Doc),
                }
            }

        case *ast.ImportSpec:
            // Import analizi
            path := strings.Trim(node.Path.Value, "\\"")
            analysis.Dependencies[path] = []string{}

        case *ast.IfStmt, *ast.ForStmt, *ast.RangeStmt, *ast.SwitchStmt, *ast.SelectStmt:
            // Karmaşıklık analizi
            analysis.Complexity++
        }
        return true
    })

    // Sonucu yazdır
    json.NewEncoder(os.Stdout).Encode(analysis)
}

func getDocString(doc *ast.CommentGroup) string {
    if doc == nil {
        return ""
    }
    return doc.Text()
}`;

            // Go process'ini başlat
            const goProcess = spawn('go', ['run', '-']);
            
            // Kodu gönder
            goProcess.stdin.write(content);
            goProcess.stdin.end();

            // Sonucu al
            const output = await new Promise<string>((resolve, reject) => {
                let result = '';
                goProcess.stdout.on('data', (data) => {
                    result += data.toString();
                });
                goProcess.stderr.on('data', (data) => {
                    console.error('Go analiz hatası:', data.toString());
                });
                goProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('Go analizi başarısız oldu'));
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
            console.error('Go analiz hatası:', error);
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
                        info.column - 1,
                        info.endLine - 1,
                        info.endColumn - 1
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