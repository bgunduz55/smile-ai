import * as vscode from 'vscode';
import { ImprovementManager } from '../utils/ImprovementManager';
import { ImprovementNote, ImprovementNoteStatus } from '../agent/types';

/**
 * Provides the data for the Future Improvements tree view.
 */
export class ImprovementTreeProvider implements vscode.TreeDataProvider<ImprovementNote | string> {

    // Event emitter for tree data changes
    private _onDidChangeTreeData: vscode.EventEmitter<ImprovementNote | string | undefined | null | void> = new vscode.EventEmitter<ImprovementNote | string | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ImprovementNote | string | undefined | null | void> = this._onDidChangeTreeData.event;

    private improvementManager: ImprovementManager;

    constructor(improvementManager: ImprovementManager) {
        this.improvementManager = improvementManager;
        // Listen to changes in the manager and refresh the tree
        this.improvementManager.onDidChangeNotes(() => this.refresh());
    }

    /**
     * Refreshes the entire tree view.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Gets the tree item representation (label, icon, collapsible state) for a note.
     */
    getTreeItem(element: ImprovementNote | string): vscode.TreeItem {
        if (typeof element === 'string') {
            // Handle potential grouping nodes later if needed
            return new vscode.TreeItem(element, vscode.TreeItemCollapsibleState.None);
        }

        const item = new vscode.TreeItem(element.description, vscode.TreeItemCollapsibleState.None);
        item.id = element.id;
        item.tooltip = this.createTooltip(element);
        item.description = element.context?.filePath ? vscode.workspace.asRelativePath(element.context.filePath) : 'General';
        // Use a specific icon for pending notes
        item.iconPath = new vscode.ThemeIcon('lightbulb'); // Use built-in icon

        // Add context menu commands (we'll define these later)
        item.contextValue = 'improvementNotePending'; // Used to show specific commands in package.json

        // TODO: Add command to open the context (file/location) if available
        // item.command = { ... };

        return item;
    }

    /**
     * Gets the children of an element or the root elements if no element is provided.
     * We only show pending notes at the root for now.
     */
    getChildren(element?: ImprovementNote | string): vscode.ProviderResult<(ImprovementNote | string)[]> {
        if (element) {
            // Notes don't have children in this simple structure
            return Promise.resolve([]);
        } else {
            // Root level: fetch pending notes
            const pendingNotes = this.improvementManager.getNotesByStatus(ImprovementNoteStatus.PENDING);
            // Sort by creation date, newest first
            pendingNotes.sort((a, b) => b.createdAt - a.createdAt);
            return Promise.resolve(pendingNotes);
        }
    }

    /**
     * Creates a markdown tooltip for the note.
     */
    private createTooltip(note: ImprovementNote): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**${note.description}**\n\n`);
        tooltip.appendMarkdown(`*Status:* ${note.status}\n`);
        tooltip.appendMarkdown(`*Created:* ${new Date(note.createdAt).toLocaleString()}\n`);
        if (note.context?.filePath) {
            tooltip.appendMarkdown(`*File:* ${vscode.workspace.asRelativePath(note.context.filePath)}\n`);
        }
        if (note.context?.symbolName) {
            tooltip.appendMarkdown(`*Symbol:* ${note.context.symbolName}\n`);
        }
        if (note.context?.selection) {
            tooltip.appendMarkdown(`*Lines:* ${note.context.selection.startLine}-${note.context.selection.endLine}\n`);
        }
        return tooltip;
    }
} 