import * as vscode from 'vscode';
import axios from 'axios';
import { LLMService } from './llmService';
import { AgentTask, TaskResult } from './types';
import { v4 as uuidv4 } from 'uuid';
import { IAIService, AIModelConfig } from '../../domain/interfaces/IAIService';
import { Message } from '../../domain/entities/Message';
import { OpenAI } from 'openai';
import { SettingsService } from '../settingsService';
import { RateLimiterService } from '../rateLimiterService';
import { ErrorHandlingService } from '../errorHandlingService';
import { BaseLLMService } from './llmService';

interface OllamaModel {
    name: string;
    size: number;
    digest: string;
    modified_at: string;
    details: {
        format: string;
        family: string;
        parameter_size: string;
        quantization_level: string;
    };
}

interface OllamaModelStats {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalDuration: number;
    loadDuration: number;
    promptEvalDuration: number;
    evalDuration: number;
}

interface OllamaGenerateOptions {
    model: string;
    prompt: string;
    system?: string;
    template?: string;
    context?: number[];
    stream?: boolean;
    raw?: boolean;
    format?: 'json';
    options?: {
        temperature?: number;
        top_p?: number;
        top_k?: number;
        num_ctx?: number;
        num_predict?: number;
        stop?: string[];
        num_gpu?: number;
        num_thread?: number;
        repeat_last_n?: number;
        repeat_penalty?: number;
        tfs_z?: number;
        num_keep?: number;
        seed?: number;
        mirostat?: number;
        mirostat_eta?: number;
        mirostat_tau?: number;
        num_batch?: number;
        num_gqa?: number;
        num_gpu_layers?: number;
        rope_frequency_base?: number;
        rope_frequency_scale?: number;
    };
}

interface PerformanceMetrics {
    averageResponseTime: number;
    tokensPerSecond: number;
    totalTokensGenerated: number;
    gpuUtilization?: number;
    memoryUsage?: {
        total: number;
        used: number;
    };
}

interface OllamaResponse {
    model: string;
    created_at: string;
    response: string;
    done: boolean;
    context?: number[];
    total_duration?: number;
    load_duration?: number;
    prompt_eval_duration?: number;
    eval_duration?: number;
    prompt_tokens?: number;
    eval_tokens?: number;
}

export class OllamaService extends BaseLLMService {
    private endpoint: string;
    private currentModel: string = 'llama2';
    private models: OllamaModel[] = [];
    private statusBarItem: vscode.StatusBarItem;
    private performanceMetrics: PerformanceMetrics = {
        averageResponseTime: 0,
        tokensPerSecond: 0,
        totalTokensGenerated: 0
    };
    private errorCount: number = 0;
    private lastError?: Error;
    private isInitialized: boolean = false;

    constructor(
        settingsService: SettingsService,
        rateLimiter: RateLimiterService,
        errorHandler: ErrorHandlingService
    ) {
        super(settingsService, rateLimiter, errorHandler);
        this.endpoint = this.settingsService.getConfiguration<string>('ollama.endpoint', 'http://localhost:11434');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        if (!this.isInitialized) {
            this.statusBarItem.text = "$(sync~spin) Ollama";
            this.statusBarItem.tooltip = "Ollama starting...";
        } else if (this.lastError) {
            this.statusBarItem.text = "$(error) Ollama";
            this.statusBarItem.tooltip = `Error: ${this.lastError.message}`;
        } else {
            this.statusBarItem.text = "$(check) Ollama";
            this.statusBarItem.tooltip = `Model: ${this.currentModel}\nTPS: ${this.performanceMetrics.tokensPerSecond.toFixed(2)}`;
        }
        this.statusBarItem.show();
    }

    public async initialize(): Promise<void> {
        try {
            await this.loadModels();
            await this.checkGPUSupport();
            this.isInitialized = true;
            this.updateStatusBar();
        } catch (error) {
            this.lastError = error instanceof Error ? error : new Error('Unknown error');
            this.updateStatusBar();
            throw error;
        }
    }

    private async checkGPUSupport(): Promise<void> {
        try {
            const response = await axios.get(`${this.endpoint}/api/show`, {
                params: { name: this.currentModel }
            });
            
            const gpuLayers = response.data.options?.num_gpu_layers;
            if (gpuLayers) {
                this.performanceMetrics.gpuUtilization = gpuLayers;
            }
        } catch (error) {
            console.warn('GPU information could not be retrieved:', error);
        }
    }

    public async loadModels(): Promise<string[]> {
        try {
            const response = await axios.get(`${this.endpoint}/api/tags`);
            const models = response.data.models || [];
            const modelNames = models.map((model: any) => model.name);
            
            // Modelleri ayarlara kaydet
            await this.settingsService.updateProviderSettings('ollama', {
                models: modelNames
            });

            if (modelNames.length > 0) {
                await this.setModel(modelNames[0]);
            }

            return modelNames;
        } catch (error) {
            console.error('Error loading models:', error);
            return [];
        }
    }

    public async updateModelMetadata(modelName: string): Promise<void> {
        try {
            const response = await axios.get(`${this.endpoint}/api/show`, {
                params: { name: modelName }
            });
            
            if (response.data) {
                const settings = this.settingsService.getSettings();
                const ollamaSettings = settings.providers.ollama || {};
                
                await this.settingsService.updateProviderSettings('ollama', {
                    ...ollamaSettings,
                    modelMetadata: {
                        ...ollamaSettings.modelMetadata,
                        [modelName]: {
                            ...response.data,
                            lastUpdated: new Date().toISOString()
                        }
                    }
                });
            }
        } catch (error) {
            console.error(`Error updating model metadata for ${modelName}:`, error);
        }
    }

    public async getAvailableModels(): Promise<string[]> {
        try {
            const response = await axios.get(`${this.endpoint}/api/tags`);
            return response.data.models.map((model: OllamaModel) => model.name);
        } catch (error) {
            this.errorHandler.handleError(error);
            return [];
        }
    }

    public async setModel(model: string): Promise<void> {
        if (!this.models.some(m => m.name === model)) {
            throw new Error(`Model not found: ${model}`);
        }
        this.currentModel = model;
        await this.updateModelMetadata(model);
        await vscode.workspace.getConfiguration('smile-ai.ollama').update('defaultModel', model, true);
        this.updateStatusBar();
    }

    public async processTask(task: string): Promise<string> {
        const startTime = Date.now();

        try {
            const config = vscode.workspace.getConfiguration('smile-ai.ollama');
            
            const options: OllamaGenerateOptions = {
                model: this.currentModel,
                prompt: task,
                options: {
                    temperature: config.get('temperature') ?? 0.7,
                    top_p: config.get('topP') ?? 0.9,
                    num_ctx: config.get('contextSize') ?? 4096,
                    num_gpu_layers: config.get('gpuLayers') ?? 0,
                    num_thread: config.get('threads') ?? 4,
                    num_batch: config.get('batchSize') ?? 512,
                    stop: config.get('stopTokens') ?? ['</s>', '<s>']
                }
            };

            const response = await axios.post(`${this.endpoint}/api/generate`, options);
            const stats: OllamaModelStats = response.data.stats || {};
            const executionTime = Date.now() - startTime;

            this.updatePerformanceMetrics(stats, executionTime);

            return response.data.response;
        } catch (error) {
            this.handleError(error);
            throw error;
        }
    }

    private updatePerformanceMetrics(stats: OllamaModelStats, executionTime: number): void {
        const tokensPerSecond = stats.totalTokens / (executionTime / 1000);
        
        this.performanceMetrics.totalTokensGenerated += stats.totalTokens;
        this.performanceMetrics.averageResponseTime = 
            (this.performanceMetrics.averageResponseTime + executionTime) / 2;
        this.performanceMetrics.tokensPerSecond = 
            (this.performanceMetrics.tokensPerSecond + tokensPerSecond) / 2;

        this.updateStatusBar();
    }

    private handleError(error: unknown): void {
        this.errorCount++;
        this.lastError = error instanceof Error ? error : new Error('Unknown error');
        
        this.updateStatusBar();

        if (this.errorCount >= 5) {
            this.errorCount = 0;
            this.initialize().catch(console.error);
        }
    }

    public getPerformanceMetrics(): PerformanceMetrics {
        return { ...this.performanceMetrics };
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }

    async generateResponse(prompt: string): Promise<string> {
        try {
            const response = await axios.post<OllamaResponse>(`${this.endpoint}/api/generate`, {
                model: this.currentModel,
                prompt,
                stream: false,
                options: {
                    temperature: this.settingsService.getConfiguration<number>('temperature', 0.7),
                    num_predict: this.settingsService.getConfiguration<number>('maxTokens', 2048)
                }
            });

            return response.data.response;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Ollama API error: ${error.response?.data?.message || error.message}`);
            }
            throw error;
        }
    }

    async streamResponse<T>(
        prompt: string,
        onChunk: (chunk: string) => void
    ): Promise<T> {
        try {
            const response = await axios.post(`${this.endpoint}/api/generate`, {
                model: this.currentModel,
                prompt,
                stream: true,
                options: {
                    temperature: this.settingsService.getConfiguration<number>('temperature', 0.7),
                    num_predict: this.settingsService.getConfiguration<number>('maxTokens', 2048)
                }
            }, {
                responseType: 'text',
                transformResponse: (data) => data // Prevent JSON parsing
            });

            let fullResponse = '';
            let metadata: any = {};

            // Split the response by newlines and parse each line as JSON
            const lines = response.data.split('\n').filter(Boolean);
            for (const line of lines) {
                const data: OllamaResponse = JSON.parse(line);
                fullResponse += data.response;
                onChunk(data.response);

                if (data.done) {
                    metadata = {
                        model: this.currentModel,
                        provider: 'ollama',
                        tokens: data.eval_tokens,
                        totalDuration: data.total_duration,
                        promptEvalDuration: data.prompt_eval_duration,
                        evalDuration: data.eval_duration
                    };
                }
            }

            return fullResponse as T;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Ollama API error: ${error.response?.data?.message || error.message}`);
            }
            throw error;
        }
    }

    async validateConfig(config: AIModelConfig): Promise<boolean> {
        try {
            const models = await this.getAvailableModels();
            return models.includes(config.model);
        } catch {
            return false;
        }
    }
} 