import { Message } from '../entities/Message';
import { ModelProvider } from '../../models/settings';

export interface AIModelConfig {
    model: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    provider?: ModelProvider;
}

export interface IAIService {
    generateResponse(prompt: string): Promise<string>;
    streamResponse<T>(prompt: string, onUpdate: (chunk: string) => void): Promise<T>;
    getAvailableModels(): Promise<string[]>;
    setModel(model: string): Promise<void>;
    processTask(task: string): Promise<string>;
    dispose(): void;
} 