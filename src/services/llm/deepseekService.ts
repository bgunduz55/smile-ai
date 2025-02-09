import * as vscode from 'vscode';
import axios from 'axios';
import { LLMService } from './llmService';
import { AgentTask, TaskResult } from './types';

interface DeepseekModel {
    id: string;
    name: string;
    format: string;
    size: number;
    parameters: number;
    lastUsed: Date;
}

interface DeepseekStats {
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

export class DeepseekService implements LLMService {
    private static readonly DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1';
    private static readonly DEFAULT_MODEL = 'deepseek-coder-33b-instruct';
    private static readonly MAX_RETRIES = 3;
    private static readonly RETRY_DELAY = 1000;

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
    private disposables: vscode.Disposable[] = [];

    constructor() {
        const config = vscode.workspace.getConfiguration('smile-ai.deepseek');
        this.endpoint = config.get<string>('endpoint') || DeepseekService.DEFAULT_ENDPOINT;
        this.apiKey = config.get<string>('apiKey') || '';
        this.model = config.get<string>('model') || DeepseekService.DEFAULT_MODEL;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.updateStatusBar();
        this.registerEventHandlers();
    }

    private updateStatusBar(): void {
        if (!this.isInitialized) {
            this.statusBarItem.text = "$(sync~spin) Deepseek";
            this.statusBarItem.tooltip = "Deepseek starting...";
        } else if (this.lastError) {
            this.statusBarItem.text = "$(error) Deepseek";
            this.statusBarItem.tooltip = `Error: ${this.lastError.message}`;
        } else {
            this.statusBarItem.text = "$(check) Deepseek";
            this.statusBarItem.tooltip = `Model: ${this.model}\nTPS: ${this.performanceMetrics.tokensPerSecond.toFixed(2)}`;
        }
        this.statusBarItem.show();
    }

    private registerEventHandlers(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(async e => {
                if (e.affectsConfiguration('smile-ai.deepseek')) {
                    await this.handleConfigurationChange();
                }
            })
        );
    }

    private async handleConfigurationChange(): Promise<void> {
        const config = vscode.workspace.getConfiguration('smile-ai.deepseek');
        const newEndpoint = config.get<string>('endpoint') || DeepseekService.DEFAULT_ENDPOINT;
        const newApiKey = config.get<string>('apiKey') || '';
        const newModel = config.get<string>('model') || DeepseekService.DEFAULT_MODEL;

        if (this.endpoint !== newEndpoint || this.apiKey !== newApiKey || this.model !== newModel) {
            this.endpoint = newEndpoint;
            this.apiKey = newApiKey;
            this.model = newModel;
            await this.initialize();
        }
    }

    public async initialize(): Promise<void> {
        try {
            if (!this.apiKey) {
                throw new Error('Deepseek API key is not configured');
            }

            await this.checkConnection();
            this.isInitialized = true;
            this.updateStatusBar();
        } catch (error) {
            this.lastError = error instanceof Error ? error : new Error('Unknown error');
            this.updateStatusBar();
            throw error;
        }
    }

    private async checkConnection(): Promise<void> {
        for (let i = 0; i < DeepseekService.MAX_RETRIES; i++) {
            try {
                const response = await axios.get(`${this.endpoint}/models`, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`
                    }
                });
                if (response.status === 200) {
                    return;
                }
            } catch (error) {
                if (i === DeepseekService.MAX_RETRIES - 1) {
                    if (error instanceof Error && error.message.includes('401')) {
                        throw new Error('Invalid Deepseek API key');
                    }
                    throw new Error('Deepseek connection failed');
                }
                await new Promise(resolve => setTimeout(resolve, DeepseekService.RETRY_DELAY));
            }
        }
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        if (!this.isInitialized) {
            throw new Error('Deepseek service is not initialized');
        }

        const startTime = Date.now();

        try {
            const prompt = this.buildPrompt(task);
            const config = vscode.workspace.getConfiguration('smile-ai.deepseek');
            
            const response = await axios.post(`${this.endpoint}/chat/completions`, {
                model: this.model,
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
                stop: config.get<string[]>('stopTokens') ?? ['</s>', '<s>'],
                frequency_penalty: config.get<number>('frequencyPenalty') ?? 0,
                presence_penalty: config.get<number>('presencePenalty') ?? 0
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const stats: DeepseekStats = {
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
                    modelName: this.model
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
                    modelName: this.model
                }
            };
        }
    }

    private updatePerformanceMetrics(stats: DeepseekStats): void {
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

        if (this.errorCount >= DeepseekService.MAX_RETRIES) {
            this.errorCount = 0;
            if (this.lastError.message.includes('401')) {
                vscode.window.showErrorMessage(
                    'Deepseek API key is invalid or expired',
                    'Update API Key'
                ).then(selection => {
                    if (selection === 'Update API Key') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'smile-ai.deepseek.apiKey');
                    }
                });
            } else {
                vscode.window.showErrorMessage(
                    `Deepseek service encountered multiple errors. Please check your connection.`,
                    'Retry Connection'
                ).then(selection => {
                    if (selection === 'Retry Connection') {
                        this.initialize().catch(console.error);
                    }
                });
            }
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
        this.disposables.forEach(d => d.dispose());
        this.statusBarItem.dispose();
    }
} 