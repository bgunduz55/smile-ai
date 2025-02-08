import * as vscode from 'vscode';
import axios from 'axios';
import { LLMService } from './llmService';
import { AgentTask, TaskResult } from './types';

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

export class OllamaService implements LLMService {
    private endpoint: string;
    private currentModel: string;
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

    constructor() {
        const config = vscode.workspace.getConfiguration('smile-ai.ollama');
        this.endpoint = config.get('endpoint') || 'http://localhost:11434';
        this.currentModel = config.get('defaultModel') || 'llama2';
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        if (!this.isInitialized) {
            this.statusBarItem.text = "$(sync~spin) Ollama";
            this.statusBarItem.tooltip = "Ollama başlatılıyor...";
        } else if (this.lastError) {
            this.statusBarItem.text = "$(error) Ollama";
            this.statusBarItem.tooltip = `Hata: ${this.lastError.message}`;
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
            this.lastError = error instanceof Error ? error : new Error('Bilinmeyen bir hata oluştu');
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
            console.warn('GPU bilgisi alınamadı:', error);
        }
    }

    private async loadModels(): Promise<void> {
        try {
            const response = await axios.get(`${this.endpoint}/api/tags`);
            this.models = response.data.models;
            
            // Model metadata'sını güncelle
            if (this.currentModel) {
                await this.updateModelMetadata(this.currentModel);
            }
        } catch (error) {
            console.error('Ollama modelleri yüklenirken hata:', error);
            throw new Error('Ollama model listesi yüklenemedi. Ollama servisinin çalıştığından emin olun.');
        }
    }

    private async updateModelMetadata(modelName: string): Promise<void> {
        try {
            const response = await axios.get(`${this.endpoint}/api/show`, {
                params: { name: modelName }
            });
            
            const model = this.models.find(m => m.name === modelName);
            if (model) {
                Object.assign(model.details, response.data.details);
            }
        } catch (error) {
            console.warn(`Model metadata güncellenemedi (${modelName}):`, error);
        }
    }

    public async listModels(): Promise<OllamaModel[]> {
        return this.models;
    }

    public async setModel(modelName: string): Promise<void> {
        if (!this.models.some(m => m.name === modelName)) {
            throw new Error(`Model bulunamadı: ${modelName}`);
        }
        this.currentModel = modelName;
        await this.updateModelMetadata(modelName);
        await vscode.workspace.getConfiguration('smile-ai.ollama').update('defaultModel', modelName, true);
        this.updateStatusBar();
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        const startTime = Date.now();

        try {
            const prompt = this.buildPrompt(task);
            const config = vscode.workspace.getConfiguration('smile-ai.ollama');
            
            const options: OllamaGenerateOptions = {
                model: this.currentModel,
                prompt,
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

            // Performans metriklerini güncelle
            this.updatePerformanceMetrics(stats, executionTime);

            return {
                success: true,
                output: response.data.response,
                metadata: {
                    tokensUsed: stats.totalTokens || 0,
                    executionTime,
                    modelName: this.currentModel,
                    memoryUsage: this.performanceMetrics.memoryUsage ? {
                        heapUsed: this.performanceMetrics.memoryUsage.used,
                        heapTotal: this.performanceMetrics.memoryUsage.total,
                        external: 0
                    } : undefined,
                    gpuUsage: this.performanceMetrics.gpuUtilization ? {
                        memoryUsed: 0, // GPU bellek kullanımı bilgisi şu anda mevcut değil
                        utilization: this.performanceMetrics.gpuUtilization
                    } : undefined
                }
            };
        } catch (error) {
            this.handleError(error);
            return {
                success: false,
                output: '',
                error: error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu',
                metadata: {
                    tokensUsed: 0,
                    executionTime: Date.now() - startTime,
                    modelName: this.currentModel
                }
            };
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
        this.lastError = error instanceof Error ? error : new Error('Bilinmeyen bir hata oluştu');
        
        // Hata durumunu göster
        this.updateStatusBar();
        
        // Belirli bir hata sayısına ulaşıldığında servisi yeniden başlat
        if (this.errorCount >= 5) {
            this.errorCount = 0;
            this.initialize().catch(console.error);
        }
    }

    private buildPrompt(task: AgentTask): string {
        let prompt = task.input;
        
        if (task.context) {
            prompt = `Context:\n${task.context}\n\nTask:\n${task.input}`;
        }

        if (task.constraints) {
            prompt += `\n\nConstraints:\n${JSON.stringify(task.constraints, null, 2)}`;
        }

        return prompt;
    }

    public getPerformanceMetrics(): PerformanceMetrics {
        return { ...this.performanceMetrics };
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }
} 