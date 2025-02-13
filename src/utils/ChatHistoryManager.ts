import * as vscode from 'vscode';
import { AIMessage } from '../ai-engine/types';

export interface ChatSession {
    id: string;
    title: string;
    messages: AIMessage[];
    created: number;
    lastUpdated: number;
}

export class ChatHistoryManager {
    private static instance: ChatHistoryManager;
    private sessions: Map<string, ChatSession>;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.sessions = new Map();
        this.loadSessions();
    }

    public static getInstance(context: vscode.ExtensionContext): ChatHistoryManager {
        if (!ChatHistoryManager.instance) {
            ChatHistoryManager.instance = new ChatHistoryManager(context);
        }
        return ChatHistoryManager.instance;
    }

    private async loadSessions() {
        const savedSessions = await this.context.globalState.get<ChatSession[]>('chatSessions', []);
        savedSessions.forEach(session => {
            this.sessions.set(session.id, session);
        });
    }

    private async saveSessions() {
        await this.context.globalState.update('chatSessions', 
            Array.from(this.sessions.values())
        );
    }

    public createSession(title: string): ChatSession {
        const session: ChatSession = {
            id: Date.now().toString(),
            title,
            messages: [],
            created: Date.now(),
            lastUpdated: Date.now()
        };
        
        this.sessions.set(session.id, session);
        this.saveSessions();
        return session;
    }

    public getSession(id: string): ChatSession | undefined {
        return this.sessions.get(id);
    }

    public getAllSessions(): ChatSession[] {
        return Array.from(this.sessions.values())
            .sort((a, b) => b.lastUpdated - a.lastUpdated);
    }

    public async addMessage(sessionId: string, message: AIMessage): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        session.messages.push(message);
        session.lastUpdated = Date.now();
        await this.saveSessions();
    }

    public async clearSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        session.messages = [];
        session.lastUpdated = Date.now();
        await this.saveSessions();
    }

    public async deleteSession(sessionId: string): Promise<void> {
        this.sessions.delete(sessionId);
        await this.saveSessions();
    }

    public async renameSession(sessionId: string, newTitle: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        session.title = newTitle;
        session.lastUpdated = Date.now();
        await this.saveSessions();
    }
} 