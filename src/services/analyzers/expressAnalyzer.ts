import * as vscode from 'vscode';
import * as ts from 'typescript';
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
            // TypeScript kaynak dosyasını oluştur
            const sourceFile = ts.createSourceFile(
                'temp.ts',
                content,
                ts.ScriptTarget.Latest,
                true
            );

            // Express.js sembollerini topla
            const symbols: ExpressSymbol[] = [];

            // Route tanımlarını analiz et
            const routes = this.analyzeRoutes(sourceFile);
            symbols.push(...routes);

            // Controller'ları analiz et
            const controllers = this.analyzeControllers(sourceFile);
            symbols.push(...controllers);

            // Middleware'leri analiz et
            const middleware = this.analyzeMiddleware(sourceFile);
            symbols.push(...middleware);

            // Model'leri analiz et
            const models = this.analyzeModels(sourceFile);
            symbols.push(...models);

            // Auth işlemlerini analiz et
            const auth = this.analyzeAuth(sourceFile);
            symbols.push(...auth);

            // Database işlemlerini analiz et
            const database = this.analyzeDatabase(sourceFile);
            symbols.push(...database);

            // Bağımlılıkları analiz et
            const dependencies = this.analyzeDependencies(sourceFile);

            // Metrikleri hesapla
            const metrics = this.calculateMetrics(content, symbols);

            return {
                ast: this.createASTNode(sourceFile),
                symbols: this.createSymbolsMap(symbols),
                dependencies,
                metrics
            };

        } catch (error) {
            console.error('Express.js analiz hatası:', error);
            throw error;
        }
    }

    private analyzeRoutes(sourceFile: ts.SourceFile): ExpressSymbol[] {
        const routes: ExpressSymbol[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node)) {
                const methodName = node.expression.getText();
                if (['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(methodName)) {
                    const [pathArg, ...handlers] = node.arguments;
                    if (pathArg && ts.isStringLiteral(pathArg)) {
                        routes.push({
                            type: 'route',
                            name: `${methodName.toUpperCase()} ${pathArg.text}`,
                            method: methodName.toUpperCase(),
                            path: pathArg.text,
                            params: this.extractRouteParams(pathArg.text),
                            middleware: this.extractMiddleware(handlers),
                            location: this.getNodeLocation(node)
                        });
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return routes;
    }

    private analyzeMiddleware(sourceFile: ts.SourceFile): ExpressSymbol[] {
        const middleware: ExpressSymbol[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isFunctionDeclaration(node) && node.parameters.length >= 3) {
                const [req, res, next] = node.parameters;
                if (req && res && next && 
                    req.type?.getText().includes('Request') && 
                    res.type?.getText().includes('Response')) {
                    middleware.push({
                        type: 'middleware',
                        name: node.name?.text || 'anonymous',
                        documentation: this.getNodeDocumentation(node),
                        location: this.getNodeLocation(node)
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return middleware;
    }

    private analyzeControllers(sourceFile: ts.SourceFile): ExpressSymbol[] {
        const controllers: ExpressSymbol[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isClassDeclaration(node) && this.isController(node)) {
                controllers.push({
                    type: 'controller',
                    name: node.name?.text || 'anonymous',
                    methods: this.extractControllerMethods(node),
                    documentation: this.getNodeDocumentation(node),
                    location: this.getNodeLocation(node)
                });
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return controllers;
    }

    private isController(node: ts.ClassDeclaration): boolean {
        return node.name?.text.toLowerCase().includes('controller') || 
               node.members.some(member => 
                   ts.isMethodDeclaration(member) && 
                   member.parameters.length >= 2 &&
                   member.parameters[0].type?.getText().includes('Request') &&
                   member.parameters[1].type?.getText().includes('Response')
               );
    }

    private extractControllerMethods(node: ts.ClassDeclaration): string[] {
        return node.members
            .filter(ts.isMethodDeclaration)
            .map(method => method.name.getText());
    }

    private analyzeModels(sourceFile: ts.SourceFile): ExpressSymbol[] {
        const models: ExpressSymbol[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isClassDeclaration(node) && this.isModel(node)) {
                models.push({
                    type: 'model',
                    name: node.name?.text || 'anonymous',
                    documentation: this.getNodeDocumentation(node),
                    location: this.getNodeLocation(node)
                });
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return models;
    }

    private isModel(node: ts.ClassDeclaration): boolean {
        return node.name?.text.toLowerCase().includes('model') ||
               node.decorators?.some(d => 
                   d.expression.getText().includes('model') ||
                   d.expression.getText().includes('entity')
               );
    }

    private analyzeAuth(sourceFile: ts.SourceFile): ExpressSymbol[] {
        const auth: ExpressSymbol[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isFunctionDeclaration(node) && this.isAuthFunction(node)) {
                auth.push({
                    type: 'auth',
                    name: node.name?.text || 'anonymous',
                    documentation: this.getNodeDocumentation(node),
                    location: this.getNodeLocation(node)
                });
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return auth;
    }

    private isAuthFunction(node: ts.FunctionDeclaration): boolean {
        return node.name?.text.toLowerCase().includes('auth') ||
               node.name?.text.toLowerCase().includes('passport') ||
               node.name?.text.toLowerCase().includes('login') ||
               node.name?.text.toLowerCase().includes('logout');
    }

    private analyzeDatabase(sourceFile: ts.SourceFile): ExpressSymbol[] {
        const database: ExpressSymbol[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && this.isDatabaseOperation(node)) {
                database.push({
                    type: 'database',
                    name: node.expression.getText(),
                    documentation: this.getNodeDocumentation(node),
                    location: this.getNodeLocation(node)
                });
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return database;
    }

    private isDatabaseOperation(node: ts.CallExpression): boolean {
        const text = node.expression.getText().toLowerCase();
        return text.includes('find') ||
               text.includes('create') ||
               text.includes('update') ||
               text.includes('delete') ||
               text.includes('query');
    }

    private extractRouteParams(path: string): string[] {
        const params: string[] = [];
        const regex = /:(\w+)/g;
        let match;
        while ((match = regex.exec(path)) !== null) {
            params.push(match[1]);
        }
        return params;
    }

    private extractMiddleware(nodes: ts.Node[]): string[] {
        return nodes
            .filter(ts.isFunctionExpression)
            .map(node => {
                if (ts.isIdentifier(node)) {
                    return node.text;
                }
                return 'anonymous';
            });
    }

    private analyzeDependencies(sourceFile: ts.SourceFile): Map<string, string[]> {
        const dependencies = new Map<string, string[]>();
        const visit = (node: ts.Node) => {
            if (ts.isImportDeclaration(node)) {
                const moduleName = node.moduleSpecifier.getText().replace(/['"]/g, '');
                const imports: string[] = [];
                
                if (node.importClause) {
                    if (node.importClause.name) {
                        imports.push(node.importClause.name.text);
                    }
                    
                    if (node.importClause.namedBindings) {
                        if (ts.isNamedImports(node.importClause.namedBindings)) {
                            imports.push(...node.importClause.namedBindings.elements.map(e => e.name.text));
                        }
                    }
                }
                
                dependencies.set(moduleName, imports);
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return dependencies;
    }

    private calculateMetrics(content: string, symbols: ExpressSymbol[]): CodeMetrics {
        let complexity = 0;
        let linesOfCode = content.split('\n').length;
        let commentLines = 0;

        // Yorum satırlarını say
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.trim().startsWith('//') || line.trim().startsWith('/*')) {
                commentLines++;
            }
        }

        // Karmaşıklığı hesapla
        complexity += symbols.length; // Her sembol için temel karmaşıklık
        complexity += symbols.filter(s => s.type === 'route').length * 2; // Route'lar için ek karmaşıklık
        complexity += symbols.filter(s => s.type === 'middleware').length * 1.5; // Middleware'ler için ek karmaşıklık

        return {
            complexity,
            linesOfCode,
            commentLines,
            dependencies: symbols.filter(s => s.type === 'database').length,
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
        const commentRanges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart());
        
        if (!commentRanges) {
            return '';
        }

        return commentRanges
            .map(range => sourceFile.text.substring(range.pos, range.end))
            .join('\n');
    }

    private createASTNode(sourceFile: ts.SourceFile): SemanticNode {
        return {
            type: 'File',
            name: sourceFile.fileName,
            location: new vscode.Location(
                vscode.Uri.file(sourceFile.fileName),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: ExpressSymbol[]): Map<string, SemanticNode> {
        const result = new Map<string, SemanticNode>();
        
        for (const symbol of symbols) {
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
        }
        
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