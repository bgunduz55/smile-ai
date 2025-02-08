import * as vscode from 'vscode';
import axios from 'axios';
import { LLMService } from './llmService';
import { AgentTask, TaskResult } from './types';

interface QwenStats {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    duration: number;
}

interface PerformanceMetrics {
    averageResponseTime: number;
    tokensPerSecond: number;
    totalTokensGenerated: number;
}

export class QwenService implements LLMService {
    private endpoint: string;
    private apiKey: string;
    private model: string;
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
        const config = vscode.workspace.getConfiguration('smile-ai.qwen');
        this.endpoint = config.get('endpoint') || 'https://dashscope.aliyuncs.com/api/v1';
        this.apiKey = config.get('apiKey') || '';
        this.model = config.get('model') || 'qwen2.5-turbo';
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        if (!this.isInitialized) {
            this.statusBarItem.text = "$(sync~spin) Qwen";
            this.statusBarItem.tooltip = "Qwen başlatılıyor...";
        } else if (this.lastError) {
            this.statusBarItem.text = "$(error) Qwen";
            this.statusBarItem.tooltip = `Hata: ${this.lastError.message}`;
        } else {
            this.statusBarItem.text = "$(check) Qwen";
            this.statusBarItem.tooltip = `Model: ${this.model}\nTPS: ${this.performanceMetrics.tokensPerSecond.toFixed(2)}`;
        }
        this.statusBarItem.show();
    }

    public async initialize(): Promise<void> {
        try {
            if (!this.apiKey) {
                throw new Error('Qwen API anahtarı yapılandırılmamış');
            }

            // API bağlantısını test et
            await this.checkConnection();
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
            await axios.get(`${this.endpoint}/services/aigc/text-generation/generation`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
        } catch (error) {
            throw new Error('Qwen API bağlantısı kurulamadı');
        }
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        const startTime = Date.now();

        try {
            const prompt = this.buildPrompt(task);
            const config = vscode.workspace.getConfiguration('smile-ai.qwen');
            
            const response = await axios.post(
                `${this.endpoint}/services/aigc/text-generation/generation`,
                {
                    model: this.model,
                    input: {
                        messages: [
                            {
                                role: 'system',
                                content: config.get('systemPrompt') || 'You are a helpful AI assistant specialized in software development.'
                            },
                            {
                                role: 'user',
                                content: prompt
                            }
                        ]
                    },
                    parameters: {
                        temperature: config.get('temperature') ?? 0.7,
                        top_p: config.get('topP') ?? 0.9,
                        max_tokens: config.get('maxTokens') ?? 2048,
                        stop: config.get('stopTokens') ?? ['</s>', '<s>'],
                        result_format: 'message',
                        enable_search: config.get('enableSearch') ?? true,
                        seed: config.get('seed'),
                        repetition_penalty: config.get('repetitionPenalty') ?? 1.1,
                        top_k: config.get('topK') ?? 50
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const stats: QwenStats = {
                promptTokens: response.data.usage?.input_tokens || 0,
                completionTokens: response.data.usage?.output_tokens || 0,
                totalTokens: response.data.usage?.total_tokens || 0,
                duration: Date.now() - startTime
            };

            // Performans metriklerini güncelle
            this.updatePerformanceMetrics(stats);

            return {
                success: true,
                output: response.data.output?.text || '',
                metadata: {
                    tokensUsed: stats.totalTokens,
                    executionTime: stats.duration,
                    modelName: this.model
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
                    modelName: this.model
                }
            };
        }
    }

    private updatePerformanceMetrics(stats: QwenStats): void {
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
        
        // API anahtarı hatası varsa kullanıcıyı bilgilendir
        if (error instanceof Error && error.message.includes('401')) {
            vscode.window.showErrorMessage('Qwen API anahtarı geçersiz veya süresi dolmuş');
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

    public dispose(): void {
        this.statusBarItem.dispose();
    }
} 