import * as vscode from 'vscode';
import * as ts from 'typescript';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

export class TypeScriptAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        // TypeScript kaynak dosyasını oluştur
        const sourceFile = ts.createSourceFile(
            filePath,
            document.getText(),
            ts.ScriptTarget.Latest,
            true
        );

        // AST analizi yap
        const ast = this.analyzeAST(sourceFile);
        
        // Sembol analizi yap
        const symbols = this.analyzeSymbols(sourceFile);
        
        // Bağımlılık analizi yap
        const dependencies = this.analyzeDependencies(sourceFile);
        
        // Kod metriklerini hesapla
        const metrics = this.calculateMetrics(sourceFile);

        const result: AnalysisResult = {
            ast,
            symbols,
            dependencies,
            metrics
        };

        // Sonucu önbelleğe al
        this.analysisCache.set(filePath, result);

        return result;
    }

    private analyzeAST(sourceFile: ts.SourceFile): SemanticNode {
        const root: SemanticNode = {
            type: 'SourceFile',
            name: sourceFile.fileName,
            location: new vscode.Location(
                vscode.Uri.file(sourceFile.fileName),
                new vscode.Range(0, 0, 0, 0)
            )
        };

        const visit = (node: ts.Node, parent: SemanticNode) => {
            if (!parent.children) {
                parent.children = [];
            }

            const childNode: SemanticNode = {
                type: ts.SyntaxKind[node.kind],
                name: this.getNodeName(node),
                location: this.getNodeLocation(node, sourceFile)
            };

            parent.children.push(childNode);
            ts.forEachChild(node, child => visit(child, childNode));
        };

        ts.forEachChild(sourceFile, node => visit(node, root));
        return root;
    }

    private analyzeSymbols(sourceFile: ts.SourceFile): Map<string, SemanticNode> {
        const symbols = new Map<string, SemanticNode>();
        const checker = this.getTypeChecker();

        const visit = (node: ts.Node) => {
            if (ts.isIdentifier(node)) {
                const symbol = checker.getSymbolAtLocation(node);
                if (symbol) {
                    symbols.set(symbol.name, {
                        type: 'Symbol',
                        name: symbol.name,
                        location: this.getNodeLocation(node, sourceFile),
                        references: this.getSymbolReferences(symbol, sourceFile),
                        documentation: ts.displayPartsToString(symbol.getDocumentationComment(checker))
                    });
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return symbols;
    }

    private analyzeDependencies(sourceFile: ts.SourceFile): Map<string, string[]> {
        const dependencies = new Map<string, string[]>();
        
        const visit = (node: ts.Node) => {
            if (ts.isImportDeclaration(node)) {
                const moduleName = node.moduleSpecifier.getText();
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
                    
                    dependencies.set(moduleName.replace(/['"]/g, ''), imports);
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return dependencies;
    }

    private calculateMetrics(sourceFile: ts.SourceFile): CodeMetrics {
        let complexity = 0;
        let linesOfCode = 0;
        let commentLines = 0;

        const visit = (node: ts.Node) => {
            // Döngü ve koşullar için karmaşıklık artır
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

            // Yorum satırlarını say
            ts.getLeadingCommentRanges(sourceFile.text, node.pos)?.forEach(() => {
                commentLines++;
            });

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        // Satır sayısını hesapla
        linesOfCode = sourceFile.getFullText().split('\n').length;

        // Maintainability Index hesapla
        const maintainabilityIndex = this.calculateMaintainabilityIndex(
            complexity,
            linesOfCode,
            commentLines
        );

        return {
            complexity,
            linesOfCode,
            commentLines,
            dependencies: this.analyzeDependencies(sourceFile).size,
            maintainabilityIndex
        };
    }

    private getTypeChecker(): ts.TypeChecker {
        const program = ts.createProgram([vscode.window.activeTextEditor?.document.uri.fsPath || ''], {});
        return program.getTypeChecker();
    }

    private getNodeName(node: ts.Node): string {
        if (ts.isIdentifier(node)) {
            return node.text;
        }
        if (ts.isClassDeclaration(node) && node.name) {
            return node.name.text;
        }
        if (ts.isFunctionDeclaration(node) && node.name) {
            return node.name.text;
        }
        return ts.SyntaxKind[node.kind];
    }

    private getNodeLocation(node: ts.Node, sourceFile: ts.SourceFile): vscode.Location {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        
        return new vscode.Location(
            vscode.Uri.file(sourceFile.fileName),
            new vscode.Range(
                start.line,
                start.character,
                end.line,
                end.character
            )
        );
    }

    private getSymbolReferences(
        symbol: ts.Symbol,
        sourceFile: ts.SourceFile
    ): vscode.Location[] {
        const references: vscode.Location[] = [];
        const program = ts.createProgram([sourceFile.fileName], {});
        const checker = program.getTypeChecker();

        // Sembol referanslarını bul
        symbol.declarations?.forEach(declaration => {
            const referencedSymbols = program.getSourceFile(sourceFile.fileName)
                ?.getChildren()
                .filter(node => {
                    const nodeSymbol = checker.getSymbolAtLocation(node);
                    return nodeSymbol?.name === symbol.name;
                });

            referencedSymbols?.forEach(node => {
                references.push(this.getNodeLocation(node, sourceFile));
            });
        });

        return references;
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