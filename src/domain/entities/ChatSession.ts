import { v4 as uuidv4 } from 'uuid';
import { Message, MessageEntity } from './Message';
import { AIModelConfig } from '../interfaces/IAIService';

export class ChatSession {
    private readonly id: string;
    private name: string;
    private messages: Message[];
    private readonly createdAt: Date;
    private updatedAt: Date;
    private settings: AIModelConfig;

    constructor(name: string, settings: AIModelConfig) {
        this.id = uuidv4();
        this.name = name;
        this.messages = [];
        this.createdAt = new Date();
        this.updatedAt = new Date();
        this.settings = settings;
    }

    public getId(): string {
        return this.id;
    }

    public getMessages(): Message[] {
        return [...this.messages];
    }

    public getName(): string {
        return this.name;
    }

    public addMessage(message: Message): void {
        this.messages.push(message);
        this.updatedAt = new Date();
    }

    public editMessage(messageId: string, content: string): void {
        const message = this.messages.find(m => m.id === messageId);
        if (message) {
            message.content = content;
            if ('isEdited' in message) {
                message.isEdited = true;
                message.editedAt = new Date();
            }
            this.updatedAt = new Date();
        }
    }

    public deleteMessage(messageId: string): void {
        this.messages = this.messages.filter(m => m.id !== messageId);
        this.updatedAt = new Date();
    }

    public getCreatedAt(): Date {
        return this.createdAt;
    }

    public getUpdatedAt(): Date {
        return this.updatedAt;
    }

    public getSettings(): AIModelConfig {
        return { ...this.settings };
    }

    public updateSettings(settings: Partial<AIModelConfig>): void {
        this.settings = { ...this.settings, ...settings };
        this.updatedAt = new Date();
    }

    public clearMessages(): void {
        this.messages = [];
        this.updatedAt = new Date();
    }

    public toJSON(): any {
        return {
            id: this.id,
            name: this.name,
            messages: this.messages,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            settings: this.settings
        };
    }
} 