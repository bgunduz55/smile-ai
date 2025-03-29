import * as vscode from 'vscode';
import * as ts from 'typescript'; // Import TypeScript Compiler API

/**
 * Represents information about a symbol found in the codebase.
 */
export interface SymbolInfo {
    name: string;
    kind: ts.SyntaxKind;
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    // Future additions: parameters, return type, references, etc.
}

/**
 * Represents the indexed information for a single file.
 */
export interface FileIndexData {
    filePath: string;
    symbols: SymbolInfo[];
    imports: string[]; // Keep track of imports
    // Future additions: exports, relationships, parse errors
}

/**
 * Manages the indexing of the codebase to understand its structure,
 * symbols, and relationships.
 */
export class CodebaseIndex {
    private static instance: CodebaseIndex;

    // Use the defined interface for better type safety
    private indexData: Map<string, FileIndexData>;
    private isIndexing: boolean = false;

    private constructor() {
        this.indexData = new Map();
        // TODO: Listen for workspace changes (file saves, deletes) to update the index
    }

    /**
     * Gets the singleton instance of the CodebaseIndex.
     */
    public static getInstance(): CodebaseIndex {
        if (!CodebaseIndex.instance) {
            CodebaseIndex.instance = new CodebaseIndex();
        }
        return CodebaseIndex.instance;
    }

    /**
     * Initiates the indexing process for the entire workspace.
     * @param progress Optional progress reporter.
     */
    public async buildIndex(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        if (this.isIndexing) {
            vscode.window.showWarningMessage('Indexing is already in progress.');
            return;
        }
        this.isIndexing = true;
        this.indexData.clear(); // Clear previous index
        progress?.report({ message: 'Starting codebase indexing...' });
        console.log('Starting codebase indexing...');

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }
            const rootPath = workspaceFolders[0].uri; // Assuming single root for now

            // 1. Find all relevant code files (e.g., .ts, .tsx)
            //    - Use vscode.workspace.findFiles
            const files = await vscode.workspace.findFiles('**/*.{ts,tsx}', '**/node_modules/**');
            
            progress?.report({ message: `Found ${files.length} files to index...`, increment: 10 });
            console.log(`Found ${files.length} files to index.`);

            // 2. For each file, parse it to extract symbols (functions, classes, etc.)
            //    - This is where we'll use the TypeScript Compiler API
            for (let i = 0; i < files.length; i++) {
                const fileUri = files[i];
                const fileName = vscode.workspace.asRelativePath(fileUri);
                progress?.report({ 
                    message: `Indexing ${fileName}...`, 
                    increment: (80 / files.length) // Allocate 80% of progress to parsing
                });
                console.log(`Indexing ${fileName}...`);
                await this.parseFile(fileUri);
                // Add a small delay to prevent UI freeze for large projects
                await new Promise(resolve => setTimeout(resolve, 10)); 
            }

            // 3. (Future) Build relationships between symbols (call graphs, inheritance)

            progress?.report({ message: 'Finalizing index...', increment: 10 });
            console.log('Codebase indexing finished.');
            vscode.window.showInformationMessage('Codebase indexing finished.');

        } catch (error) {
            console.error('Error during codebase indexing:', error);
            vscode.window.showErrorMessage(`Codebase indexing failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Parses a single file and updates the index using TypeScript Compiler API.
     * @param fileUri The URI of the file to parse.
     */
    private async parseFile(fileUri: vscode.Uri): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const code = document.getText();
            const filePath = vscode.workspace.asRelativePath(fileUri);

            // Use TypeScript Compiler API to parse the file
            const sourceFile = ts.createSourceFile(
                filePath,         // fileName
                code,             // sourceText
                ts.ScriptTarget.Latest, // languageVersion
                true              // setParentNodes
            );

            const fileSymbols: SymbolInfo[] = [];
            const fileImports: string[] = [];

            // Visitor function to traverse the AST (Abstract Syntax Tree)
            const visitNode = (node: ts.Node) => {
                let symbolInfo: Partial<SymbolInfo> | null = null;
                let symbolName: string | undefined;

                if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
                    symbolName = node.name?.getText(sourceFile);
                    if (symbolName) {
                        symbolInfo = { kind: node.kind }; // Store kind
                    }
                } else if (ts.isClassDeclaration(node)) {
                    symbolName = node.name?.getText(sourceFile);
                    if (symbolName) {
                        symbolInfo = { kind: node.kind }; // Store kind
                    }
                } else if (ts.isInterfaceDeclaration(node)) {
                    symbolName = node.name.getText(sourceFile);
                    symbolInfo = { kind: node.kind }; // Store kind
                } else if (ts.isEnumDeclaration(node)) {
                    symbolName = node.name.getText(sourceFile);
                    symbolInfo = { kind: node.kind }; // Store kind
                } else if (ts.isTypeAliasDeclaration(node)) {
                    symbolName = node.name.getText(sourceFile);
                    symbolInfo = { kind: node.kind }; // Store kind
                } else if (ts.isVariableDeclaration(node)) {
                    // Handle variable names (can be simple identifier or binding pattern)
                    if (ts.isIdentifier(node.name)) {
                        symbolName = node.name.getText(sourceFile);
                        symbolInfo = { kind: node.kind }; // Store kind
                    } // Skip complex patterns for now
                } else if (ts.isImportDeclaration(node)) {
                    // Extract module specifier (the path being imported)
                    if (ts.isStringLiteral(node.moduleSpecifier)) {
                        fileImports.push(node.moduleSpecifier.text);
                    }
                }

                // If a symbol name and kind were identified, get its position and add to the list
                if (symbolInfo && symbolName) {
                    try {
                        const startPos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
                        // For variables, the declaration node (e.g., `x` in `const x = 1`) might be better than the whole statement
                        const endNode = ts.isVariableDeclaration(node) ? node.name : node;
                        const endPos = sourceFile.getLineAndCharacterOfPosition(endNode.getEnd());
                        fileSymbols.push({
                            name: symbolName,
                            kind: symbolInfo.kind!,
                            filePath: filePath,
                            startLine: startPos.line + 1, // 1-based indexing
                            startChar: startPos.character,
                            endLine: endPos.line + 1, // 1-based indexing
                            endChar: endPos.character,
                        });
                    } catch (posError) {
                        console.error(`Error getting position for symbol ${symbolName} in ${filePath}:`, posError);
                    }
                }

                // Continue traversing child nodes
                ts.forEachChild(node, visitNode);
            };

            // Start traversal from the root node
            visitNode(sourceFile);

            // Store the extracted information in the index
            this.indexData.set(filePath, {
                filePath: filePath,
                symbols: fileSymbols,
                imports: fileImports
            });

        } catch (error) {
            console.error(`Error parsing file ${fileUri.fsPath}:`, error);
            // Store error information for this file
            const filePath = vscode.workspace.asRelativePath(fileUri);
            this.indexData.set(filePath, {
                filePath: filePath,
                symbols: [],
                imports: [],
                // TODO: Add an 'error' field here
            });
        }
    }

    /**
     * Queries the index to find symbols by name.
     * (Basic implementation - can be expanded significantly)
     *
     * @param symbolName The name of the symbol to find.
     * @returns An array of SymbolInfo objects matching the name.
     */
    public findSymbolByName(symbolName: string): SymbolInfo[] {
        console.log(`Querying index for symbol: ${symbolName}`);
        const results: SymbolInfo[] = [];
        for (const fileData of this.indexData.values()) {
            if (fileData.symbols) {
                for (const symbol of fileData.symbols) {
                   if (symbol.name === symbolName) {
                       results.push(symbol);
                   }
                }
            }
        }
        return results;
    }

    /**
     * Finds the symbol definition at a specific position in a file.
     *
     * @param filePath Relative path to the file.
     * @param position The position within the file.
     * @returns The SymbolInfo for the symbol at the position, or undefined if not found.
     */
    public findSymbolAtPosition(filePath: string, position: vscode.Position): SymbolInfo | undefined {
        const fileData = this.getFileData(filePath);
        if (!fileData?.symbols) {
            return undefined;
        }

        // VS Code Position is 0-based, SymbolInfo lines are 1-based
        const targetLine = position.line + 1;
        const targetChar = position.character;

        // Find the smallest symbol that contains the position
        let bestMatch: SymbolInfo | undefined = undefined;

        for (const symbol of fileData.symbols) {
            if (
                symbol.startLine <= targetLine &&
                symbol.endLine >= targetLine &&
                // Check character boundaries only if the symbol is on a single line or the target is on the start/end line
                (symbol.startLine !== targetLine || symbol.startChar <= targetChar) &&
                (symbol.endLine !== targetLine || symbol.endChar >= targetChar)
            ) {
                // If we found a match, check if it's smaller (more specific) than the previous best match
                if (!bestMatch || 
                    (symbol.startLine > bestMatch.startLine || (symbol.startLine === bestMatch.startLine && symbol.startChar >= bestMatch.startChar)) &&
                    (symbol.endLine < bestMatch.endLine || (symbol.endLine === bestMatch.endLine && symbol.endChar <= bestMatch.endChar))
                ) {
                    bestMatch = symbol;
                }
            }
        }

        return bestMatch;
    }

    /**
     * Gets the indexed data for a specific file.
     * @param filePath Relative path to the file.
     * @returns The indexed data or undefined if not found.
     */
    public getFileData(filePath: string): any | undefined {
        return this.indexData.get(filePath);
    }

    /**
     * Updates the index for a single file, typically after a save.
     * @param fileUri The URI of the file to update.
     */
    public async updateFileIndex(fileUri: vscode.Uri): Promise<void> {
         if (this.isIndexing) {
             console.warn('Skipping single file update, full indexing in progress.');
             return;
         }
         const filePath = vscode.workspace.asRelativePath(fileUri);
         console.log(`Updating index for ${filePath}...`);
         await this.parseFile(fileUri); // Re-parse the file
         console.log(`Index updated for ${filePath}.`);
    }

    /**
     * Removes a file from the index.
     * @param fileUri The URI of the file to remove.
     */
    public removeFileIndex(fileUri: vscode.Uri): void {
        const filePath = vscode.workspace.asRelativePath(fileUri);
        if (this.indexData.delete(filePath)) {
            console.log(`Removed ${filePath} from index.`);
        }
    }

    /**
     * Cleans up resources, if any (e.g., file watchers).
     */
    public dispose(): void {
        // Placeholder for potential cleanup logic
        console.log('Disposing CodebaseIndex...');
        this.indexData.clear();
    }
} 