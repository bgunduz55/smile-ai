import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

export class PythonAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzePythonContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzePythonContent(content: string): Promise<AnalysisResult> {
        try {
            // Python script'ini oluştur
            const pythonScript = `
import ast
import json
import sys

class ASTAnalyzer(ast.NodeVisitor):
    def __init__(self):
        self.symbols = {}
        self.dependencies = {}
        self.complexity = 0
        self.current_function = None
        
    def visit_Import(self, node):
        for name in node.names:
            self.dependencies[name.name] = []
        self.generic_visit(node)
        
    def visit_ImportFrom(self, node):
        imports = [alias.name for alias in node.names]
        self.dependencies[node.module] = imports
        self.generic_visit(node)
        
    def visit_FunctionDef(self, node):
        self.current_function = node.name
        self.symbols[node.name] = {
            'type': 'function',
            'line': node.lineno,
            'col': node.col_offset,
            'end_line': node.end_lineno,
            'end_col': node.end_col_offset,
            'doc': ast.get_docstring(node)
        }
        self.generic_visit(node)
        self.current_function = None
        
    def visit_ClassDef(self, node):
        self.symbols[node.name] = {
            'type': 'class',
            'line': node.lineno,
            'col': node.col_offset,
            'end_line': node.end_lineno,
            'end_col': node.end_col_offset,
            'doc': ast.get_docstring(node)
        }
        self.generic_visit(node)
        
    def visit_If(self, node):
        self.complexity += 1
        self.generic_visit(node)
        
    def visit_For(self, node):
        self.complexity += 1
        self.generic_visit(node)
        
    def visit_While(self, node):
        self.complexity += 1
        self.generic_visit(node)
        
    def visit_Try(self, node):
        self.complexity += 1
        self.generic_visit(node)

def analyze_code(code):
    try:
        tree = ast.parse(code)
        analyzer = ASTAnalyzer()
        analyzer.visit(tree)
        
        # Yorum satırlarını say
        comment_lines = len([line for line in code.split('\\n') 
                           if line.strip().startswith('#')])
        
        # Toplam satır sayısı
        total_lines = len(code.split('\\n'))
        
        return {
            'success': True,
            'symbols': analyzer.symbols,
            'dependencies': analyzer.dependencies,
            'metrics': {
                'complexity': analyzer.complexity,
                'lines_of_code': total_lines,
                'comment_lines': comment_lines
            }
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

# Stdin'den kodu oku
code = sys.stdin.read()
result = analyze_code(code)
print(json.dumps(result))
`;

            // Python process'ini başlat
            const pythonProcess = spawn('python', ['-c', pythonScript]);
            
            // Kodu gönder
            pythonProcess.stdin.write(content);
            pythonProcess.stdin.end();

            // Sonucu al
            const output = await new Promise<string>((resolve, reject) => {
                let result = '';
                pythonProcess.stdout.on('data', (data) => {
                    result += data.toString();
                });
                pythonProcess.stderr.on('data', (data) => {
                    console.error('Python analiz hatası:', data.toString());
                });
                pythonProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('Python analizi başarısız oldu'));
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
                metrics: this.createMetrics(analysisResult.metrics)
            };

        } catch (error) {
            console.error('Python analiz hatası:', error);
            throw error;
        }
    }

    private createASTNode(result: any): SemanticNode {
        return {
            type: 'Module',
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
                        info.col,
                        info.end_line - 1,
                        info.end_col
                    )
                ),
                documentation: info.doc || undefined
            });
        }
        
        return result;
    }

    private createDependenciesMap(dependencies: any): Map<string, string[]> {
        return new Map(Object.entries(dependencies));
    }

    private createMetrics(metrics: any): CodeMetrics {
        return {
            complexity: metrics.complexity,
            linesOfCode: metrics.lines_of_code,
            commentLines: metrics.comment_lines,
            dependencies: Object.keys(metrics.dependencies || {}).length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                metrics.complexity,
                metrics.lines_of_code,
                metrics.comment_lines
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