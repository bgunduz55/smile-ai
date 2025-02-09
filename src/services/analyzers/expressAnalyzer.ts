import * as vscode from 'vscode';
import { parse as parseScript } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface ExpressSymbol {
    name: string;
    type: 'route' | 'middleware' | 'controller' | 'model' | 'auth' | 'database';
    method?: string;
    path?: string;
    params?: string[];
    middleware?: string[];
    validation?: string[];
    documentation?: string;
    location: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
    };
}

export class ExpressAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeExpressContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeExpressContent(content: string): Promise<AnalysisResult> {
        try {
            const ast = parseScript(content, {
                sourceType: 'module',
                plugins: ['typescript', 'decorators-legacy']
            });

            // Route ve middleware analizi
            const routeSymbols = this.analyzeRoutes(ast);
            
            // Controller analizi
            const controllerSymbols = this.analyzeControllers(ast);
            
            // Model analizi
            const modelSymbols = this.analyzeModels(ast);
            
            // Auth analizi
            const authSymbols = this.analyzeAuth(ast);
            
            // Database analizi
            const dbSymbols = this.analyzeDatabase(ast);

            // Tüm sembolleri birleştir
            const symbols = [
                ...routeSymbols,
                ...controllerSymbols,
                ...modelSymbols,
                ...authSymbols,
                ...dbSymbols
            ];

            // Bağımlılıkları analiz et
            const dependencies = this.analyzeDependencies(ast);

            // Kod metriklerini hesapla
            const metrics = this.calculateMetrics(content, symbols);

            return {
                ast: this.createASTNode(ast),
                symbols: this.createSymbolsMap(symbols),
                dependencies,
                metrics
            };
        } catch (error) {
            console.error('Express analiz hatası:', error);
            throw error;
        }
    }

    private analyzeRoutes(ast: t.File): ExpressSymbol[] {
        const symbols: ExpressSymbol[] = [];

        traverse(ast, {
            CallExpression(path) {
                // app.get/post/put/delete vb. metodları
                if (
                    t.isMemberExpression(path.node.callee) &&
                    t.isIdentifier(path.node.callee.object) &&
                    t.isIdentifier(path.node.callee.property) &&
                    ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(path.node.callee.property.name)
                ) {
                    const method = path.node.callee.property.name.toUpperCase();
                    const routePath = t.isStringLiteral(path.node.arguments[0]) ? path.node.arguments[0].value : '';
                    const params = this.extractRouteParams(routePath);
                    const middleware = this.extractMiddleware(path.node.arguments.slice(1));

                    symbols.push({
                        name: `${method} ${routePath}`,
                        type: 'route',
                        method,
                        path: routePath,
                        params,
                        middleware,
                        location: this.getNodeLocation(path.node),
                        documentation: this.getNodeDocumentation(path.node)
                    });
                }

                // Router tanımları
                if (
                    t.isMemberExpression(path.node.callee) &&
                    t.isIdentifier(path.node.callee.object) &&
                    t.isIdentifier(path.node.callee.property) &&
                    path.node.callee.property.name === 'Router'
                ) {
                    symbols.push({
                        name: 'Router',
                        type: 'route',
                        location: this.getNodeLocation(path.node),
                        documentation: this.getNodeDocumentation(path.node)
                    });
                }

                // Middleware tanımları
                if (
                    t.isMemberExpression(path.node.callee) &&
                    t.isIdentifier(path.node.callee.object) &&
                    t.isIdentifier(path.node.callee.property) &&
                    path.node.callee.property.name === 'use'
                ) {
                    symbols.push({
                        name: 'Middleware',
                        type: 'middleware',
                        location: this.getNodeLocation(path.node),
                        documentation: this.getNodeDocumentation(path.node)
                    });
                }
            }
        });

        return symbols;
    }

    private analyzeControllers(ast: t.File): ExpressSymbol[] {
        const symbols: ExpressSymbol[] = [];

        traverse(ast, {
            FunctionDeclaration(path) {
                // Controller fonksiyonları
                if (this.isControllerFunction(path.node)) {
                    const validation = this.extractValidation(path.node);
                    symbols.push({
                        name: path.node.id?.name || 'AnonymousController',
                        type: 'controller',
                        validation,
                        location: this.getNodeLocation(path.node),
                        documentation: this.getNodeDocumentation(path.node)
                    });
                }
            },

            ArrowFunctionExpression(path) {
                // Arrow function controller'lar
                if (this.isControllerFunction(path.node)) {
                    const validation = this.extractValidation(path.node);
                    const parentName = this.getParentName(path);
                    symbols.push({
                        name: parentName || 'AnonymousController',
                        type: 'controller',
                        validation,
                        location: this.getNodeLocation(path.node),
                        documentation: this.getNodeDocumentation(path.node)
                    });
                }
            }
        });

        return symbols;
    }

    private analyzeModels(ast: t.File): ExpressSymbol[] {
        const symbols: ExpressSymbol[] = [];

        traverse(ast, {
            CallExpression(path) {
                // Mongoose/Sequelize model tanımları
                if (this.isModelDefinition(path.node)) {
                    symbols.push({
                        name: this.extractModelName(path.node),
                        type: 'model',
                        location: this.getNodeLocation(path.node),
                        documentation: this.getNodeDocumentation(path.node)
                    });
                }
            }
        });

        return symbols;
    }

    private analyzeAuth(ast: t.File): ExpressSymbol[] {
        const symbols: ExpressSymbol[] = [];

        traverse(ast, {
            CallExpression(path) {
                // Passport/JWT/Session middleware'leri
                if (this.isAuthMiddleware(path.node)) {
                    symbols.push({
                        name: 'AuthMiddleware',
                        type: 'auth',
                        location: this.getNodeLocation(path.node),
                        documentation: this.getNodeDocumentation(path.node)
                    });
                }
            }
        });

        return symbols;
    }

    private analyzeDatabase(ast: t.File): ExpressSymbol[] {
        const symbols: ExpressSymbol[] = [];

        traverse(ast, {
            CallExpression(path) {
                // Database bağlantıları ve işlemleri
                if (this.isDatabaseOperation(path.node)) {
                    symbols.push({
                        name: 'DatabaseOperation',
                        type: 'database',
                        location: this.getNodeLocation(path.node),
                        documentation: this.getNodeDocumentation(path.node)
                    });
                }
            }
        });

        return symbols;
    }

    private extractRouteParams(path: string): string[] {
        const params: string[] = [];
        const paramRegex = /:(\w+)/g;
        let match;

        while ((match = paramRegex.exec(path)) !== null) {
            params.push(match[1]);
        }

        return params;
    }

    private extractMiddleware(args: t.Node[]): string[] {
        return args
            .filter(arg => t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg))
            .map(arg => {
                if (t.isFunctionExpression(arg) && arg.id) {
                    return arg.id.name;
                }
                return 'anonymous';
            });
    }

    private extractValidation(node: t.Node): string[] {
        const validation: string[] = [];

        traverse(node, {
            CallExpression(path) {
                if (this.isValidationCall(path.node)) {
                    validation.push(this.getValidationRule(path.node));
                }
            }
        });

        return validation;
    }

    private isControllerFunction(node: t.Node): boolean {
        if (!t.isFunctionDeclaration(node) && !t.isArrowFunctionExpression(node)) {
            return false;
        }

        // Request ve Response parametrelerini kontrol et
        const params = 'params' in node ? node.params : [];
        return params.length >= 2 &&
               params.every(param => t.isIdentifier(param)) &&
               (params[0] as t.Identifier).name === 'req' &&
               (params[1] as t.Identifier).name === 'res';
    }

    private isModelDefinition(node: t.CallExpression): boolean {
        return (
            t.isMemberExpression(node.callee) &&
            t.isIdentifier(node.callee.property) &&
            ['model', 'define'].includes(node.callee.property.name)
        );
    }

    private isAuthMiddleware(node: t.CallExpression): boolean {
        return (
            t.isIdentifier(node.callee) &&
            ['passport', 'jwt', 'session'].some(name => node.callee.name.toLowerCase().includes(name))
        );
    }

    private isDatabaseOperation(node: t.CallExpression): boolean {
        return (
            t.isMemberExpression(node.callee) &&
            t.isIdentifier(node.callee.property) &&
            ['find', 'findOne', 'create', 'update', 'delete', 'query'].includes(node.callee.property.name)
        );
    }

    private isValidationCall(node: t.CallExpression): boolean {
        return (
            t.isMemberExpression(node.callee) &&
            t.isIdentifier(node.callee.property) &&
            ['check', 'body', 'param', 'query'].includes(node.callee.property.name)
        );
    }

    private getValidationRule(node: t.CallExpression): string {
        if (t.isStringLiteral(node.arguments[0])) {
            return node.arguments[0].value;
        }
        return 'unknown';
    }

    private extractModelName(node: t.CallExpression): string {
        if (node.arguments.length > 0 && t.isStringLiteral(node.arguments[0])) {
            return node.arguments[0].value;
        }
        return 'AnonymousModel';
    }

    private getParentName(path: any): string {
        const parent = path.parentPath;
        if (parent && t.isVariableDeclarator(parent.node) && t.isIdentifier(parent.node.id)) {
            return parent.node.id.name;
        }
        return 'AnonymousController';
    }

    private analyzeDependencies(ast: t.File): Map<string, string[]> {
        const dependencies = new Map<string, string[]>();

        traverse(ast, {
            ImportDeclaration(path) {
                const source = path.node.source.value;
                const imports = path.node.specifiers.map(specifier => {
                    if (t.isImportDefaultSpecifier(specifier)) {
                        return specifier.local.name;
                    } else if (t.isImportSpecifier(specifier)) {
                        return specifier.imported.name;
                    }
                    return '';
                }).filter(Boolean);

                dependencies.set(source, imports);
            }
        });

        return dependencies;
    }

    private calculateMetrics(content: string, symbols: ExpressSymbol[]): CodeMetrics {
        let complexity = 0;
        let linesOfCode = 0;
        let commentLines = 0;

        // Satır sayısı ve yorum satırları
        const lines = content.split('\n');
        linesOfCode = lines.length;

        lines.forEach(line => {
            if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
                commentLines++;
            }
        });

        // Karmaşıklık hesapla
        complexity += symbols.length; // Her sembol için +1

        const ast = parseScript(content, {
            sourceType: 'module',
            plugins: ['typescript', 'decorators-legacy']
        });

        traverse(ast, {
            IfStatement() { complexity++; },
            SwitchStatement() { complexity++; },
            ForStatement() { complexity++; },
            WhileStatement() { complexity++; },
            DoWhileStatement() { complexity++; },
            TryStatement() { complexity++; },
            CatchClause() { complexity++; }
        });

        return {
            complexity,
            linesOfCode,
            commentLines,
            dependencies: Array.from(this.analyzeDependencies(ast).keys()).length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                complexity,
                linesOfCode,
                commentLines
            )
        };
    }

    private getNodeLocation(node: t.Node): { line: number; column: number; endLine: number; endColumn: number } {
        return {
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column || 0,
            endLine: node.loc?.end.line || 0,
            endColumn: node.loc?.end.column || 0
        };
    }

    private getNodeDocumentation(node: t.Node): string {
        if (!node.leadingComments) {
            return '';
        }

        return node.leadingComments
            .map(comment => comment.value.trim())
            .join('\n');
    }

    private createASTNode(ast: t.File): SemanticNode {
        return {
            type: 'ExpressApplication',
            name: '',
            location: new vscode.Location(
                vscode.Uri.file(''),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: ExpressSymbol[]): Map<string, SemanticNode> {
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