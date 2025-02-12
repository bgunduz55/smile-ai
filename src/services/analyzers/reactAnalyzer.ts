import * as vscode from 'vscode';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface ReactSymbol {
    name: string;
    type: 'component' | 'hook' | 'context' | 'hoc' | 'prop-types';
    isDefault?: boolean;
    props?: string[];
    hooks?: string[];
    children?: string[];
    imports?: string[];
    exports?: string[];
    documentation?: string;
    location: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
    };
}

export class ReactAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeReactContent(content, filePath);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeReactContent(content: string, filePath: string): Promise<AnalysisResult> {
        try {
            // AST oluştur
            const ast = parser.parse(content, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript', 'decorators-legacy']
            });

            // React sembolleri topla
            const symbols = this.collectReactSymbols(ast);
            
            // Bağımlılıkları analiz et
            const dependencies = this.analyzeDependencies(ast, symbols);
            
            // Kod metriklerini hesapla
            const metrics = this.calculateMetrics(ast, content, symbols);

            return {
                ast: this.createASTNode(ast),
                symbols: this.createSymbolsMap(symbols),
                dependencies: dependencies,
                metrics: metrics
            };
        } catch (error) {
            console.error('React analiz hatası:', error);
            throw error;
        }
    }

    private collectReactSymbols(ast: parser.ParseResult<t.File>): ReactSymbol[] {
        const symbols: ReactSymbol[] = [];
        const self = this;

        traverse(ast, {
            // Function component analizi
            FunctionDeclaration(path) {
                if (self.isReactComponent(path.node)) {
                    symbols.push(self.createComponentSymbol(path.node));
                }
            },

            // Arrow function component analizi
            VariableDeclarator(path) {
                if (t.isArrowFunctionExpression(path.node.init) && self.isReactComponent(path.node.init)) {
                    symbols.push(self.createComponentSymbol(path.node));
                }
            },

            // Class component analizi
            ClassDeclaration(path) {
                if (self.isReactClassComponent(path.node)) {
                    symbols.push(self.createClassComponentSymbol(path.node));
                }
            },

            // Hook ve HOC analizi
            CallExpression(path) {
                if (self.isReactHook(path.node)) {
                    symbols.push(self.createHookSymbol(path.node));
                } else if (self.isHigherOrderComponent(path.node)) {
                    symbols.push(self.createHOCSymbol(path.node));
                }
            },

            // Context analizi
            MemberExpression(path) {
                if (self.isReactContext(path.node)) {
                    symbols.push(self.createContextSymbol(path.node));
                }
            }
        });

        return symbols;
    }

    private isReactComponent(node: t.Node): boolean {
        // İsim kontrolü (PascalCase)
        const name = t.isFunctionDeclaration(node) ? node.id?.name : 
                    t.isVariableDeclarator(node) ? (node.id as t.Identifier).name : '';
        if (!name || !/^[A-Z]/.test(name)) {
            return false;
        }

        // JSX return kontrolü
        let hasJSXReturn = false;
        traverse(node, {
            ReturnStatement(path) {
                if (t.isJSXElement(path.node.argument) || t.isJSXFragment(path.node.argument)) {
                    hasJSXReturn = true;
                    path.stop();
                }
            }
        });

        return hasJSXReturn;
    }

    private isReactClassComponent(node: t.ClassDeclaration): boolean {
        // React.Component veya Component extend kontrolü
        return node.superClass !== null && 
               (t.isIdentifier(node.superClass, { name: 'Component' }) ||
                (t.isMemberExpression(node.superClass) && 
                 t.isIdentifier(node.superClass.object, { name: 'React' }) &&
                 t.isIdentifier(node.superClass.property, { name: 'Component' })));
    }

    private isReactHook(node: t.CallExpression): boolean {
        // useState, useEffect vb. hook kontrolü
        return t.isIdentifier(node.callee) && 
               node.callee.name.startsWith('use') && 
               /^use[A-Z]/.test(node.callee.name);
    }

    private isReactContext(node: t.MemberExpression): boolean {
        // React.createContext kontrolü
        return t.isIdentifier(node.object, { name: 'React' }) &&
               t.isIdentifier(node.property, { name: 'createContext' });
    }

    private isHigherOrderComponent(node: t.CallExpression): boolean {
        // withRouter, connect vb. HOC kontrolü
        return t.isIdentifier(node.callee) && 
               /^with[A-Z]/.test(node.callee.name);
    }

    private createComponentSymbol(node: t.Node): ReactSymbol {
        const name = t.isFunctionDeclaration(node) ? node.id?.name || 'AnonymousComponent' :
                    t.isVariableDeclarator(node) ? (node.id as t.Identifier).name || 'AnonymousComponent' : 'AnonymousComponent';

        const props = this.extractProps(node);
        const hooks = this.extractHooks(node);
        const location = this.getNodeLocation(node);
        const documentation = this.getNodeDocumentation(node);

        return {
            name,
            type: 'component',
            props,
            hooks,
            location,
            documentation
        };
    }

    private createClassComponentSymbol(node: t.ClassDeclaration): ReactSymbol {
        const name = node.id?.name || 'AnonymousComponent';
        const props = this.extractClassProps(node);
        const location = this.getNodeLocation(node);
        const documentation = this.getNodeDocumentation(node);

        return {
            name,
            type: 'component',
            props,
            location,
            documentation
        };
    }

    private createHookSymbol(node: t.CallExpression): ReactSymbol {
        const name = (node.callee as t.Identifier).name;
        const location = this.getNodeLocation(node);
        const documentation = this.getNodeDocumentation(node);

        return {
            name,
            type: 'hook',
            location,
            documentation
        };
    }

    private createContextSymbol(node: t.MemberExpression): ReactSymbol {
        const name = (node.property as t.Identifier).name;
        const location = this.getNodeLocation(node);
        const documentation = this.getNodeDocumentation(node);

        return {
            name,
            type: 'context',
            location,
            documentation
        };
    }

    private createHOCSymbol(node: t.CallExpression): ReactSymbol {
        const name = (node.callee as t.Identifier).name;
        const location = this.getNodeLocation(node);
        const documentation = this.getNodeDocumentation(node);

        return {
            name,
            type: 'hoc',
            location,
            documentation
        };
    }

    private extractProps(node: t.Node): string[] {
        const props: string[] = [];

        if (t.isFunctionDeclaration(node) || t.isArrowFunctionExpression(node)) {
            const param = node.params[0];
            if (t.isIdentifier(param)) {
                props.push(param.name);
            } else if (t.isObjectPattern(param)) {
                param.properties.forEach(prop => {
                    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                        props.push(prop.key.name);
                    }
                });
            }
        }

        return props;
    }

    private extractClassProps(node: t.ClassDeclaration): string[] {
        const props: string[] = [];

        traverse(node, {
            ClassProperty(path) {
                if (t.isIdentifier(path.node.key)) {
                    props.push(path.node.key.name);
                }
            }
        });

        return props;
    }

    private extractHooks(node: t.Node): string[] {
        const hooks: string[] = [];

        traverse(node, {
            CallExpression(path) {
                if (t.isIdentifier(path.node.callee) && 
                    path.node.callee.name.startsWith('use') && 
                    /^use[A-Z]/.test(path.node.callee.name)) {
                    hooks.push(path.node.callee.name);
                }
            }
        });

        return hooks;
    }

    private analyzeDependencies(ast: parser.ParseResult<t.File>, symbols: ReactSymbol[]): Map<string, string[]> {
        const dependencies = new Map<string, string[]>();

        traverse(ast, {
            ImportDeclaration(path) {
                const source = path.node.source.value;
                const imports: string[] = [];

                path.node.specifiers.forEach(specifier => {
                    if (t.isImportSpecifier(specifier)) {
                        const importedName = t.isIdentifier(specifier.imported) ? 
                            specifier.imported.name : specifier.imported.value;
                        imports.push(importedName);
                    } else if (t.isImportDefaultSpecifier(specifier)) {
                        imports.push(specifier.local.name);
                    }
                });

                if (imports.length > 0) {
                    dependencies.set(source, imports);
                }
            }
        });

        return dependencies;
    }

    private calculateMetrics(
        ast: parser.ParseResult<t.File>,
        content: string,
        symbols: ReactSymbol[]
    ): CodeMetrics {
        let complexity = 0;
        let linesOfCode = content.split('\n').length;
        let commentLines = 0;

        // Yorum satırlarını say
        content.split('\n').forEach(line => {
            if (line.trim().startsWith('//') || line.trim().startsWith('/*')) {
                commentLines++;
            }
        });

        // Karmaşıklığı hesapla
        traverse(ast, {
            ConditionalExpression() { complexity++; },
            IfStatement() { complexity++; },
            SwitchStatement() { complexity++; },
            LogicalExpression() { complexity++; },
            ForStatement() { complexity++; },
            WhileStatement() { complexity++; },
            DoWhileStatement() { complexity++; },
            TryStatement() { complexity++; }
        });

        // Maintainability Index hesapla
        const maintainabilityIndex = this.calculateMaintainabilityIndex(
            complexity,
            linesOfCode,
            commentLines
        );

        // Bağımlılıkları say
        const dependencies = Array.from(this.analyzeDependencies(ast, symbols).keys()).length;

        return {
            complexity,
            linesOfCode,
            commentLines,
            dependencies,
            maintainabilityIndex
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

    private createASTNode(ast: parser.ParseResult<t.File>): SemanticNode {
        return {
            type: 'Program',
            name: 'Program',
            location: new vscode.Location(
                vscode.Uri.file(''),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: ReactSymbol[]): Map<string, SemanticNode> {
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