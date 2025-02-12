import { ChatSession } from '../entities/ChatSession';
import { Message } from '../entities/Message';
import { AIModelConfig } from './IAIService';

export interface IChatRepository {
    getCurrentSession(): Promise<ChatSession | null>;
    createSession(name: string, config: AIModelConfig): Promise<ChatSession>;
    saveSession(session: ChatSession): Promise<void>;
    loadSession(id: string): Promise<ChatSession | null>;
    deleteSession(id: string): Promise<void>;
    getAllSessions(): Promise<ChatSession[]>;
    getSessions(): Promise<ChatSession[]>;
    getSessionById(id: string): Promise<ChatSession | null>;
    updateSession(session: ChatSession): Promise<void>;
    saveMessage(sessionId: string, message: Message): Promise<void>;
    updateMessage(sessionId: string, messageId: string, content: string): Promise<void>;
    deleteMessage(sessionId: string, messageId: string): Promise<void>;
    setCurrentSession(session: ChatSession): Promise<void>;
    clearSession(sessionId: string): Promise<void>;
} 