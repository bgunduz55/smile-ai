import * as vscode from 'vscode';
import { parse, SFCParseResult } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';
import { parse as parseScript } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface VueSymbol {
    name: string;
    type: 'component' | 'composable' | 'directive' | 'mixin' | 'store' | 'route';
    isDefault?: boolean;
    props?: string[];
    emits?: string[];
    expose?: string[];
    slots?: string[];
    hooks?: string[];
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

export class VueAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeVueContent(content, filePath);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeVueContent(content: string, filePath: string): Promise<AnalysisResult> {
        try {
            // SFC parse
            const { descriptor } = parse(content);
            
            // Script analizi
            const scriptContent = descriptor.script?.content || descriptor.scriptSetup?.content || '';
            const scriptSymbols = scriptContent ? await this.analyzeScript(scriptContent) : [];
            
            // Template analizi
            const templateContent = descriptor.template?.content || '';
            const templateSymbols = templateContent ? await this.analyzeTemplate(templateContent) : [];
            
            // Style analizi
            const styleMetrics = descriptor.styles && descriptor.styles.length > 0
                ? this.analyzeStyles(descriptor.styles)
                : { linesOfCode: 0, commentLines: 0 };

            // Tüm sembolleri birleştir
            const symbols = [...scriptSymbols, ...templateSymbols];
            
            // Bağımlılıkları analiz et
            const dependencies = await this.analyzeDependencies(descriptor);
            
            // Kod metriklerini hesapla
            const metrics = await this.calculateMetrics(descriptor, symbols, styleMetrics);

            return {
                ast: await this.createASTNode(descriptor),
                symbols: this.createSymbolsMap(symbols),
                dependencies: dependencies,
                metrics: metrics
            };
        } catch (error) {
            console.error('Vue analiz hatası:', error);
            throw error;
        }
    }

    private analyzeScript(content: string): VueSymbol[] {
        const symbols: VueSymbol[] = [];
        
        try {
            const ast = parseScript(content, {
                sourceType: 'module',
                plugins: ['typescript', 'decorators-legacy']
            });

            traverse(ast, {
                // Component tanımları
                ExportDefaultDeclaration(path) {
                    if (this.isVueComponent(path.node)) {
                        symbols.push(this.createComponentSymbol(path.node));
                    }
                },

                // Composable fonksiyonlar
                FunctionDeclaration(path) {
                    if (this.isComposable(path.node)) {
                        symbols.push(this.createComposableSymbol(path.node));
                    }
                },

                // Custom directive tanımları
                ObjectProperty(path) {
                    if (this.isDirective(path.node)) {
                        symbols.push(this.createDirectiveSymbol(path.node));
                    }
                },

                // Store modülleri
                CallExpression(path) {
                    if (this.isStoreModule(path.node)) {
                        symbols.push(this.createStoreSymbol(path.node));
                    }
                }
            });
        } catch (error) {
            console.error('Script analiz hatası:', error);
        }

        return symbols;
    }

    private analyzeTemplate(content: string): VueSymbol[] {
        const symbols: VueSymbol[] = [];
        
        try {
            const ast = parseTemplate(content);
            
            // Template içindeki component kullanımları
            this.traverseTemplate(ast, (node) => {
                if (this.isCustomComponent(node)) {
                    symbols.push(this.createTemplateComponentSymbol(node));
                }
            });
        } catch (error) {
            console.error('Template analiz hatası:', error);
        }

        return symbols;
    }

    private analyzeStyles(styles: SFCParseResult['descriptor']['styles']): { linesOfCode: number; commentLines: number } {
        let linesOfCode = 0;
        let commentLines = 0;

        if (Array.isArray(styles)) {
            styles.forEach(style => {
                if (style && typeof style.content === 'string') {
                    const lines = style.content.split('\n');
                    linesOfCode += lines.length;
                    
                    lines.forEach(line => {
                        if (line.trim().startsWith('/*') || line.trim().startsWith('*') || line.trim().startsWith('//')) {
                            commentLines++;
                        }
                    });
                }
            });
        }

        return { linesOfCode, commentLines };
    }

    private isVueComponent(node: t.Node): boolean {
        if (!t.isObjectExpression(node)) return false;

        const properties = node.properties;
        return properties.some(prop => 
            t.isObjectProperty(prop) && 
            t.isIdentifier(prop.key) && 
            ['name', 'components', 'props', 'setup'].includes(prop.key.name)
        );
    }

    private isComposable(node: t.FunctionDeclaration): boolean {
        return node.id?.name.startsWith('use') || false;
    }

    private isDirective(node: t.ObjectProperty): boolean {
        return t.isIdentifier(node.key) && node.key.name.startsWith('v-');
    }

    private isStoreModule(node: t.CallExpression): boolean {
        return t.isIdentifier(node.callee) && 
               ['defineStore', 'createStore'].includes(node.callee.name);
    }

    private isCustomComponent(node: any): boolean {
        return node.tag && /^[A-Z]/.test(node.tag);
    }

    private createComponentSymbol(node: t.Node): VueSymbol {
        const name = this.extractComponentName(node) || 'AnonymousComponent';
        const props = this.extractProps(node);
        const emits = this.extractEmits(node);
        const expose = this.extractExpose(node);
        const location = this.getNodeLocation(node);
        const documentation = this.getNodeDocumentation(node);

        return {
            name,
            type: 'component',
            props,
            emits,
            expose,
            location,
            documentation
        };
    }

    private createComposableSymbol(node: t.FunctionDeclaration): VueSymbol {
        return {
            name: node.id?.name || 'AnonymousComposable',
            type: 'composable',
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createDirectiveSymbol(node: t.ObjectProperty): VueSymbol {
        return {
            name: (node.key as t.Identifier).name,
            type: 'directive',
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createStoreSymbol(node: t.CallExpression): VueSymbol {
        const name = this.extractStoreName(node) || 'AnonymousStore';
        return {
            name,
            type: 'store',
            location: this.getNodeLocation(node),
            documentation: this.getNodeDocumentation(node)
        };
    }

    private createTemplateComponentSymbol(node: any): VueSymbol {
        return {
            name: node.tag,
            type: 'component',
            props: this.extractTemplateProps(node),
            slots: this.extractTemplateSlots(node),
            location: {
                line: node.loc.start.line,
                column: node.loc.start.column,
                endLine: node.loc.end.line,
                endColumn: node.loc.end.column
            }
        };
    }

    private extractComponentName(node: t.Node): string | undefined {
        if (!t.isObjectExpression(node)) return undefined;

        const nameProp = node.properties.find(prop => 
            t.isObjectProperty(prop) && 
            t.isIdentifier(prop.key) && 
            prop.key.name === 'name'
        ) as t.ObjectProperty;

        return t.isStringLiteral(nameProp?.value) ? nameProp.value.value : undefined;
    }

    private extractProps(node: t.Node): string[] {
        const props: string[] = [];

        if (t.isObjectExpression(node)) {
            const propsNode = node.properties.find(prop => 
                t.isObjectProperty(prop) && 
                t.isIdentifier(prop.key) && 
                prop.key.name === 'props'
            ) as t.ObjectProperty;

            if (t.isObjectExpression(propsNode?.value)) {
                propsNode.value.properties.forEach(prop => {
                    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                        props.push(prop.key.name);
                    }
                });
            }
        }

        return props;
    }

    private extractEmits(node: t.Node): string[] {
        const emits: string[] = [];

        if (t.isObjectExpression(node)) {
            const emitsNode = node.properties.find(prop => 
                t.isObjectProperty(prop) && 
                t.isIdentifier(prop.key) && 
                prop.key.name === 'emits'
            ) as t.ObjectProperty;

            if (t.isArrayExpression(emitsNode?.value)) {
                emitsNode.value.elements.forEach(element => {
                    if (t.isStringLiteral(element)) {
                        emits.push(element.value);
                    }
                });
            }
        }

        return emits;
    }

    private extractExpose(node: t.Node): string[] {
        const expose: string[] = [];

        if (t.isObjectExpression(node)) {
            const exposeNode = node.properties.find(prop => 
                t.isObjectProperty(prop) && 
                t.isIdentifier(prop.key) && 
                prop.key.name === 'expose'
            ) as t.ObjectProperty;

            if (t.isArrayExpression(exposeNode?.value)) {
                exposeNode.value.elements.forEach(element => {
                    if (t.isStringLiteral(element)) {
                        expose.push(element.value);
                    }
                });
            }
        }

        return expose;
    }

    private extractTemplateProps(node: any): string[] {
        return Object.keys(node.props || {});
    }

    private extractTemplateSlots(node: any): string[] {
        const slots: string[] = [];
        
        if (node.children) {
            node.children.forEach((child: any) => {
                if (child.type === 'slot') {
                    slots.push(child.name || 'default');
                }
            });
        }

        return slots;
    }

    private extractStoreName(node: t.CallExpression): string | undefined {
        const firstArg = node.arguments[0];
        return t.isStringLiteral(firstArg) ? firstArg.value : undefined;
    }

    private analyzeDependencies(descriptor: SFCParseResult['descriptor']): Map<string, string[]> {
        const dependencies = new Map<string, string[]>();
        
        try {
            // Script bağımlılıkları
            if (descriptor.script?.content || descriptor.scriptSetup?.content) {
                const scriptContent = descriptor.script?.content || descriptor.scriptSetup?.content || '';
                const ast = parseScript(scriptContent, {
                    sourceType: 'module',
                    plugins: ['typescript', 'decorators-legacy']
                });

                traverse(ast, {
                    ImportDeclaration(path) {
                        const source = path.node.source.value;
                        const importedNames: string[] = [];

                        path.node.specifiers.forEach(specifier => {
                            if (t.isImportSpecifier(specifier)) {
                                const imported = specifier.imported;
                                if (t.isIdentifier(imported)) {
                                    importedNames.push(imported.name);
                                } else if (t.isStringLiteral(imported)) {
                                    importedNames.push(imported.value);
                                }
                            } else if (t.isImportDefaultSpecifier(specifier) && specifier.local) {
                                importedNames.push(specifier.local.name);
                            }
                        });

                        dependencies.set(source, importedNames);
                    }
                });
            }
        } catch (error) {
            console.error('Bağımlılık analiz hatası:', error);
        }

        return dependencies;
    }

    private calculateMetrics(
        descriptor: SFCParseResult['descriptor'],
        symbols: VueSymbol[],
        styleMetrics: { linesOfCode: number; commentLines: number }
    ): CodeMetrics {
        let complexity = 0;
        let linesOfCode = 0;
        let commentLines = 0;

        // Script metrikleri
        if (descriptor.script || descriptor.scriptSetup) {
            const content = descriptor.script?.content || descriptor.scriptSetup?.content || '';
            const lines = content.split('\n');
            linesOfCode += lines.length;

            lines.forEach(line => {
                if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
                    commentLines++;
                }
            });

            // Karmaşıklık hesapla
            complexity += symbols.length; // Her Vue yapısı için +1

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
                ConditionalExpression() { complexity++; },
                LogicalExpression() { complexity++; }
            });
        }

        // Template metrikleri
        if (descriptor.template) {
            const lines = descriptor.template.content.split('\n');
            linesOfCode += lines.length;

            lines.forEach(line => {
                if (line.trim().startsWith('<!--')) {
                    commentLines++;
                }
            });

            const ast = parseTemplate(descriptor.template.content);
            this.traverseTemplate(ast, (node) => {
                if (node.type === 2) complexity++; // v-if/v-else
                if (node.type === 11) complexity++; // v-for
            });
        }

        // Style metrikleri
        linesOfCode += styleMetrics.linesOfCode;
        commentLines += styleMetrics.commentLines;

        return {
            complexity,
            linesOfCode,
            commentLines,
            dependencies: Array.from(this.analyzeDependencies(descriptor).keys()).length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                complexity,
                linesOfCode,
                commentLines
            )
        };
    }

    private traverseTemplate(ast: any, callback: (node: any) => void) {
        const traverse = (node: any) => {
            callback(node);
            if (node.children) {
                node.children.forEach((child: any) => traverse(child));
            }
        };
        traverse(ast);
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

    private createASTNode(descriptor: SFCParseResult['descriptor']): SemanticNode {
        return {
            type: 'VueComponent',
            name: descriptor.filename || '',
            location: new vscode.Location(
                vscode.Uri.file(''),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: VueSymbol[]): Map<string, SemanticNode> {
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