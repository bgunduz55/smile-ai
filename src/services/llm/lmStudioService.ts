import * as vscode from 'vscode';
import axios from 'axios';
import { LLMService } from './llmService';
import { AgentTask, TaskResult } from './types';

interface LMStudioModel {
    id: string;
    name: string;
    format: string;
    size: number;
    parameters: number;
    lastUsed: Date;
}

interface LMStudioStats {
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
}

export class LMStudioService implements LLMService {
    private endpoint: string;
    private currentModel: string;
    private models: LMStudioModel[] = [];
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
        const config = vscode.workspace.getConfiguration('smile-ai.lmstudio');
        this.endpoint = config.get('endpoint') || 'http://localhost:1234/v1';
        this.currentModel = config.get('defaultModel') || 'default';
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        if (!this.isInitialized) {
            this.statusBarItem.text = "$(sync~spin) LM Studio";
            this.statusBarItem.tooltip = "LM Studio başlatılıyor...";
        } else if (this.lastError) {
            this.statusBarItem.text = "$(error) LM Studio";
            this.statusBarItem.tooltip = `Hata: ${this.lastError.message}`;
        } else {
            this.statusBarItem.text = "$(check) LM Studio";
            this.statusBarItem.tooltip = `Model: ${this.currentModel}\nTPS: ${this.performanceMetrics.tokensPerSecond.toFixed(2)}`;
        }
        this.statusBarItem.show();
    }

    public async initialize(): Promise<void> {
        try {
            await this.checkConnection();
            await this.loadModelInfo();
            this.isInitialized = true;
            this.updateStatusBar();
        } catch (error) {
            this.lastError = error instanceof Error ? error : new Error('Bilinmeyen bir hata oluştu');
            this.updateStatusBar();
            throw error;
        }
    }

    private async checkConnection(): Promise<void> {
        try {
            await axios.get(`${this.endpoint}/models`);
        } catch (error) {
            throw new Error('LM Studio bağlantısı kurulamadı. Servisin çalıştığından emin olun.');
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

    public async processTask(task: AgentTask): Promise<TaskResult> {
        const startTime = Date.now();

        try {
            const prompt = this.buildPrompt(task);
            const config = vscode.workspace.getConfiguration('smile-ai.lmstudio');
            
            const response = await axios.post(`${this.endpoint}/chat/completions`, {
                model: this.currentModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful AI assistant specialized in software development.'
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

            const stats: LMStudioStats = {
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

    private updatePerformanceMetrics(stats: LMStudioStats): void {
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

    public getModels(): LMStudioModel[] {
        return [...this.models];
    }

    public async setModel(modelId: string): Promise<void> {
        const model = this.models.find(m => m.id === modelId);
        if (!model) {
            throw new Error(`Model bulunamadı: ${modelId}`);
        }
        
        this.currentModel = modelId;
        model.lastUsed = new Date();
        
        await vscode.workspace.getConfiguration('smile-ai.lmstudio')
            .update('defaultModel', modelId, true);
        
        this.updateStatusBar();
    }

    public getPerformanceMetrics(): PerformanceMetrics {
        return { ...this.performanceMetrics };
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }
} 