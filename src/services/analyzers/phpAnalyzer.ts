import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

export class PHPAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzePHPContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzePHPContent(content: string): Promise<AnalysisResult> {
        try {
            // PHP analiz script'ini oluştur
            const phpScript = `<?php
require_once 'vendor/autoload.php';

use PhpParser\\ParserFactory;
use PhpParser\\NodeVisitor\\NameResolver;
use PhpParser\\NodeTraverser;
use PhpParser\\Node;
use PhpParser\\Node\\Stmt;
use PhpParser\\NodeVisitorAbstract;

class SymbolCollector extends NodeVisitorAbstract {
    public $symbols = [];
    public $complexity = 0;
    public $dependencies = [];
    
    public function enterNode(Node $node) {
        if ($node instanceof Stmt\\Function_ || $node instanceof Stmt\\ClassMethod) {
            $this->symbols[] = [
                'type' => 'function',
                'name' => $node->name->toString(),
                'line' => $node->getStartLine(),
                'column' => 0,
                'end_line' => $node->getEndLine(),
                'end_column' => 0,
                'documentation' => $this->getDocComment($node)
            ];
            $this->complexity++;
        } elseif ($node instanceof Stmt\\Class_) {
            $this->symbols[] = [
                'type' => 'class',
                'name' => $node->name->toString(),
                'line' => $node->getStartLine(),
                'column' => 0,
                'end_line' => $node->getEndLine(),
                'end_column' => 0,
                'documentation' => $this->getDocComment($node)
            ];
        } elseif ($node instanceof Stmt\\Interface_) {
            $this->symbols[] = [
                'type' => 'interface',
                'name' => $node->name->toString(),
                'line' => $node->getStartLine(),
                'column' => 0,
                'end_line' => $node->getEndLine(),
                'end_column' => 0,
                'documentation' => $this->getDocComment($node)
            ];
        } elseif ($node instanceof Stmt\\Use_) {
            foreach ($node->uses as $use) {
                $this->dependencies[] = $use->name->toString();
            }
        } elseif ($node instanceof Stmt\\If_ || 
                  $node instanceof Stmt\\While_ || 
                  $node instanceof Stmt\\For_ || 
                  $node instanceof Stmt\\Foreach_ || 
                  $node instanceof Stmt\\Switch_ || 
                  $node instanceof Stmt\\TryCatch) {
            $this->complexity++;
        }
    }
    
    private function getDocComment(Node $node) {
        return $node->getDocComment() ? $node->getDocComment()->getText() : '';
    }
}

// Stdin'den kodu oku
$code = file_get_contents('php://stdin');

// Parser oluştur
$parser = (new ParserFactory)->create(ParserFactory::PREFER_PHP7);

try {
    // Kodu parse et
    $ast = $parser->parse($code);
    
    // AST analizi yap
    $traverser = new NodeTraverser();
    $collector = new SymbolCollector();
    $traverser->addVisitor(new NameResolver());
    $traverser->addVisitor($collector);
    $traverser->traverse($ast);
    
    // Yorum satırlarını say
    $comment_lines = 0;
    $lines = explode("\\n", $code);
    foreach ($lines as $line) {
        if (preg_match('/^\s*(\/\/|\/\*|\*)/', trim($line))) {
            $comment_lines++;
        }
    }
    
    // Sonucu oluştur
    $result = [
        'success' => true,
        'symbols' => $collector->symbols,
        'complexity' => $collector->complexity,
        'lines_of_code' => count($lines),
        'comment_lines' => $comment_lines,
        'dependencies' => array_unique($collector->dependencies)
    ];
    
    echo json_encode($result);
} catch (Error $e) {
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}`;

            // PHP process'ini başlat
            const phpProcess = spawn('php', []);
            
            // Kodu gönder
            phpProcess.stdin.write(content);
            phpProcess.stdin.end();

            // Sonucu al
            const output = await new Promise<string>((resolve, reject) => {
                let result = '';
                phpProcess.stdout.on('data', (data) => {
                    result += data.toString();
                });
                phpProcess.stderr.on('data', (data) => {
                    console.error('PHP analiz hatası:', data.toString());
                });
                phpProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('PHP analizi başarısız oldu'));
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
            console.error('PHP analiz hatası:', error);
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
                        0,
                        symbol.end_line - 1,
                        0
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