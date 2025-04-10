export interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    attachments?: Array<{
        type: 'file' | 'folder';
        path: string;
    }>;
    context?: {
        file?: string;
        selection?: string;
        codebase?: any;
    };
} 