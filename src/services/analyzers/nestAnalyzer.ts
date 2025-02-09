import * as vscode from 'vscode';
import * as ts from 'typescript';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface NestSymbol {
    name: string;
    type: 'module' | 'controller' | 'service' | 'guard' | 'pipe' | 'filter' | 'interceptor' | 'decorator';
    path?: string;
    methods?: string[];
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

export class NestAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeNestContent(content, filePath);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeNestContent(content: string, filePath: string): Promise<AnalysisResult> {
        try {
            // TypeScript kaynak dosyasını oluştur
            const sourceFile = ts.createSourceFile(
                filePath,
                content,
                ts.ScriptTarget.Latest,
                true
            );

            // NestJS sembollerini topla
            const symbols = this.collectNestSymbols(sourceFile);

            // Bağımlılıkları analiz et
            const dependencies = this.analyzeDependencies(sourceFile, symbols);

            // Metrikleri hesapla
            const metrics = this.calculateMetrics(sourceFile, content, symbols);

            return {
                ast: this.createASTNode(sourceFile),
                symbols: this.createSymbolsMap(symbols),
                dependencies,
                metrics
            };
        } catch (error) {
            console.error('NestJS analiz hatası:', error);
            throw error;
        }
    }

    private collectNestSymbols(sourceFile: ts.SourceFile): NestSymbol[] {
        const symbols: NestSymbol[] = [];

        const visit = (node: ts.Node) => {
            if (ts.isClassDeclaration(node)) {
                const decorators = node.decorators?.map(d => 
                    (d.expression as ts.CallExpression).expression.getText()
                ) || [];

                if (decorators.includes('Module')) {
                    symbols.push(this.createModuleSymbol(node));
                } else if (decorators.includes('Controller')) {
                    symbols.push(this.createControllerSymbol(node));
                } else if (decorators.includes('Injectable')) {
                    symbols.push(this.createServiceSymbol(node));
                } else if (decorators.includes('Guard')) {
                    symbols.push(this.createGuardSymbol(node));
                } else if (decorators.includes('Pipe')) {
                    symbols.push(this.createPipeSymbol(node));
                } else if (decorators.includes('Catch')) {
                    symbols.push(this.createFilterSymbol(node));
                } else if (decorators.includes('Injectable') && 
                         this.isInterceptor(node)) {
                    symbols.push(this.createInterceptorSymbol(node));
                }
            } else if (ts.isDecorator(node)) {
                if (this.isCustomDecorator(node)) {
                    symbols.push(this.createDecoratorSymbol(node));
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return symbols;
    }

    private isInterceptor(node: ts.ClassDeclaration): boolean {
        return node.heritageClauses?.some(clause => 
            clause.types.some(type => 
                type.expression.getText() === 'NestInterceptor'
            )
        ) || false;
    }

    private isCustomDecorator(node: ts.Decorator): boolean {
        const expression = node.expression as ts.CallExpression;
        return ts.isCallExpression(expression) && 
               expression.expression.getText().startsWith('createParamDecorator');
    }

    private createModuleSymbol(node: ts.ClassDeclaration): NestSymbol {
        const metadata = this.extractDecoratorMetadata(node, 'Module');
        return {
            name: node.name?.text || 'AnonymousModule',
            type: 'module',
            dependencies: metadata?.imports?.map((imp: any) => imp.name) || [],
            decorators: node.decorators?.map(d => d.getText()) || [],
            metadata,
            documentation: this.getNodeDocumentation(node),
            location: this.getNodeLocation(node)
        };
    }

    private createControllerSymbol(node: ts.ClassDeclaration): NestSymbol {
        const metadata = this.extractDecoratorMetadata(node, 'Controller');
        const methods = this.extractControllerMethods(node);
        return {
            name: node.name?.text || 'AnonymousController',
            type: 'controller',
            path: metadata?.path,
            methods,
            decorators: node.decorators?.map(d => d.getText()) || [],
            metadata,
            documentation: this.getNodeDocumentation(node),
            location: this.getNodeLocation(node)
        };
    }

    private createServiceSymbol(node: ts.ClassDeclaration): NestSymbol {
        return {
            name: node.name?.text || 'AnonymousService',
            type: 'service',
            dependencies: this.extractServiceDependencies(node),
            decorators: node.decorators?.map(d => d.getText()) || [],
            documentation: this.getNodeDocumentation(node),
            location: this.getNodeLocation(node)
        };
    }

    private createGuardSymbol(node: ts.ClassDeclaration): NestSymbol {
        return {
            name: node.name?.text || 'AnonymousGuard',
            type: 'guard',
            decorators: node.decorators?.map(d => d.getText()) || [],
            documentation: this.getNodeDocumentation(node),
            location: this.getNodeLocation(node)
        };
    }

    private createPipeSymbol(node: ts.ClassDeclaration): NestSymbol {
        return {
            name: node.name?.text || 'AnonymousPipe',
            type: 'pipe',
            decorators: node.decorators?.map(d => d.getText()) || [],
            documentation: this.getNodeDocumentation(node),
            location: this.getNodeLocation(node)
        };
    }

    private createFilterSymbol(node: ts.ClassDeclaration): NestSymbol {
        return {
            name: node.name?.text || 'AnonymousFilter',
            type: 'filter',
            decorators: node.decorators?.map(d => d.getText()) || [],
            documentation: this.getNodeDocumentation(node),
            location: this.getNodeLocation(node)
        };
    }

    private createInterceptorSymbol(node: ts.ClassDeclaration): NestSymbol {
        return {
            name: node.name?.text || 'AnonymousInterceptor',
            type: 'interceptor',
            decorators: node.decorators?.map(d => d.getText()) || [],
            documentation: this.getNodeDocumentation(node),
            location: this.getNodeLocation(node)
        };
    }

    private createDecoratorSymbol(node: ts.Decorator): NestSymbol {
        return {
            name: (node.expression as ts.CallExpression).expression.getText(),
            type: 'decorator',
            documentation: this.getNodeDocumentation(node),
            location: this.getNodeLocation(node)
        };
    }

    private extractDecoratorMetadata(node: ts.ClassDeclaration, decoratorName: string): any {
        const decorator = node.decorators?.find(d => 
            (d.expression as ts.CallExpression).expression.getText() === decoratorName
        );

        if (!decorator) return {};

        const expression = decorator.expression as ts.CallExpression;
        const argument = expression.arguments[0];

        if (ts.isObjectLiteralExpression(argument)) {
            return argument.properties.reduce((metadata: any, prop) => {
                if (ts.isPropertyAssignment(prop)) {
                    metadata[prop.name.getText()] = this.evaluateExpression(prop.initializer);
                }
                return metadata;
            }, {});
        }

        return {};
    }

    private evaluateExpression(node: ts.Expression): any {
        if (ts.isArrayLiteralExpression(node)) {
            return node.elements.map(element => this.evaluateExpression(element));
        } else if (ts.isObjectLiteralExpression(node)) {
            return node.properties.reduce((obj: any, prop) => {
                if (ts.isPropertyAssignment(prop)) {
                    obj[prop.name.getText()] = this.evaluateExpression(prop.initializer);
                }
                return obj;
            }, {});
        } else if (ts.isIdentifier(node)) {
            return node.text;
        } else if (ts.isStringLiteral(node)) {
            return node.text;
        } else if (ts.isNumericLiteral(node)) {
            return parseFloat(node.text);
        }
        return node.getText();
    }

    private extractControllerMethods(node: ts.ClassDeclaration): string[] {
        const methods: string[] = [];

        node.members.forEach(member => {
            if (ts.isMethodDeclaration(member) && member.decorators) {
                const httpMethods = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head'];
                const hasHttpDecorator = member.decorators.some(d => 
                    httpMethods.includes((d.expression as ts.CallExpression).expression.getText())
                );

                if (hasHttpDecorator) {
                    methods.push(member.name.getText());
                }
            }
        });

        return methods;
    }

    private extractServiceDependencies(node: ts.ClassDeclaration): string[] {
        const dependencies: string[] = [];

        // Constructor enjeksiyonlarını kontrol et
        node.members.forEach(member => {
            if (ts.isConstructorDeclaration(member)) {
                member.parameters.forEach(param => {
                    if (param.type && ts.isTypeReferenceNode(param.type)) {
                        dependencies.push(param.type.typeName.getText());
                    }
                });
            }
        });

        return dependencies;
    }

    private analyzeDependencies(sourceFile: ts.SourceFile, symbols: NestSymbol[]): Map<string, string[]> {
        const dependencies = new Map<string, string[]>();

        const visit = (node: ts.Node) => {
            if (ts.isImportDeclaration(node)) {
                const moduleName = node.moduleSpecifier.getText().replace(/['"]/g, '');
                const importClause = node.importClause;

                if (importClause) {
                    const imports: string[] = [];
                    
                    if (importClause.name) {
                        imports.push(importClause.name.text);
                    }
                    
                    if (importClause.namedBindings) {
                        if (ts.isNamedImports(importClause.namedBindings)) {
                            imports.push(...importClause.namedBindings.elements.map(e => e.name.text));
                        }
                    }
                    
                    dependencies.set(moduleName, imports);
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        // Sembol bağımlılıklarını ekle
        symbols.forEach(symbol => {
            if (symbol.dependencies) {
                dependencies.set(symbol.name, symbol.dependencies);
            }
        });

        return dependencies;
    }

    private calculateMetrics(
        sourceFile: ts.SourceFile,
        content: string,
        symbols: NestSymbol[]
    ): CodeMetrics {
        let complexity = 0;
        let linesOfCode = content.split('\n').length;
        let commentLines = 0;

        const visit = (node: ts.Node) => {
            // Karmaşıklık hesapla
            if (
                ts.isIfStatement(node) ||
                ts.isForStatement(node) ||
                ts.isWhileStatement(node) ||
                ts.isDoStatement(node) ||
                ts.isSwitchStatement(node) ||
                ts.isConditionalExpression(node) ||
                ts.isCatchClause(node)
            ) {
                complexity++;
            }

            // Yorum satırlarını say
            ts.getLeadingCommentRanges(sourceFile.text, node.pos)?.forEach(() => {
                commentLines++;
            });

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        return {
            complexity,
            linesOfCode,
            commentLines,
            dependencies: symbols.reduce((count, symbol) => 
                count + (symbol.dependencies?.length || 0), 0
            ),
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                complexity,
                linesOfCode,
                commentLines
            )
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
        const commentRanges = ts.getLeadingCommentRanges(sourceFile.text, node.pos);
        
        if (!commentRanges) return '';

        return commentRanges
            .map(range => sourceFile.text.substring(range.pos, range.end))
            .join('\n');
    }

    private createASTNode(sourceFile: ts.SourceFile): SemanticNode {
        return {
            type: 'SourceFile',
            name: sourceFile.fileName,
            location: new vscode.Location(
                vscode.Uri.file(sourceFile.fileName),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: NestSymbol[]): Map<string, SemanticNode> {
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