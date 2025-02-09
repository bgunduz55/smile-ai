import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

export class RustAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeRustContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeRustContent(content: string): Promise<AnalysisResult> {
        try {
            // Rust analiz script'ini oluştur
            const rustScript = `
use std::io::{self, Read};
use syn::{parse_file, visit::Visit, Item, ItemFn, ItemStruct, ItemEnum, ItemImpl};
use quote::ToTokens;
use serde_json::{json, Value};

#[derive(Default)]
struct SymbolCollector {
    symbols: Vec<Value>,
    complexity: i32,
    lines_of_code: i32,
    comment_lines: i32,
}

impl<'ast> Visit<'ast> for SymbolCollector {
    fn visit_item_fn(&mut self, node: &'ast ItemFn) {
        let start = node.span().start();
        let end = node.span().end();
        
        self.symbols.push(json!({
            "type": "function",
            "name": node.sig.ident.to_string(),
            "line": start.line,
            "column": start.column,
            "end_line": end.line,
            "end_column": end.column,
            "documentation": node.attrs.iter()
                .filter(|attr| attr.path().is_ident("doc"))
                .map(|attr| attr.to_token_stream().to_string())
                .collect::<Vec<_>>()
                .join("\\n")
        }));
        
        // Karmaşıklık analizi
        self.complexity += 1;
        self.visit_block(&node.block);
    }

    fn visit_item_struct(&mut self, node: &'ast ItemStruct) {
        let start = node.span().start();
        let end = node.span().end();
        
        self.symbols.push(json!({
            "type": "struct",
            "name": node.ident.to_string(),
            "line": start.line,
            "column": start.column,
            "end_line": end.line,
            "end_column": end.column,
            "documentation": node.attrs.iter()
                .filter(|attr| attr.path().is_ident("doc"))
                .map(|attr| attr.to_token_stream().to_string())
                .collect::<Vec<_>>()
                .join("\\n")
        }));
    }

    fn visit_item_enum(&mut self, node: &'ast ItemEnum) {
        let start = node.span().start();
        let end = node.span().end();
        
        self.symbols.push(json!({
            "type": "enum",
            "name": node.ident.to_string(),
            "line": start.line,
            "column": start.column,
            "end_line": end.line,
            "end_column": end.column,
            "documentation": node.attrs.iter()
                .filter(|attr| attr.path().is_ident("doc"))
                .map(|attr| attr.to_token_stream().to_string())
                .collect::<Vec<_>>()
                .join("\\n")
        }));
    }

    fn visit_item_impl(&mut self, node: &'ast ItemImpl) {
        let start = node.span().start();
        let end = node.span().end();
        
        if let Some(trait_) = &node.trait_ {
            self.symbols.push(json!({
                "type": "impl",
                "name": format!("impl {} for {}", 
                    trait_.1.to_token_stream().to_string(),
                    node.self_ty.to_token_stream().to_string()
                ),
                "line": start.line,
                "column": start.column,
                "end_line": end.line,
                "end_column": end.column
            }));
        }
    }
}

fn main() {
    let mut content = String::new();
    io::stdin().read_to_string(&mut content).unwrap();
    
    let file = parse_file(&content).unwrap();
    let mut collector = SymbolCollector::default();
    
    // Kod metrikleri hesapla
    collector.lines_of_code = content.lines().count() as i32;
    collector.comment_lines = content.lines()
        .filter(|line| line.trim_start().starts_with("//") || line.trim_start().starts_with("/*"))
        .count() as i32;
    
    // AST analizi yap
    collector.visit_file(&file);
    
    // Sonucu JSON olarak yazdır
    println!("{}", serde_json::to_string(&json!({
        "success": true,
        "symbols": collector.symbols,
        "complexity": collector.complexity,
        "lines_of_code": collector.lines_of_code,
        "comment_lines": collector.comment_lines,
        "dependencies": file.items.iter()
            .filter_map(|item| {
                if let Item::Use(item_use) = item {
                    Some(item_use.to_token_stream().to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    })).unwrap());
}`;

            // Rust process'ini başlat
            const rustProcess = spawn('rustc', ['--edition=2021', '-']);
            
            // Kodu gönder
            rustProcess.stdin.write(content);
            rustProcess.stdin.end();

            // Sonucu al
            const output = await new Promise<string>((resolve, reject) => {
                let result = '';
                rustProcess.stdout.on('data', (data) => {
                    result += data.toString();
                });
                rustProcess.stderr.on('data', (data) => {
                    console.error('Rust analiz hatası:', data.toString());
                });
                rustProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('Rust analizi başarısız oldu'));
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
            console.error('Rust analiz hatası:', error);
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
        
        for (const symbol of symbols) {
            result.set(symbol.name, {
                type: symbol.type,
                name: symbol.name,
                location: new vscode.Location(
                    vscode.Uri.file(''),
                    new vscode.Range(
                        symbol.line - 1,
                        symbol.column - 1,
                        symbol.end_line - 1,
                        symbol.end_column - 1
                    )
                ),
                documentation: symbol.documentation
            });
        }
        
        return result;
    }

    private createDependenciesMap(dependencies: string[]): Map<string, string[]> {
        const result = new Map<string, string[]>();
        dependencies.forEach(dep => {
            result.set(dep, []);
        });
        return result;
    }

    private createMetrics(result: any): CodeMetrics {
        return {
            complexity: result.complexity,
            linesOfCode: result.lines_of_code,
            commentLines: result.comment_lines,
            dependencies: result.dependencies.length,
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