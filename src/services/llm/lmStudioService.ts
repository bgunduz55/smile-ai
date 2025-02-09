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
        heapUsed: number;
        heapTotal: number;
        external: number;
    };
    gpuUsage?: {
        memoryUsed: number;
        utilization: number;
    };
}

export class LMStudioService implements LLMService {
    private static readonly DEFAULT_PORT = 1234;
    private static readonly MAX_RETRIES = 5;
    private static readonly RETRY_DELAY = 1000;

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
    private disposables: vscode.Disposable[] = [];

    constructor() {
        const config = vscode.workspace.getConfiguration('smile-ai.lmstudio');
        this.endpoint = config.get<string>('endpoint') || `http://localhost:${LMStudioService.DEFAULT_PORT}/v1`;
        this.currentModel = config.get<string>('defaultModel') || 'default';
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.updateStatusBar();
        this.registerEventHandlers();
    }

    private updateStatusBar(): void {
        if (!this.isInitialized) {
            this.statusBarItem.text = "$(sync~spin) LM Studio";
            this.statusBarItem.tooltip = "LM Studio is starting...";
        } else if (this.lastError) {
            this.statusBarItem.text = "$(error) LM Studio";
            this.statusBarItem.tooltip = `Error: ${this.lastError.message}`;
        } else {
            this.statusBarItem.text = "$(check) LM Studio";
            this.statusBarItem.tooltip = `Model: ${this.currentModel}\nTPS: ${this.performanceMetrics.tokensPerSecond.toFixed(2)}`;
        }
        this.statusBarItem.show();
    }

    private registerEventHandlers(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(async e => {
                if (e.affectsConfiguration('smile-ai.lmstudio')) {
                    await this.handleConfigurationChange();
                }
            })
        );
    }

    private async handleConfigurationChange(): Promise<void> {
        const config = vscode.workspace.getConfiguration('smile-ai.lmstudio');
        const newEndpoint = config.get<string>('endpoint') || `http://localhost:${LMStudioService.DEFAULT_PORT}/v1`;
        const newModel = config.get<string>('defaultModel') || 'default';

        if (this.endpoint !== newEndpoint || this.currentModel !== newModel) {
            this.endpoint = newEndpoint;
            this.currentModel = newModel;
            await this.initialize();
        }
    }

    public async initialize(): Promise<void> {
        try {
            await this.checkConnection();
            await this.loadModelInfo();
            this.isInitialized = true;
            this.updateStatusBar();
        } catch (error) {
            this.lastError = error instanceof Error ? error : new Error('Unknown error');
            this.updateStatusBar();
            throw error;
        }
    }

    private async checkConnection(): Promise<void> {
        for (let i = 0; i < LMStudioService.MAX_RETRIES; i++) {
            try {
                const response = await axios.get(`${this.endpoint}/models`);
                if (response.status === 200) {
                    return;
                }
            } catch (error) {
                if (i === LMStudioService.MAX_RETRIES - 1) {
                    throw new Error('LM Studio connection failed. Ensure the service is running.');
                }
                await new Promise(resolve => setTimeout(resolve, LMStudioService.RETRY_DELAY));
            }
        }
    }

    private async loadModelInfo(): Promise<void> {
        try {
            const response = await axios.get(`${this.endpoint}/models`);
            if (response.data?.data) {
                this.models = response.data.data.map((model: any) => ({
                    id: model.id,
                    name: model.name || 'Unknown Model',
                    format: model.format || 'Unknown',
                    size: model.size || 0,
                    parameters: model.parameters || 0,
                    lastUsed: new Date()
                }));
            } else {
                throw new Error('Invalid response format from LM Studio service');
            }
        } catch (error) {
            console.error('Model information could not be retrieved:', error);
            // Varsayılan model bilgisi
            this.models = [{
                id: 'default',
                name: 'Default Model',
                format: 'Unknown',
                size: 0,
                parameters: 0,
                lastUsed: new Date()
            }];
        }
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        if (!this.isInitialized) {
            throw new Error('LM Studio service is not initialized');
        }

        const startTime = Date.now();

        try {
            const prompt = this.buildPrompt(task);
            const config = vscode.workspace.getConfiguration('smile-ai.lmstudio');
            
            const response = await axios.post(`${this.endpoint}/chat/completions`, {
                model: this.currentModel,
                messages: [
                    {
                        role: 'system',
                        content: config.get<string>('systemPrompt') || 'You are a helpful AI assistant specialized in software development.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: config.get<number>('temperature') ?? 0.7,
                top_p: config.get<number>('topP') ?? 0.9,
                max_tokens: config.get<number>('maxTokens') ?? 2048,
                stop: config.get<string[]>('stopTokens') ?? ['</s>', '<s>']
            });

            const stats: LMStudioStats = {
                promptTokens: response.data.usage?.prompt_tokens || 0,
                completionTokens: response.data.usage?.completion_tokens || 0,
                totalTokens: response.data.usage?.total_tokens || 0,
                duration: Date.now() - startTime
            };

            this.updatePerformanceMetrics(stats);

            return {
                success: true,
                output: response.data.choices[0]?.message?.content || '',
                metadata: {
                    tokensUsed: stats.totalTokens,
                    executionTime: stats.duration,
                    modelName: this.currentModel
                }
            };
        } catch (error) {
            this.handleError(error);
            return {
                success: false,
                output: '',
                error: this.lastError?.message || 'Unknown error',
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
        this.lastError = error instanceof Error ? error : new Error('Unknown error');
        this.updateStatusBar();

        if (this.errorCount >= LMStudioService.MAX_RETRIES) {
            this.errorCount = 0;
            vscode.window.showErrorMessage(
                `LM Studio service encountered multiple errors. Please check the service status.`,
                'Retry Connection'
            ).then(selection => {
                if (selection === 'Retry Connection') {
                    this.initialize().catch(console.error);
                }
            });
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
            throw new Error(`Model not found: ${modelId}`);
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
        this.disposables.forEach(d => d.dispose());
        this.statusBarItem.dispose();
    }
} 