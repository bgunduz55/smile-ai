import * as vscode from 'vscode';

export interface CompletionContext {
    document: vscode.TextDocument;
    position: vscode.Position;
    token: vscode.CancellationToken;
    context: vscode.CompletionContext;
} 