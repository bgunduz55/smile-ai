import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

export class CppAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeCppContent(content, filePath);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeCppContent(content: string, filePath: string): Promise<AnalysisResult> {
        try {
            // Python script'ini oluştur (LLVM/Clang AST analizi için)
            const pythonScript = `
import sys
import json
import clang.cindex
from clang.cindex import CursorKind, TypeKind

def get_cursor_location(cursor):
    start = cursor.extent.start
    end = cursor.extent.end
    return {
        'line': start.line,
        'column': start.column,
        'endLine': end.line,
        'endColumn': end.column
    }

class ASTAnalyzer:
    def __init__(self):
        self.complexity = 0
        self.symbols = {}
        self.dependencies = {}
        
    def analyze_node(self, cursor):
        # Karmaşıklık hesapla
        if cursor.kind in [
            CursorKind.IF_STMT,
            CursorKind.FOR_STMT,
            CursorKind.WHILE_STMT,
            CursorKind.DO_STMT,
            CursorKind.SWITCH_STMT,
            CursorKind.CONDITIONAL_OPERATOR
        ]:
            self.complexity += 1
        
        # Sembol analizi
        if cursor.kind in [CursorKind.FUNCTION_DECL, CursorKind.CXX_METHOD]:
            self.symbols[cursor.spelling] = {
                'type': 'function',
                'name': cursor.spelling,
                **get_cursor_location(cursor),
                'documentation': cursor.brief_comment or ''
            }
        elif cursor.kind == CursorKind.CLASS_DECL:
            self.symbols[cursor.spelling] = {
                'type': 'class',
                'name': cursor.spelling,
                **get_cursor_location(cursor),
                'documentation': cursor.brief_comment or ''
            }
        
        # Bağımlılık analizi
        if cursor.kind == CursorKind.INCLUSION_DIRECTIVE:
            included_file = cursor.displayname
            if included_file not in self.dependencies:
                self.dependencies[included_file] = []
        
        # Alt düğümleri analiz et
        for child in cursor.get_children():
            self.analyze_node(child)

def analyze_code(code, file_path):
    try:
        # Clang index'i oluştur
        index = clang.cindex.Index.create()
        
        # Kodu parse et
        tu = index.parse(file_path, unsaved_files=[(file_path, code)])
        
        # AST analizi yap
        analyzer = ASTAnalyzer()
        analyzer.analyze_node(tu.cursor)
        
        # Yorum satırlarını say
        comment_lines = len([
            line for line in code.split('\\n')
            if line.strip().startswith('//') or line.strip().startswith('/*')
        ])
        
        # Toplam satır sayısı
        total_lines = len(code.split('\\n'))
        
        return {
            'success': True,
            'complexity': analyzer.complexity,
            'symbols': analyzer.symbols,
            'dependencies': analyzer.dependencies,
            'lines_of_code': total_lines,
            'comment_lines': comment_lines
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

# Stdin'den kodu oku
code = sys.stdin.read()
result = analyze_code(code, sys.argv[1])
print(json.dumps(result))
`;

            // Python process'ini başlat
            const pythonProcess = spawn('python', ['-c', pythonScript, filePath]);
            
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
                    console.error('C++ analiz hatası:', data.toString());
                });
                pythonProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('C++ analizi başarısız oldu'));
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
            console.error('C++ analiz hatası:', error);
            throw error;
        }
    }

    private createASTNode(result: any): SemanticNode {
        return {
            type: 'TranslationUnit',
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