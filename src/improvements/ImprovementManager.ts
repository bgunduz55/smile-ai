import * as vscode from 'vscode';

export type ImprovementNoteStatus = 'pending' | 'completed' | 'dismissed';

export interface ImprovementNoteContext {
    filePath?: string;
    symbolName?: string;
    selection?: {
        startLine: number;
        startChar: number;
        endLine: number;
        endChar: number;
    };
    selectedText?: string;
}

export interface ImprovementNote {
    id: string;
    content: string;
    status: ImprovementNoteStatus;
    priority: 'high' | 'medium' | 'low' | 'none';
    createdAt: number;
    completedAt?: number;
    context?: ImprovementNoteContext;
}

export class ImprovementManager {
    private static instance: ImprovementManager;
    private notes: ImprovementNote[] = [];
    private readonly storageKey = 'smile-ai-improvements';
    private context: vscode.ExtensionContext;
    private _onDidChangeNotes = new vscode.EventEmitter<void>();
    public readonly onDidChangeNotes = this._onDidChangeNotes.event;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadNotes();
    }

    public static initialize(context: vscode.ExtensionContext): void {
        if (!ImprovementManager.instance) {
            ImprovementManager.instance = new ImprovementManager(context);
        }
    }

    public static getInstance(): ImprovementManager {
        if (!ImprovementManager.instance) {
            throw new Error('ImprovementManager must be initialized before getting an instance');
        }
        return ImprovementManager.instance;
    }

    public addNote(content: string, context?: ImprovementNoteContext, priority: 'high' | 'medium' | 'low' | 'none' = 'medium'): ImprovementNote {
        const note: ImprovementNote = {
            id: this.generateId(),
            content,
            status: 'pending',
            priority,
            createdAt: Date.now(),
            context
        };

        this.notes.push(note);
        this.saveNotes();
        this._onDidChangeNotes.fire();
        return note;
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    private loadNotes(): void {
        const data = this.context.globalState.get<ImprovementNote[]>(this.storageKey) || [];
        this.notes = data;
    }

    private saveNotes(): void {
        this.context.globalState.update(this.storageKey, this.notes);
        this._onDidChangeNotes.fire();
    }

    public getNotes(): ImprovementNote[] {
        return this.notes.sort((a, b) => {
            // Sort by priority first
            const priorityOrder = { high: 0, medium: 1, low: 2, none: 3 };
            const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
            if (priorityDiff !== 0) return priorityDiff;
            
            // Then by status (pending first)
            if (a.status !== b.status) {
                return a.status === 'pending' ? -1 : 1;
            }
            
            // Finally by creation date (newest first)
            return b.createdAt - a.createdAt;
        });
    }

    public updateNotePriority(id: string, priority: 'high' | 'medium' | 'low' | 'none'): void {
        const note = this.notes.find(n => n.id === id);
        if (note) {
            note.priority = priority;
            this.saveNotes();
        }
    }

    public updateNoteStatus(id: string, status: ImprovementNoteStatus): void {
        const note = this.notes.find(n => n.id === id);
        if (note) {
            note.status = status;
            if (status === 'completed') {
                note.completedAt = Date.now();
            }
            this.saveNotes();
        }
    }

    public getAllNotes(): ImprovementNote[] {
        return [...this.notes];
    }

    public getPendingNotes(): ImprovementNote[] {
        return this.notes.filter(note => note.status === 'pending');
    }

    public getCompletedNotes(): ImprovementNote[] {
        return this.notes.filter(note => note.status === 'completed');
    }

    public getDismissedNotes(): ImprovementNote[] {
        return this.notes.filter(note => note.status === 'dismissed');
    }

    public getNotesByStatus(status: ImprovementNoteStatus): ImprovementNote[] {
        return this.notes.filter(note => note.status === status);
    }

    public removeNote(id: string): void {
        const index = this.notes.findIndex(note => note.id === id);
        if (index !== -1) {
            this.notes.splice(index, 1);
            this.saveNotes();
        }
    }
} 