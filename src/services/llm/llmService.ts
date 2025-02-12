import { SettingsService } from '../settingsService';
import { RateLimiterService } from '../rateLimiterService';
import { ErrorHandlingService } from '../errorHandlingService';

export interface LLMService {
    generateResponse(prompt: string): Promise<string>;
    streamResponse<T>(prompt: string, onUpdate: (chunk: string) => void): Promise<T>;
    getAvailableModels(): Promise<string[]>;
    setModel(model: string): Promise<void>;
    processTask(task: string): Promise<string>;
    dispose(): void;
}

export abstract class BaseLLMService implements LLMService {
    protected constructor(
        protected readonly settingsService: SettingsService,
        protected readonly rateLimiter: RateLimiterService,
        protected readonly errorHandler: ErrorHandlingService
    ) {}

    abstract generateResponse(prompt: string): Promise<string>;
    abstract streamResponse<T>(prompt: string, onUpdate: (chunk: string) => void): Promise<T>;
    abstract getAvailableModels(): Promise<string[]>;
    abstract setModel(model: string): Promise<void>;
    abstract processTask(task: string): Promise<string>;
    
    dispose(): void {
        // Base implementation - can be overridden by derived classes
    }
} 