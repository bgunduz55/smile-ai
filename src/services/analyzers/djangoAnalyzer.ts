import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface DjangoSymbol {
    name: string;
    type: 'view' | 'model' | 'form' | 'serializer' | 'admin' | 'middleware' | 'url' | 'template';
    path?: string;
    methods?: string[];
    fields?: string[];
    dependencies?: string[];
    decorators?: string[];
    metadata?: any;
    documentation?: string;
    location: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
    };
}

export class DjangoAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeDjangoContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeDjangoContent(content: string): Promise<AnalysisResult> {
        try {
            // Python analiz script'ini oluştur
            const pythonScript = `
import ast
import json
import sys
from typing import Dict, List, Any

class DjangoAnalyzer(ast.NodeVisitor):
    def __init__(self):
        self.symbols = {}
        self.dependencies = {}
        self.complexity = 0
        self.current_class = None
        
    def visit_ClassDef(self, node):
        self.current_class = node.name
        symbol = {
            'type': self.get_class_type(node),
            'name': node.name,
            'line': node.lineno,
            'column': node.col_offset,
            'end_line': self.get_end_line(node),
            'end_column': self.get_end_column(node),
            'documentation': ast.get_docstring(node),
            'decorators': self.get_decorators(node)
        }
        
        if symbol['type'] == 'view':
            symbol['methods'] = self.get_view_methods(node)
            symbol['path'] = self.get_view_path(node)
        elif symbol['type'] == 'model':
            symbol['fields'] = self.get_model_fields(node)
            symbol['meta'] = self.get_model_meta(node)
        elif symbol['type'] == 'form':
            symbol['fields'] = self.get_form_fields(node)
        elif symbol['type'] == 'serializer':
            symbol['fields'] = self.get_serializer_fields(node)
            symbol['meta'] = self.get_serializer_meta(node)
        elif symbol['type'] == 'admin':
            symbol['model'] = self.get_admin_model(node)
            symbol['fields'] = self.get_admin_fields(node)
        
        self.symbols[node.name] = symbol
        self.generic_visit(node)
        self.current_class = None
        
    def get_class_type(self, node) -> str:
        bases = [base.id for base in node.bases if isinstance(base, ast.Name)]
        if any(base.endswith('View') for base in bases):
            return 'view'
        elif 'Model' in bases:
            return 'model'
        elif 'Form' in bases or 'ModelForm' in bases:
            return 'form'
        elif 'Serializer' in bases or 'ModelSerializer' in bases:
            return 'serializer'
        elif 'ModelAdmin' in bases:
            return 'admin'
        elif 'Middleware' in bases:
            return 'middleware'
        return 'class'
    
    def get_decorators(self, node) -> List[str]:
        return [
            self.get_decorator_name(decorator)
            for decorator in node.decorator_list
        ]
    
    def get_decorator_name(self, node) -> str:
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                return node.func.id
            elif isinstance(node.func, ast.Attribute):
                return node.func.attr
        return ''
    
    def get_view_methods(self, node) -> List[str]:
        methods = []
        for item in node.body:
            if isinstance(item, ast.FunctionDef):
                if item.name in ['get', 'post', 'put', 'delete', 'patch']:
                    methods.append(item.name)
        return methods
    
    def get_view_path(self, node) -> str:
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Call):
                if isinstance(decorator.func, ast.Name) and decorator.func.id == 'path':
                    if decorator.args:
                        return decorator.args[0].s
        return ''
    
    def get_model_fields(self, node) -> List[Dict[str, Any]]:
        fields = []
        for item in node.body:
            if isinstance(item, ast.Assign):
                for target in item.targets:
                    if isinstance(target, ast.Name):
                        if isinstance(item.value, ast.Call):
                            if isinstance(item.value.func, ast.Name):
                                fields.append({
                                    'name': target.id,
                                    'type': item.value.func.id
                                })
        return fields
    
    def get_model_meta(self, node) -> Dict[str, Any]:
        for item in node.body:
            if isinstance(item, ast.ClassDef) and item.name == 'Meta':
                meta = {}
                for meta_item in item.body:
                    if isinstance(meta_item, ast.Assign):
                        for target in meta_item.targets:
                            if isinstance(target, ast.Name):
                                if isinstance(meta_item.value, ast.List):
                                    meta[target.id] = [
                                        elt.s for elt in meta_item.value.elts
                                        if isinstance(elt, ast.Str)
                                    ]
                                elif isinstance(meta_item.value, ast.Str):
                                    meta[target.id] = meta_item.value.s
                return meta
        return {}
    
    def get_form_fields(self, node) -> List[Dict[str, Any]]:
        fields = []
        for item in node.body:
            if isinstance(item, ast.Assign):
                for target in item.targets:
                    if isinstance(target, ast.Name):
                        if isinstance(item.value, ast.Call):
                            if isinstance(item.value.func, ast.Name):
                                fields.append({
                                    'name': target.id,
                                    'type': item.value.func.id
                                })
        return fields
    
    def get_serializer_fields(self, node) -> List[Dict[str, Any]]:
        return self.get_form_fields(node)
    
    def get_serializer_meta(self, node) -> Dict[str, Any]:
        return self.get_model_meta(node)
    
    def get_admin_model(self, node) -> str:
        for item in node.body:
            if isinstance(item, ast.Assign):
                for target in item.targets:
                    if isinstance(target, ast.Name) and target.id == 'model':
                        if isinstance(item.value, ast.Name):
                            return item.value.id
        return ''
    
    def get_admin_fields(self, node) -> List[str]:
        fields = []
        for item in node.body:
            if isinstance(item, ast.Assign):
                for target in item.targets:
                    if isinstance(target, ast.Name):
                        if target.id in ['list_display', 'list_filter', 'search_fields']:
                            if isinstance(item.value, ast.List) or isinstance(item.value, ast.Tuple):
                                fields.extend([
                                    elt.s for elt in item.value.elts
                                    if isinstance(elt, ast.Str)
                                ])
        return fields
    
    def get_end_line(self, node) -> int:
        return max(
            getattr(node, 'lineno', 0),
            max(
                (self.get_end_line(child) for child in ast.iter_child_nodes(node)),
                default=0
            )
        )
    
    def get_end_column(self, node) -> int:
        return node.col_offset + len(ast.dump(node))
    
    def visit_Import(self, node):
        for name in node.names:
            self.dependencies[name.name] = []
        self.generic_visit(node)
    
    def visit_ImportFrom(self, node):
        if node.module:
            self.dependencies[node.module] = [
                alias.name for alias in node.names
            ]
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

def analyze_code(code: str) -> Dict[str, Any]:
    try:
        tree = ast.parse(code)
        analyzer = DjangoAnalyzer()
        analyzer.visit(tree)
        
        # Yorum satırlarını say
        comment_lines = len([
            line for line in code.split('\\n')
            if line.strip().startswith('#')
        ])
        
        return {
            'success': True,
            'symbols': analyzer.symbols,
            'dependencies': analyzer.dependencies,
            'complexity': analyzer.complexity,
            'lines_of_code': len(code.split('\\n')),
            'comment_lines': comment_lines
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

if __name__ == '__main__':
    code = sys.stdin.read()
    result = analyze_code(code)
    print(json.dumps(result))`;

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
                    console.error('Django analiz hatası:', data.toString());
                });
                pythonProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('Django analizi başarısız oldu'));
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
            console.error('Django analiz hatası:', error);
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
                        info.column,
                        info.end_line - 1,
                        info.end_column
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