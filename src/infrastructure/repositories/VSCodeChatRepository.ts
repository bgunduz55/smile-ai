import * as vscode from 'vscode';
import { IChatRepository } from '../../domain/interfaces/IChatRepository';
import { ChatSession } from '../../domain/entities/ChatSession';
import { Message, MessageEntity } from '../../domain/entities/Message';
import { AIModelConfig } from '../../domain/interfaces/IAIService';

export class VSCodeChatRepository implements IChatRepository {
    private static readonly STORAGE_KEY = 'smile-ai.chatSessions';
    private static instance: VSCodeChatRepository;
    private currentSession: ChatSession | null = null;
    private sessions: Map<string, ChatSession> = new Map();

    private constructor(private readonly context: vscode.ExtensionContext) {}

    public static getInstance(context: vscode.ExtensionContext): VSCodeChatRepository {
        if (!VSCodeChatRepository.instance) {
            VSCodeChatRepository.instance = new VSCodeChatRepository(context);
        }
        return VSCodeChatRepository.instance;
    }

    public async getCurrentSession(): Promise<ChatSession | null> {
        return this.currentSession;
    }

    public async saveSession(session: ChatSession): Promise<void> {
        this.currentSession = session;
        await this.persistToStorage();
    }

    private async persistToStorage(): Promise<void> {
        if (!this.currentSession) {
            return;
        }

        const state = this.context.globalState;
        const sessions = await state.get<any[]>(VSCodeChatRepository.STORAGE_KEY) || [];
        const sessionData = {
            id: this.currentSession.getId(),
            name: this.currentSession.getName(),
            messages: this.currentSession.getMessages(),
            createdAt: this.currentSession.getCreatedAt(),
            updatedAt: this.currentSession.getUpdatedAt(),
            settings: this.currentSession.getSettings()
        };

        const index = sessions.findIndex(s => s.id === sessionData.id);
        if (index >= 0) {
            sessions[index] = sessionData;
        } else {
            sessions.push(sessionData);
        }

        await state.update(VSCodeChatRepository.STORAGE_KEY, sessions);
    }

    public async loadSession(id: string): Promise<ChatSession | null> {
        const state = this.context.globalState;
        const sessions = await state.get<any[]>(VSCodeChatRepository.STORAGE_KEY) || [];
        const sessionData = sessions.find(s => s.id === id);

        if (!sessionData) {
            return null;
        }

        const defaultConfig: AIModelConfig = {
            model: 'default-model',
            temperature: 0.7,
            maxTokens: 2048,
            topP: 1,
            frequencyPenalty: 0,
            presencePenalty: 0
        };

        const session = new ChatSession(sessionData.name || 'Restored Session', sessionData.settings || defaultConfig);
        sessionData.messages.forEach((msg: Message) => {
            const message = new MessageEntity(msg.role, msg.content, msg.metadata);
            session.addMessage(message);
        });

        return session;
    }

    public async deleteSession(id: string): Promise<void> {
        const state = this.context.globalState;
        const sessions = await state.get<any[]>(VSCodeChatRepository.STORAGE_KEY) || [];
        const updatedSessions = sessions.filter(s => s.id !== id);
        await state.update(VSCodeChatRepository.STORAGE_KEY, updatedSessions);

        if (this.currentSession?.getId() === id) {
            this.currentSession = null;
        }
    }

    public async getAllSessions(): Promise<ChatSession[]> {
        const state = this.context.globalState;
        const sessions = await state.get<any[]>(VSCodeChatRepository.STORAGE_KEY) || [];
        
        const defaultConfig: AIModelConfig = {
            model: 'default-model',
            temperature: 0.7,
            maxTokens: 2048,
            topP: 1,
            frequencyPenalty: 0,
            presencePenalty: 0
        };

        return sessions.map(sessionData => {
            const session = new ChatSession(sessionData.name || 'Restored Session', sessionData.settings || defaultConfig);
            sessionData.messages.forEach((msg: Message) => {
                const message = new MessageEntity(msg.role, msg.content, msg.metadata);
                session.addMessage(message);
            });
            return session;
        });
    }

    public async getSessions(): Promise<ChatSession[]> {
        return this.getAllSessions();
    }

    public async getSessionById(id: string): Promise<ChatSession | null> {
        return this.loadSession(id);
    }

    public async createSession(name: string, config: AIModelConfig): Promise<ChatSession> {
        const session = new ChatSession(name, config);
        this.sessions.set(session.getId(), session);
        this.currentSession = session;
        await this.saveSession(session);
        return session;
    }

    public async updateSession(session: ChatSession): Promise<void> {
        await this.saveSession(session);
    }

    public async saveMessage(sessionId: string, message: Message): Promise<void> {
        const session = await this.getSessionById(sessionId);
        if (session) {
            const newMessage = new MessageEntity(message.role, message.content, message.metadata);
            session.addMessage(newMessage);
            await this.saveSession(session);
        }
    }

    public async updateMessage(sessionId: string, messageId: string, content: string): Promise<void> {
        const session = await this.getSessionById(sessionId);
        if (session) {
            session.editMessage(messageId, content);
            await this.saveSession(session);
        }
    }

    public async deleteMessage(sessionId: string, messageId: string): Promise<void> {
        const session = await this.getSessionById(sessionId);
        if (session) {
            session.deleteMessage(messageId);
            await this.saveSession(session);
        }
    }

    public async setCurrentSession(session: ChatSession): Promise<void> {
        this.currentSession = session;
        await this.saveSession(session);
    }

    public async clearSession(sessionId: string): Promise<void> {
        const session = await this.getSessionById(sessionId);
        if (session) {
            session.clearMessages();
            await this.saveSession(session);
        }
    }
} 