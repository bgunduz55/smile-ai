import * as vscode from 'vscode';
import * as ts from 'typescript';
import { CompilerHost, createProgram } from '@angular/compiler-cli';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface AngularSymbol {
    name: string;
    type: 'component' | 'module' | 'service' | 'pipe' | 'directive';
    selector?: string;
    templateUrl?: string;
    styleUrls?: string[];
    providers?: string[];
    imports?: string[];
    exports?: string[];
    declarations?: string[];
    metadata?: any;
    documentation?: string;
    location: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
    };
}

export class AngularAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeAngularContent(content, filePath);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeAngularContent(content: string, filePath: string): Promise<AnalysisResult> {
        try {
            // TypeScript AST oluştur
            const sourceFile = ts.createSourceFile(
                filePath,
                content,
                ts.ScriptTarget.Latest,
                true
            );

            // Angular sembolleri topla
            const symbols = this.collectAngularSymbols(sourceFile);
            
            // Bağımlılıkları analiz et
            const dependencies = this.analyzeDependencies(symbols);
            
            // Kod metriklerini hesapla
            const metrics = this.calculateMetrics(sourceFile, content, symbols);

            return {
                ast: this.createASTNode(sourceFile),
                symbols: this.createSymbolsMap(symbols),
                dependencies: dependencies,
                metrics: metrics
            };
        } catch (error) {
            console.error('Angular analiz hatası:', error);
            throw error;
        }
    }

    private collectAngularSymbols(sourceFile: ts.SourceFile): AngularSymbol[] {
        const symbols: AngularSymbol[] = [];

        const visit = (node: ts.Node) => {
            if (ts.isClassDeclaration(node)) {
                const decorators = ts.getDecorators(node);
                if (decorators) {
                    decorators.forEach(decorator => {
                        if (ts.isCallExpression(decorator.expression)) {
                            const decoratorName = decorator.expression.expression.getText();
                            const metadata = this.extractDecoratorMetadata(decorator.expression);

                            switch (decoratorName) {
                                case 'Component':
                                    symbols.push(this.createComponentSymbol(node, metadata));
                                    break;
                                case 'NgModule':
                                    symbols.push(this.createModuleSymbol(node, metadata));
                                    break;
                                case 'Injectable':
                                    symbols.push(this.createServiceSymbol(node, metadata));
                                    break;
                                case 'Pipe':
                                    symbols.push(this.createPipeSymbol(node, metadata));
                                    break;
                                case 'Directive':
                                    symbols.push(this.createDirectiveSymbol(node, metadata));
                                    break;
                            }
                        }
                    });
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return symbols;
    }

    private extractDecoratorMetadata(expression: ts.CallExpression): any {
        const metadata: any = {};
        
        if (expression.arguments.length > 0) {
            const arg = expression.arguments[0];
            if (ts.isObjectLiteralExpression(arg)) {
                arg.properties.forEach(prop => {
                    if (ts.isPropertyAssignment(prop)) {
                        const name = prop.name.getText();
                        const value = prop.initializer;
                        
                        if (ts.isStringLiteral(value)) {
                            metadata[name] = value.text;
                        } else if (ts.isArrayLiteralExpression(value)) {
                            metadata[name] = value.elements.map(e => e.getText());
                        } else {
                            metadata[name] = value.getText();
                        }
                    }
                });
            }
        }
        
        return metadata;
    }

    private createComponentSymbol(node: ts.ClassDeclaration, metadata: any): AngularSymbol {
        return {
            name: node.name?.text || 'AnonymousComponent',
            type: 'component',
            selector: metadata.selector,
            templateUrl: metadata.templateUrl,
            styleUrls: metadata.styleUrls,
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createModuleSymbol(node: ts.ClassDeclaration, metadata: any): AngularSymbol {
        return {
            name: node.name?.text || 'AnonymousModule',
            type: 'module',
            imports: metadata.imports,
            exports: metadata.exports,
            declarations: metadata.declarations,
            providers: metadata.providers,
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createServiceSymbol(node: ts.ClassDeclaration, metadata: any): AngularSymbol {
        return {
            name: node.name?.text || 'AnonymousService',
            type: 'service',
            providers: metadata.providedIn ? [metadata.providedIn] : undefined,
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createPipeSymbol(node: ts.ClassDeclaration, metadata: any): AngularSymbol {
        return {
            name: node.name?.text || 'AnonymousPipe',
            type: 'pipe',
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createDirectiveSymbol(node: ts.ClassDeclaration, metadata: any): AngularSymbol {
        return {
            name: node.name?.text || 'AnonymousDirective',
            type: 'directive',
            selector: metadata.selector,
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private getNodeLocation(node: ts.Node): { line: number; column: number; endLine: number; endColumn: number } {
        const sourceFile = node.getSourceFile();
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        
        return {
            line: start.line + 1,
            column: start.character,
            endLine: end.line + 1,
            endColumn: end.character
        };
    }

    private getNodeDocumentation(node: ts.Node): string {
        const sourceFile = node.getSourceFile();
        const commentRanges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart());
        
        if (!commentRanges) {
            return '';
        }

        return commentRanges
            .map(range => sourceFile.text.substring(range.pos, range.end))
            .join('\n');
    }

    private analyzeDependencies(symbols: AngularSymbol[]): Map<string, string[]> {
        const dependencies = new Map<string, string[]>();
        
        symbols.forEach(symbol => {
            if (symbol.type === 'module') {
                if (symbol.imports) {
                    dependencies.set('imports', symbol.imports);
                }
                if (symbol.exports) {
                    dependencies.set('exports', symbol.exports);
                }
                if (symbol.declarations) {
                    dependencies.set('declarations', symbol.declarations);
                }
                if (symbol.providers) {
                    dependencies.set('providers', symbol.providers);
                }
            } else if (symbol.type === 'component') {
                const deps: string[] = [];
                if (symbol.templateUrl) deps.push(symbol.templateUrl);
                if (symbol.styleUrls) deps.push(...symbol.styleUrls);
                if (deps.length > 0) {
                    dependencies.set(symbol.name, deps);
                }
            }
        });
        
        return dependencies;
    }

    private calculateMetrics(
        sourceFile: ts.SourceFile,
        content: string,
        symbols: AngularSymbol[]
    ): CodeMetrics {
        let complexity = 0;
        let linesOfCode = content.split('\n').length;
        let commentLines = 0;

        // Yorum satırlarını say
        const lines = content.split('\n');
        lines.forEach(line => {
            if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
                commentLines++;
            }
        });

        // Karmaşıklık hesapla
        complexity += symbols.length; // Her Angular yapısı için +1
        
        const visit = (node: ts.Node) => {
            if (
                ts.isIfStatement(node) ||
                ts.isForStatement(node) ||
                ts.isWhileStatement(node) ||
                ts.isDoStatement(node) ||
                ts.isSwitchStatement(node) ||
                ts.isConditionalExpression(node)
            ) {
                complexity++;
            }
            ts.forEachChild(node, visit);
        };
        
        visit(sourceFile);

        return {
            complexity,
            linesOfCode,
            commentLines,
            dependencies: Array.from(this.analyzeDependencies(symbols).keys()).length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                complexity,
                linesOfCode,
                commentLines
            )
        };
    }

    private createASTNode(sourceFile: ts.SourceFile): SemanticNode {
        return {
            type: 'AngularModule',
            name: sourceFile.fileName,
            location: new vscode.Location(
                vscode.Uri.file(sourceFile.fileName),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: AngularSymbol[]): Map<string, SemanticNode> {
        const result = new Map<string, SemanticNode>();
        
        symbols.forEach(symbol => {
            result.set(symbol.name, {
                type: symbol.type,
                name: symbol.name,
                location: new vscode.Location(
                    vscode.Uri.file(''),
                    new vscode.Range(
                        symbol.location.line - 1,
                        symbol.location.column,
                        symbol.location.endLine - 1,
                        symbol.location.endColumn
                    )
                ),
                documentation: symbol.documentation
            });
        });
        
        return result;
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