import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface LaravelSymbol {
    name: string;
    type: 'controller' | 'model' | 'middleware' | 'service' | 'provider' | 'job' | 'event' | 'listener' | 'policy' | 'resource' | 'request' | 'blade';
    path?: string;
    methods?: string[];
    properties?: string[];
    dependencies?: string[];
    attributes?: string[];
    metadata?: any;
    documentation?: string;
    location: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
    };
}

export class LaravelAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeLaravelContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeLaravelContent(content: string): Promise<AnalysisResult> {
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

class LaravelAnalyzer extends NodeVisitorAbstract {
    public $symbols = [];
    public $complexity = 0;
    public $dependencies = [];
    
    public function enterNode(Node $node) {
        if ($node instanceof Stmt\\Class_) {
            $symbol = [
                'type' => $this->getClassType($node),
                'name' => $node->name->toString(),
                'line' => $node->getStartLine(),
                'column' => 0,
                'end_line' => $node->getEndLine(),
                'end_column' => 0,
                'documentation' => $this->getDocComment($node)
            ];
            
            if ($symbol['type'] === 'controller') {
                $symbol['methods'] = $this->getControllerMethods($node);
                $symbol['path'] = $this->getControllerPath($node);
            } elseif ($symbol['type'] === 'model') {
                $symbol['properties'] = $this->getModelProperties($node);
                $symbol['attributes'] = $this->getModelAttributes($node);
            } elseif ($symbol['type'] === 'middleware') {
                $symbol['methods'] = $this->getMiddlewareMethods($node);
            } elseif ($symbol['type'] === 'service') {
                $symbol['dependencies'] = $this->getServiceDependencies($node);
            } elseif ($symbol['type'] === 'provider') {
                $symbol['bindings'] = $this->getProviderBindings($node);
            } elseif ($symbol['type'] === 'job') {
                $symbol['properties'] = $this->getJobProperties($node);
                $symbol['queue'] = $this->getJobQueue($node);
            } elseif ($symbol['type'] === 'event') {
                $symbol['properties'] = $this->getEventProperties($node);
                $symbol['broadcast'] = $this->getEventBroadcast($node);
            } elseif ($symbol['type'] === 'listener') {
                $symbol['handles'] = $this->getListenerHandles($node);
                $symbol['queue'] = $this->getListenerQueue($node);
            } elseif ($symbol['type'] === 'policy') {
                $symbol['model'] = $this->getPolicyModel($node);
                $symbol['methods'] = $this->getPolicyMethods($node);
            } elseif ($symbol['type'] === 'resource') {
                $symbol['model'] = $this->getResourceModel($node);
                $symbol['attributes'] = $this->getResourceAttributes($node);
            } elseif ($symbol['type'] === 'request') {
                $symbol['rules'] = $this->getRequestRules($node);
                $symbol['authorize'] = $this->getRequestAuthorize($node);
            }
            
            $this->symbols[$node->name->toString()] = $symbol;
            $this->complexity++;
        } elseif ($node instanceof Stmt\\If_ || 
                  $node instanceof Stmt\\While_ || 
                  $node instanceof Stmt\\For_ || 
                  $node instanceof Stmt\\Foreach_ || 
                  $node instanceof Stmt\\Switch_ || 
                  $node instanceof Stmt\\TryCatch) {
            $this->complexity++;
        } elseif ($node instanceof Stmt\\Use_) {
            foreach ($node->uses as $use) {
                $this->dependencies[$use->name->toString()] = [];
            }
        }
    }
    
    private function getClassType(Stmt\\Class_ $node) {
        $extends = $node->extends ? $node->extends->toString() : '';
        $implements = array_map(function($interface) {
            return $interface->toString();
        }, $node->implements);
        
        if (strpos($extends, 'Controller') !== false) {
            return 'controller';
        } elseif (strpos($extends, 'Model') !== false) {
            return 'model';
        } elseif (strpos($extends, 'Middleware') !== false) {
            return 'middleware';
        } elseif (strpos($extends, 'ServiceProvider') !== false) {
            return 'provider';
        } elseif (strpos($extends, 'Job') !== false) {
            return 'job';
        } elseif (strpos($extends, 'Event') !== false) {
            return 'event';
        } elseif (strpos($extends, 'Listener') !== false) {
            return 'listener';
        } elseif (strpos($extends, 'Policy') !== false) {
            return 'policy';
        } elseif (strpos($extends, 'Resource') !== false) {
            return 'resource';
        } elseif (strpos($extends, 'FormRequest') !== false) {
            return 'request';
        }
        
        return 'class';
    }
    
    private function getDocComment(Node $node) {
        return $node->getDocComment() ? $node->getDocComment()->getText() : '';
    }
    
    private function getControllerMethods(Stmt\\Class_ $node) {
        $methods = [];
        foreach ($node->getMethods() as $method) {
            if ($method->isPublic()) {
                $methods[] = [
                    'name' => $method->name->toString(),
                    'route' => $this->getMethodRoute($method)
                ];
            }
        }
        return $methods;
    }
    
    private function getMethodRoute($method) {
        foreach ($method->getAttributes() as $attribute) {
            if (strpos($attribute->name->toString(), 'Route') !== false) {
                return $attribute->args[0]->value->value;
            }
        }
        return '';
    }
    
    private function getModelProperties(Stmt\\Class_ $node) {
        $properties = [];
        foreach ($node->getProperties() as $property) {
            $properties[] = [
                'name' => $property->props[0]->name->toString(),
                'type' => $this->getPropertyType($property)
            ];
        }
        return $properties;
    }
    
    private function getPropertyType($property) {
        return $property->type ? $property->type->toString() : 'mixed';
    }
    
    private function getModelAttributes(Stmt\\Class_ $node) {
        $attributes = [];
        foreach ($node->getProperties() as $property) {
            foreach ($property->attrGroups as $attrGroup) {
                foreach ($attrGroup->attrs as $attr) {
                    $attributes[] = $attr->name->toString();
                }
            }
        }
        return $attributes;
    }
    
    private function getMiddlewareMethods(Stmt\\Class_ $node) {
        $methods = [];
        foreach ($node->getMethods() as $method) {
            if ($method->name->toString() === 'handle') {
                $methods[] = [
                    'name' => 'handle',
                    'parameters' => $this->getMethodParameters($method)
                ];
            }
        }
        return $methods;
    }
    
    private function getMethodParameters($method) {
        return array_map(function($param) {
            return [
                'name' => $param->var->name,
                'type' => $param->type ? $param->type->toString() : 'mixed'
            ];
        }, $method->params);
    }
    
    private function getServiceDependencies(Stmt\\Class_ $node) {
        $dependencies = [];
        foreach ($node->getMethods() as $method) {
            if ($method->name->toString() === '__construct') {
                $dependencies = $this->getMethodParameters($method);
            }
        }
        return $dependencies;
    }
    
    private function getProviderBindings(Stmt\\Class_ $node) {
        $bindings = [];
        foreach ($node->getMethods() as $method) {
            if ($method->name->toString() === 'register') {
                // TODO: Analyze method body for bindings
            }
        }
        return $bindings;
    }
    
    private function getJobProperties(Stmt\\Class_ $node) {
        return $this->getModelProperties($node);
    }
    
    private function getJobQueue(Stmt\\Class_ $node) {
        foreach ($node->getProperties() as $property) {
            if ($property->props[0]->name->toString() === 'queue') {
                return $property->props[0]->default->value;
            }
        }
        return 'default';
    }
    
    private function getEventProperties(Stmt\\Class_ $node) {
        return $this->getModelProperties($node);
    }
    
    private function getEventBroadcast(Stmt\\Class_ $node) {
        foreach ($node->implements as $interface) {
            if ($interface->toString() === 'ShouldBroadcast') {
                return true;
            }
        }
        return false;
    }
    
    private function getListenerHandles(Stmt\\Class_ $node) {
        foreach ($node->getMethods() as $method) {
            if ($method->name->toString() === 'handle') {
                return $this->getMethodParameters($method);
            }
        }
        return [];
    }
    
    private function getListenerQueue(Stmt\\Class_ $node) {
        foreach ($node->implements as $interface) {
            if ($interface->toString() === 'ShouldQueue') {
                return true;
            }
        }
        return false;
    }
    
    private function getPolicyModel(Stmt\\Class_ $node) {
        foreach ($node->getMethods() as $method) {
            if ($method->name->toString() === '__construct') {
                $params = $this->getMethodParameters($method);
                return $params[0]['type'] ?? '';
            }
        }
        return '';
    }
    
    private function getPolicyMethods(Stmt\\Class_ $node) {
        $methods = [];
        foreach ($node->getMethods() as $method) {
            if ($method->isPublic() && $method->name->toString() !== '__construct') {
                $methods[] = [
                    'name' => $method->name->toString(),
                    'parameters' => $this->getMethodParameters($method)
                ];
            }
        }
        return $methods;
    }
    
    private function getResourceModel(Stmt\\Class_ $node) {
        foreach ($node->getMethods() as $method) {
            if ($method->name->toString() === 'toArray') {
                $params = $this->getMethodParameters($method);
                return $params[0]['type'] ?? '';
            }
        }
        return '';
    }
    
    private function getResourceAttributes(Stmt\\Class_ $node) {
        $attributes = [];
        foreach ($node->getMethods() as $method) {
            if ($method->name->toString() === 'toArray') {
                // TODO: Analyze method body for attributes
            }
        }
        return $attributes;
    }
    
    private function getRequestRules(Stmt\\Class_ $node) {
        $rules = [];
        foreach ($node->getMethods() as $method) {
            if ($method->name->toString() === 'rules') {
                // TODO: Analyze method body for rules
            }
        }
        return $rules;
    }
    
    private function getRequestAuthorize(Stmt\\Class_ $node) {
        foreach ($node->getMethods() as $method) {
            if ($method->name->toString() === 'authorize') {
                return true;
            }
        }
        return false;
    }
}

// Stdin'den kodu oku
$code = file_get_contents('php://stdin');

try {
    // Parser oluştur
    $parser = (new ParserFactory)->create(ParserFactory::PREFER_PHP7);
    
    // Kodu parse et
    $ast = $parser->parse($code);
    
    // AST analizi yap
    $traverser = new NodeTraverser();
    $analyzer = new LaravelAnalyzer();
    $traverser->addVisitor(new NameResolver());
    $traverser->addVisitor($analyzer);
    $traverser->traverse($ast);
    
    // Yorum satırlarını say
    $comment_lines = 0;
    $lines = explode("\\n", $code);
    foreach ($lines as $line) {
        if (preg_match('/^\s*(\/\/|\*|\/\*)/', trim($line))) {
            $comment_lines++;
        }
    }
    
    // Sonucu oluştur
    $result = [
        'success' => true,
        'symbols' => $analyzer->symbols,
        'complexity' => $analyzer->complexity,
        'dependencies' => $analyzer->dependencies,
        'lines_of_code' => count($lines),
        'comment_lines' => $comment_lines
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
                    console.error('Laravel analiz hatası:', data.toString());
                });
                phpProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('Laravel analizi başarısız oldu'));
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
            console.error('Laravel analiz hatası:', error);
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