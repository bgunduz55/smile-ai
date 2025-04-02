import * as vscode from 'vscode';
import { ImprovementManager, ImprovementNote, ImprovementNoteStatus } from '../improvements/ImprovementManager';

interface ImprovementGroup {
    label: string;
    notes: ImprovementNote[];
    priority?: 'high' | 'medium' | 'low' | 'none';
    status?: ImprovementNoteStatus;
}

/**
 * Provides the data for the Future Improvements tree view.
 */
export class ImprovementTreeProvider implements vscode.TreeDataProvider<ImprovementNote | ImprovementGroup> {

    // Event emitter for tree data changes
    private _onDidChangeTreeData: vscode.EventEmitter<ImprovementNote | ImprovementGroup | undefined | null | void> = new vscode.EventEmitter<ImprovementNote | ImprovementGroup | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ImprovementNote | ImprovementGroup | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private improvementManager: ImprovementManager) {
        // Listen for changes in the improvement manager
        this.improvementManager.onDidChangeNotes(() => {
            this.refresh();
        });
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
    getTreeItem(element: ImprovementNote | ImprovementGroup): vscode.TreeItem {
        if (this.isImprovementGroup(element)) {
            const group = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
            group.contextValue = 'improvementGroup';
            
            if (element.priority) {
                group.iconPath = this.getPriorityIcon(element.priority);
            } else if (element.status) {
                group.iconPath = this.getStatusIcon(element.status);
            }
            
            return group;
        }

        const note = element;
        const treeItem = new vscode.TreeItem(note.content);
        treeItem.description = `Priority: ${note.priority}`;
        treeItem.contextValue = `improvementNote${note.status.charAt(0).toUpperCase() + note.status.slice(1)}`;
        
        // Set icon based on status and priority
        if (note.status === 'completed') {
            treeItem.iconPath = new vscode.ThemeIcon('check');
        } else if (note.status === 'dismissed') {
            treeItem.iconPath = new vscode.ThemeIcon('x');
        } else {
            treeItem.iconPath = this.getPriorityIcon(note.priority);
        }

        if (note.context?.filePath) {
            treeItem.tooltip = new vscode.MarkdownString();
            treeItem.tooltip.appendMarkdown(`**Priority:** ${note.priority}\n\n`);
            treeItem.tooltip.appendMarkdown(`**Status:** ${note.status}\n\n`);
            treeItem.tooltip.appendMarkdown(`**File:** ${note.context.filePath}\n`);
            if (note.context.symbolName) {
                treeItem.tooltip.appendMarkdown(`**Symbol:** ${note.context.symbolName}\n`);
            }
            if (note.context.selection) {
                treeItem.tooltip.appendMarkdown(`**Lines:** ${note.context.selection.startLine}-${note.context.selection.endLine}\n`);
            }
            treeItem.tooltip.appendMarkdown(`\n*Created: ${new Date(note.createdAt).toLocaleString()}*`);
            if (note.completedAt) {
                treeItem.tooltip.appendMarkdown(`\n*Completed: ${new Date(note.completedAt).toLocaleString()}*`);
            }

            treeItem.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [
                    vscode.Uri.file(note.context.filePath),
                    note.context.selection ? {
                        selection: new vscode.Range(
                            note.context.selection.startLine - 1,
                            note.context.selection.startChar,
                            note.context.selection.endLine - 1,
                            note.context.selection.endChar
                        )
                    } : undefined
                ]
            };
        }

        return treeItem;
    }

    getChildren(element?: ImprovementNote | ImprovementGroup): Thenable<(ImprovementNote | ImprovementGroup)[]> {
        if (!element) {
            // Root level - show groups
            return Promise.resolve(this.getGroups());
        }

        if (this.isImprovementGroup(element)) {
            // Group level - show notes in the group
            return Promise.resolve(element.notes);
        }

        // Note level - no children
        return Promise.resolve([]);
    }

    private isImprovementGroup(element: any): element is ImprovementGroup {
        return 'notes' in element;
    }

    private getGroups(): ImprovementGroup[] {
        const allNotes = this.improvementManager.getNotes();
        const pendingNotes = allNotes.filter(note => note.status === 'pending');
        const completedNotes = allNotes.filter(note => note.status === 'completed');
        const dismissedNotes = allNotes.filter(note => note.status === 'dismissed');

        const groups: ImprovementGroup[] = [];

        // Add pending notes grouped by priority
        if (pendingNotes.length > 0) {
            const highPriority = pendingNotes.filter(note => note.priority === 'high');
            const mediumPriority = pendingNotes.filter(note => note.priority === 'medium');
            const lowPriority = pendingNotes.filter(note => note.priority === 'low');
            const noPriority = pendingNotes.filter(note => note.priority === 'none');

            if (highPriority.length > 0) {
                groups.push({ label: 'High Priority', notes: highPriority, priority: 'high' });
            }
            if (mediumPriority.length > 0) {
                groups.push({ label: 'Medium Priority', notes: mediumPriority, priority: 'medium' });
            }
            if (lowPriority.length > 0) {
                groups.push({ label: 'Low Priority', notes: lowPriority, priority: 'low' });
            }
            if (noPriority.length > 0) {
                groups.push({ label: 'No Priority', notes: noPriority, priority: 'none' });
            }
        }

        // Add completed and dismissed notes
        if (completedNotes.length > 0) {
            groups.push({ label: 'Completed', notes: completedNotes, status: 'completed' });
        }
        if (dismissedNotes.length > 0) {
            groups.push({ label: 'Dismissed', notes: dismissedNotes, status: 'dismissed' });
        }

        return groups;
    }

    private getPriorityIcon(priority: 'high' | 'medium' | 'low' | 'none'): vscode.ThemeIcon {
        switch (priority) {
            case 'high':
                return new vscode.ThemeIcon('arrow-up', new vscode.ThemeColor('charts.red'));
            case 'medium':
                return new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.yellow'));
            case 'low':
                return new vscode.ThemeIcon('arrow-down', new vscode.ThemeColor('charts.blue'));
            case 'none':
                return new vscode.ThemeIcon('dash', new vscode.ThemeColor('charts.foreground'));
        }
    }

    private getStatusIcon(status: ImprovementNoteStatus): vscode.ThemeIcon {
        switch (status) {
            case 'completed':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            case 'dismissed':
                return new vscode.ThemeIcon('x', new vscode.ThemeColor('charts.red'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
} 