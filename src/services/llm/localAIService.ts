import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import { LLMService } from './llmService';
import { AgentTask, TaskResult } from './types';
import { DockerService } from './dockerService';

interface LocalAIModel {
    id: string;
    name: string;
    format: string;
    size: number;
    parameters: number;
    lastUsed: Date;
}

interface LocalAIStats {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    duration: number;
}

interface PerformanceMetrics {
    averageResponseTime: number;
    tokensPerSecond: number;
    totalTokensGenerated: number;
    memoryUsage?: {
        total: number;
        used: number;
    };
    cpuUsage?: number;
}

export class LocalAIService implements LLMService {
    private static readonly CONTAINER_NAME = 'smile-ai-localai';
    private static readonly IMAGE_NAME = 'localai/localai:latest';

    private endpoint: string;
    private currentModel: string;
    private models: LocalAIModel[] = [];
    private statusBarItem: vscode.StatusBarItem;
    private performanceMetrics: PerformanceMetrics = {
        averageResponseTime: 0,
        tokensPerSecond: 0,
        totalTokensGenerated: 0
    };
    private errorCount: number = 0;
    private lastError?: Error;
    private isInitialized: boolean = false;
    private dockerService: DockerService;
    private statsInterval: NodeJS.Timeout | null = null;

    constructor() {
        const config = vscode.workspace.getConfiguration('smile-ai.localai');
        this.endpoint = config.get('endpoint') || 'http://localhost:8080/v1';
        this.currentModel = config.get('defaultModel') || 'default';
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.dockerService = DockerService.getInstance();
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        if (!this.isInitialized) {
            this.statusBarItem.text = "$(sync~spin) LocalAI";
            this.statusBarItem.tooltip = "LocalAI başlatılıyor...";
        } else if (this.lastError) {
            this.statusBarItem.text = "$(error) LocalAI";
            this.statusBarItem.tooltip = `Hata: ${this.lastError.message}`;
        } else {
            this.statusBarItem.text = "$(check) LocalAI";
            this.statusBarItem.tooltip = `Model: ${this.currentModel}\nTPS: ${this.performanceMetrics.tokensPerSecond.toFixed(2)}\nCPU: ${this.performanceMetrics.cpuUsage?.toFixed(1)}%`;
        }
        this.statusBarItem.show();
    }

    public async initialize(): Promise<void> {
        try {
            await this.ensureDockerContainer();
            await this.waitForService();
            await this.loadModelInfo();
            this.startStatsMonitoring();
            this.isInitialized = true;
            this.updateStatusBar();
        } catch (error) {
            this.lastError = error instanceof Error ? error : new Error('Bilinmeyen bir hata oluştu');
            this.updateStatusBar();
            throw error;
        }
    }

    private async ensureDockerContainer(): Promise<void> {
        const config = vscode.workspace.getConfiguration('smile-ai.localai');
        const modelsPath = config.get('modelsPath') || path.join(process.env.HOME || process.env.USERPROFILE || '', '.smile-ai', 'models');
        
        // LocalAI container'ını başlat
        await this.dockerService.startContainer(
            LocalAIService.CONTAINER_NAME,
            LocalAIService.IMAGE_NAME,
            ['8080:8080'],
            [`${modelsPath}:/models`],
            {
                'CUDA_VISIBLE_DEVICES': config.get('gpuEnabled') ? '0' : '',
                'DEBUG': config.get('debug') ? '1' : '0'
            }
        );
    }

    private async waitForService(retries: number = 30, delay: number = 1000): Promise<void> {
        for (let i = 0; i < retries; i++) {
            try {
                await axios.get(`${this.endpoint}/health`);
                return;
            } catch (error) {
                if (i === retries - 1) {
                    throw new Error('LocalAI servisi başlatılamadı');
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    private async loadModelInfo(): Promise<void> {
        try {
            const response = await axios.get(`${this.endpoint}/models`);
            this.models = response.data.data.map((model: any) => ({
                id: model.id,
                name: model.name || 'Bilinmeyen Model',
                format: model.format || 'Bilinmeyen',
                size: model.size || 0,
                parameters: model.parameters || 0,
                lastUsed: new Date()
            }));
        } catch (error) {
            console.error('Model bilgileri alınamadı:', error);
            // Model bilgileri alınamasa da çalışmaya devam et
            this.models = [{
                id: 'default',
                name: 'Varsayılan Model',
                format: 'Bilinmeyen',
                size: 0,
                parameters: 0,
                lastUsed: new Date()
            }];
        }
    }

    private startStatsMonitoring(): void {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }

        this.statsInterval = setInterval(async () => {
            try {
                const stats = await this.dockerService.getContainerStats(LocalAIService.CONTAINER_NAME);
                this.performanceMetrics.cpuUsage = stats.cpuUsage;
                this.performanceMetrics.memoryUsage = {
                    total: stats.memoryUsage,
                    used: stats.memoryUsage
                };
                this.updateStatusBar();
            } catch (error) {
                console.error('Performans metrikleri alınamadı:', error);
            }
        }, 5000);
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        const startTime = Date.now();

        try {
            const prompt = this.buildPrompt(task);
            const config = vscode.workspace.getConfiguration('smile-ai.localai');
            
            const response = await axios.post(`${this.endpoint}/chat/completions`, {
                model: this.currentModel,
                messages: [
                    {
                        role: 'system',
                        content: config.get('systemPrompt') || 'You are a helpful AI assistant specialized in software development.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: config.get('temperature') ?? 0.7,
                top_p: config.get('topP') ?? 0.9,
                max_tokens: config.get('maxTokens') ?? 2048,
                stop: config.get('stopTokens') ?? ['</s>', '<s>']
            });

            const stats: LocalAIStats = {
                promptTokens: response.data.usage?.prompt_tokens || 0,
                completionTokens: response.data.usage?.completion_tokens || 0,
                totalTokens: response.data.usage?.total_tokens || 0,
                duration: Date.now() - startTime
            };

            // Performans metriklerini güncelle
            this.updatePerformanceMetrics(stats);

            return {
                success: true,
                output: response.data.choices[0]?.message?.content || '',
                metadata: {
                    tokensUsed: stats.totalTokens,
                    executionTime: stats.duration,
                    modelName: this.currentModel,
                    memoryUsage: this.performanceMetrics.memoryUsage ? {
                        heapUsed: this.performanceMetrics.memoryUsage.used,
                        heapTotal: this.performanceMetrics.memoryUsage.total,
                        external: 0
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

    private updatePerformanceMetrics(stats: LocalAIStats): void {
        const tokensPerSecond = stats.totalTokens / (stats.duration / 1000);
        
        this.performanceMetrics.totalTokensGenerated += stats.totalTokens;
        this.performanceMetrics.averageResponseTime = 
            (this.performanceMetrics.averageResponseTime + stats.duration) / 2;
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

    public getModels(): LocalAIModel[] {
        return [...this.models];
    }

    public async setModel(modelId: string): Promise<void> {
        const model = this.models.find(m => m.id === modelId);
        if (!model) {
            throw new Error(`Model bulunamadı: ${modelId}`);
        }
        
        this.currentModel = modelId;
        model.lastUsed = new Date();
        
        await vscode.workspace.getConfiguration('smile-ai.localai')
            .update('defaultModel', modelId, true);
        
        this.updateStatusBar();
    }

    public getPerformanceMetrics(): PerformanceMetrics {
        return { ...this.performanceMetrics };
    }

    public async getLogs(lines: number = 100): Promise<string> {
        return await this.dockerService.getContainerLogs(LocalAIService.CONTAINER_NAME, lines);
    }

    public dispose(): void {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
        this.statusBarItem.dispose();
        this.dockerService.stopContainer(LocalAIService.CONTAINER_NAME).catch(console.error);
    }
} 