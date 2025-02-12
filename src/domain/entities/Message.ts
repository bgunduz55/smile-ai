import { v4 as uuidv4 } from 'uuid';

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isEdited?: boolean;
    editedAt?: Date;
    metadata?: {
        model?: string;
        provider?: string;
        tokens?: number;
        [key: string]: any;
    };
}

export class MessageEntity implements Message {
    public readonly id: string;
    public readonly role: 'user' | 'assistant';
    public content: string;
    public readonly timestamp: Date;
    public isEdited: boolean;
    public editedAt?: Date;
    public metadata?: {
        model?: string;
        provider?: string;
        tokens?: number;
        [key: string]: any;
    };

    constructor(role: 'user' | 'assistant', content: string, metadata?: any) {
        this.id = uuidv4();
        this.role = role;
        this.content = content;
        this.timestamp = new Date();
        this.isEdited = false;
        this.metadata = metadata;
    }

    public edit(newContent: string): void {
        this.content = newContent;
        this.isEdited = true;
        this.editedAt = new Date();
    }

    public addMetadata(key: string, value: any): void {
        if (!this.metadata) {
            this.metadata = {};
        }
        this.metadata[key] = value;
    }

    public toJSON(): Message {
        return {
            id: this.id,
            role: this.role,
            content: this.content,
            timestamp: this.timestamp,
            isEdited: this.isEdited,
            editedAt: this.editedAt,
            metadata: this.metadata
        };
    }
} 