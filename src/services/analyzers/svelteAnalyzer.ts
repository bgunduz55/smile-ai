import * as vscode from 'vscode';
import { parse, preprocess } from 'svelte/compiler';
import { parse as parseScript } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface SvelteSymbol {
    name: string;
    type: 'component' | 'store' | 'action' | 'transition' | 'animation';
    isExported?: boolean;
    props?: string[];
    events?: string[];
    slots?: string[];
    stores?: string[];
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

export class SvelteAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeSvelteContent(content, filePath);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeSvelteContent(content: string, filePath: string): Promise<AnalysisResult> {
        try {
            // Svelte dosyasını parse et
            const preprocessed = await preprocess(content, {
                typescript: true,
                scss: true
            });

            const parsed = parse(preprocessed.code);
            
            // Script analizi
            const scriptSymbols = parsed.instance
                ? this.analyzeScript(parsed.instance.content)
                : [];
            
            // Module script analizi
            const moduleSymbols = parsed.module
                ? this.analyzeModuleScript(parsed.module.content)
                : [];
            
            // Template analizi
            const templateSymbols = this.analyzeTemplate(parsed.html);
            
            // Style analizi
            const styleMetrics = parsed.css
                ? this.analyzeStyles(parsed.css.content)
                : { linesOfCode: 0, commentLines: 0 };

            // Tüm sembolleri birleştir
            const symbols = [...scriptSymbols, ...moduleSymbols, ...templateSymbols];
            
            // Bağımlılıkları analiz et
            const dependencies = this.analyzeDependencies(parsed);
            
            // Kod metriklerini hesapla
            const metrics = this.calculateMetrics(parsed, symbols, styleMetrics);

            return {
                ast: this.createASTNode(parsed),
                symbols: this.createSymbolsMap(symbols),
                dependencies: dependencies,
                metrics: metrics
            };
        } catch (error) {
            console.error('Svelte analiz hatası:', error);
            throw error;
        }
    }

    private analyzeScript(content: string): SvelteSymbol[] {
        const symbols: SvelteSymbol[] = [];
        
        try {
            const ast = parseScript(content, {
                sourceType: 'module',
                plugins: ['typescript', 'decorators-legacy']
            });

            traverse(ast, {
                // Export edilen değişkenler
                ExportNamedDeclaration(path) {
                    if (t.isVariableDeclaration(path.node.declaration)) {
                        path.node.declaration.declarations.forEach(declaration => {
                            if (t.isIdentifier(declaration.id)) {
                                symbols.push({
                                    name: declaration.id.name,
                                    type: 'component',
                                    isExported: true,
                                    location: this.getNodeLocation(declaration),
                                    documentation: this.getNodeDocumentation(declaration)
                                });
                            }
                        });
                    }
                },

                // Store tanımları
                CallExpression(path) {
                    if (this.isStoreDefinition(path.node)) {
                        symbols.push(this.createStoreSymbol(path.node));
                    }
                },

                // Action tanımları
                FunctionDeclaration(path) {
                    if (this.isAction(path.node)) {
                        symbols.push(this.createActionSymbol(path.node));
                    }
                },

                // Transition ve animation tanımları
                ObjectProperty(path) {
                    if (this.isTransition(path.node)) {
                        symbols.push(this.createTransitionSymbol(path.node));
                    } else if (this.isAnimation(path.node)) {
                        symbols.push(this.createAnimationSymbol(path.node));
                    }
                }
            });
        } catch (error) {
            console.error('Script analiz hatası:', error);
        }

        return symbols;
    }

    private analyzeModuleScript(content: string): SvelteSymbol[] {
        const symbols: SvelteSymbol[] = [];
        
        try {
            const ast = parseScript(content, {
                sourceType: 'module',
                plugins: ['typescript', 'decorators-legacy']
            });

            traverse(ast, {
                // Context tanımları
                CallExpression(path) {
                    if (this.isContextDefinition(path.node)) {
                        symbols.push(this.createContextSymbol(path.node));
                    }
                }
            });
        } catch (error) {
            console.error('Module script analiz hatası:', error);
        }

        return symbols;
    }

    private analyzeTemplate(html: any): SvelteSymbol[] {
        const symbols: SvelteSymbol[] = [];
        
        try {
            // Template içindeki component kullanımları
            this.traverseTemplate(html, (node) => {
                if (this.isCustomComponent(node)) {
                    symbols.push(this.createTemplateComponentSymbol(node));
                }
            });
        } catch (error) {
            console.error('Template analiz hatası:', error);
        }

        return symbols;
    }

    private analyzeStyles(content: string): { linesOfCode: number; commentLines: number } {
        let linesOfCode = 0;
        let commentLines = 0;

        const lines = content.split('\n');
        linesOfCode = lines.length;
        
        lines.forEach(line => {
            if (line.trim().startsWith('/*') || line.trim().startsWith('*') || line.trim().startsWith('//')) {
                commentLines++;
            }
        });

        return { linesOfCode, commentLines };
    }

    private isStoreDefinition(node: t.CallExpression): boolean {
        return t.isIdentifier(node.callee) && 
               ['writable', 'readable', 'derived'].includes(node.callee.name);
    }

    private isAction(node: t.FunctionDeclaration): boolean {
        return node.id?.name.endsWith('Action') || false;
    }

    private isTransition(node: t.ObjectProperty): boolean {
        return t.isIdentifier(node.key) && node.key.name.startsWith('transition');
    }

    private isAnimation(node: t.ObjectProperty): boolean {
        return t.isIdentifier(node.key) && node.key.name.startsWith('animate');
    }

    private isContextDefinition(node: t.CallExpression): boolean {
        return t.isIdentifier(node.callee) && 
               ['getContext', 'setContext'].includes(node.callee.name);
    }

    private isCustomComponent(node: any): boolean {
        return node.type === 'InlineComponent' && /^[A-Z]/.test(node.name);
    }

    private createStoreSymbol(node: t.CallExpression): SvelteSymbol {
        const name = this.extractStoreName(node) || 'AnonymousStore';
        return {
            name,
            type: 'store',
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createActionSymbol(node: t.FunctionDeclaration): SvelteSymbol {
        return {
            name: node.id?.name || 'AnonymousAction',
            type: 'action',
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createTransitionSymbol(node: t.ObjectProperty): SvelteSymbol {
        return {
            name: (node.key as t.Identifier).name,
            type: 'transition',
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createAnimationSymbol(node: t.ObjectProperty): SvelteSymbol {
        return {
            name: (node.key as t.Identifier).name,
            type: 'animation',
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createTemplateComponentSymbol(node: any): SvelteSymbol {
        return {
            name: node.name,
            type: 'component',
            props: this.extractTemplateProps(node),
            events: this.extractTemplateEvents(node),
            slots: this.extractTemplateSlots(node),
            location: {
                line: node.start.line,
                column: node.start.column,
                endLine: node.end.line,
                endColumn: node.end.column
            }
        };
    }

    private extractStoreName(node: t.CallExpression): string | undefined {
        const parent = node.parent;
        if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
            return parent.id.name;
        }
        return undefined;
    }

    private extractTemplateProps(node: any): string[] {
        return Object.keys(node.attributes || {})
            .filter(key => !key.startsWith('on:'));
    }

    private extractTemplateEvents(node: any): string[] {
        return Object.keys(node.attributes || {})
            .filter(key => key.startsWith('on:'))
            .map(key => key.slice(3));
    }

    private extractTemplateSlots(node: any): string[] {
        const slots: string[] = [];
        
        if (node.children) {
            node.children.forEach((child: any) => {
                if (child.type === 'Slot') {
                    slots.push(child.name || 'default');
                }
            });
        }

        return slots;
    }

    private analyzeDependencies(parsed: any): Map<string, string[]> {
        const dependencies = new Map<string, string[]>();
        
        // Script ve module script bağımlılıkları
        [parsed.instance, parsed.module].forEach(script => {
            if (script) {
                const ast = parseScript(script.content, {
                    sourceType: 'module',
                    plugins: ['typescript', 'decorators-legacy']
                });

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
            }
        });

        return dependencies;
    }

    private calculateMetrics(
        parsed: any,
        symbols: SvelteSymbol[],
        styleMetrics: { linesOfCode: number; commentLines: number }
    ): CodeMetrics {
        let complexity = 0;
        let linesOfCode = 0;
        let commentLines = 0;

        // Script metrikleri
        [parsed.instance, parsed.module].forEach(script => {
            if (script) {
                const lines = script.content.split('\n');
                linesOfCode += lines.length;

                lines.forEach(line => {
                    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
                        commentLines++;
                    }
                });

                // Karmaşıklık hesapla
                complexity += symbols.length; // Her Svelte yapısı için +1

                const ast = parseScript(script.content, {
                    sourceType: 'module',
                    plugins: ['typescript', 'decorators-legacy']
                });

                traverse(ast, {
                    IfStatement() { complexity++; },
                    SwitchStatement() { complexity++; },
                    ForStatement() { complexity++; },
                    WhileStatement() { complexity++; },
                    DoWhileStatement() { complexity++; },
                    ConditionalExpression() { complexity++; },
                    LogicalExpression() { complexity++; }
                });
            }
        });

        // Template metrikleri
        if (parsed.html) {
            this.traverseTemplate(parsed.html, (node) => {
                if (node.type === 'IfBlock') complexity++;
                if (node.type === 'EachBlock') complexity++;
                if (node.type === 'AwaitBlock') complexity++;
            });
        }

        // Style metrikleri
        linesOfCode += styleMetrics.linesOfCode;
        commentLines += styleMetrics.commentLines;

        return {
            complexity,
            linesOfCode,
            commentLines,
            dependencies: Array.from(this.analyzeDependencies(parsed).keys()).length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                complexity,
                linesOfCode,
                commentLines
            )
        };
    }

    private traverseTemplate(node: any, callback: (node: any) => void) {
        callback(node);
        if (node.children) {
            node.children.forEach((child: any) => this.traverseTemplate(child, callback));
        }
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

    private createASTNode(parsed: any): SemanticNode {
        return {
            type: 'SvelteComponent',
            name: parsed.name || '',
            location: new vscode.Location(
                vscode.Uri.file(''),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: SvelteSymbol[]): Map<string, SemanticNode> {
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