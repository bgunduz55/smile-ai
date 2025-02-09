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

interface LocalAIConfig {
    endpoint: string;
    model: string;
    temperature: number;
    maxTokens: number;
}

interface LocalAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
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
    gpuUtilization?: number;
}

interface TaskMetadata {
    tokensUsed: number;
    executionTime: number;
    modelName: string;
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

export class LocalAIService implements LLMService {
    private static readonly CONTAINER_NAME = 'smile-ai-localai';
    private static readonly IMAGE_NAME = 'localai/localai:latest';
    private static readonly DEFAULT_PORT = 8080;
    private static readonly MAX_RETRIES = 5;
    private static readonly RETRY_DELAY = 1000;

    private config: LocalAIConfig;
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
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.config = this.loadConfig();
        this.endpoint = this.config.endpoint;
        this.currentModel = this.config.model;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.dockerService = DockerService.getInstance();
        this.updateStatusBar();
        this.registerEventHandlers();
    }

    private loadConfig(): LocalAIConfig {
        const config = vscode.workspace.getConfiguration('smile-ai.localai');
        return {
            endpoint: config.get<string>('endpoint') || 'http://localhost:8080',
            model: config.get<string>('model') || 'gpt-3.5-turbo',
            temperature: config.get<number>('temperature') || 0.7,
            maxTokens: config.get<number>('maxTokens') || 2048
        };
    }

    private updateStatusBar(): void {
        if (!this.isInitialized) {
            this.statusBarItem.text = "$(sync~spin) LocalAI";
            this.statusBarItem.tooltip = "LocalAI is starting...";
        } else if (this.lastError) {
            this.statusBarItem.text = "$(error) LocalAI";
            this.statusBarItem.tooltip = `Error: ${this.lastError.message}`;
        } else {
            this.statusBarItem.text = "$(check) LocalAI";
            this.statusBarItem.tooltip = `Model: ${this.currentModel}\nTPS: ${this.performanceMetrics.tokensPerSecond.toFixed(2)}\nCPU: ${this.performanceMetrics.cpuUsage?.toFixed(1)}%${this.performanceMetrics.gpuUtilization ? `\nGPU: ${this.performanceMetrics.gpuUtilization}` : ''}`;
        }
        this.statusBarItem.show();
    }

    private registerEventHandlers(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(async e => {
                if (e.affectsConfiguration('smile-ai.localai')) {
                    await this.handleConfigurationChange();
                }
            })
        );
    }

    private async handleConfigurationChange(): Promise<void> {
        const config = vscode.workspace.getConfiguration('smile-ai.localai');
        const newEndpoint = config.get<string>('endpoint') || 'http://localhost:8080';
        const newModel = config.get<string>('model') || 'gpt-3.5-turbo';

        if (this.endpoint !== newEndpoint || this.currentModel !== newModel) {
            this.endpoint = newEndpoint;
            this.currentModel = newModel;
            await this.initialize();
        }
    }

    public async initialize(): Promise<void> {
        try {
            const response = await fetch(this.endpoint + '/health');
            if (!response.ok) {
                throw new Error('LocalAI service is not available');
            }
            this.isInitialized = true;
            this.updateStatusBar();
        } catch (error) {
            this.lastError = error instanceof Error ? error : new Error('Unknown error');
            this.updateStatusBar();
            throw error;
        }
    }

    private async ensureDockerContainer(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('smile-ai.localai');
            const modelsPath = config.get<string>('modelsPath') || path.join(process.env.HOME || process.env.USERPROFILE || '', '.smile-ai', 'models');
            const port = parseInt(this.endpoint.match(/:(\d+)/)?.[1] || LocalAIService.DEFAULT_PORT.toString(), 10);

            // Container'ı başlat
            await this.dockerService.startContainer(
                LocalAIService.CONTAINER_NAME,
                LocalAIService.IMAGE_NAME,
                [`${port}:${port}`],
                [`${modelsPath}:/models`],
                {
                    'CUDA_VISIBLE_DEVICES': config.get<boolean>('gpuEnabled', false) ? '0' : '',
                    'DEBUG': config.get<boolean>('debug', false) ? '1' : '0',
                    'PORT': port.toString(),
                    'MODELS_PATH': '/models'
                }
            );
        } catch (error) {
            throw new Error(`Failed to start LocalAI container: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private shouldRestartContainer(current: any, desired: any): boolean {
        return (
            current.ports !== desired.ports ||
            current.volumes !== desired.volumes ||
            JSON.stringify(current.env) !== JSON.stringify(desired.env)
        );
    }

    private async waitForService(retries: number = LocalAIService.MAX_RETRIES): Promise<void> {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await axios.get(`${this.endpoint}/health`);
                if (response.status === 200) {
                    return;
                }
            } catch (error) {
                if (i === retries - 1) {
                    throw new Error('LocalAI service could not be started');
                }
                await new Promise(resolve => setTimeout(resolve, LocalAIService.RETRY_DELAY));
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
                throw new Error('Invalid response format from LocalAI service');
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

    private startStatsMonitoring(): void {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }

        this.statsInterval = setInterval(async () => {
            try {
                const stats = await this.dockerService.getContainerStats(LocalAIService.CONTAINER_NAME);
                if (stats) {
                    this.performanceMetrics.cpuUsage = stats.cpuUsage;
                    const memoryBytes = this.parseMemoryToBytes(stats.memoryUsage);
                    this.performanceMetrics.memoryUsage = {
                        total: memoryBytes,
                        used: memoryBytes
                    };
                    this.updateStatusBar();
                }
            } catch (error) {
                console.warn('Performance metrics could not be retrieved:', error);
            }
        }, 5000);
    }

    private parseMemoryToBytes(memory: number): number {
        return Math.floor(memory * 1024 * 1024); // Convert MB to bytes
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        if (!this.isInitialized) {
            throw new Error('LocalAI service is not initialized');
        }

        const startTime = Date.now();

        try {
            const response = await fetch(this.endpoint + '/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.currentModel,
                    messages: [
                        { role: 'system', content: 'You are a helpful AI assistant.' },
                        { role: 'user', content: task.input }
                    ],
                    temperature: this.config.temperature,
                    max_tokens: this.config.maxTokens
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.statusText}`);
            }

            const result = await response.json();
            const data = this.validateResponse(result);

            const stats: LocalAIStats = {
                promptTokens: data.usage?.prompt_tokens || 0,
                completionTokens: data.usage?.completion_tokens || 0,
                totalTokens: data.usage?.total_tokens || 0,
                duration: Date.now() - startTime
            };

            this.updatePerformanceMetrics(stats);

            const metadata: TaskMetadata = {
                tokensUsed: stats.totalTokens,
                executionTime: stats.duration,
                modelName: this.currentModel
            };

            if (this.performanceMetrics.memoryUsage) {
                metadata.memoryUsage = {
                    heapUsed: this.performanceMetrics.memoryUsage.used,
                    heapTotal: this.performanceMetrics.memoryUsage.total,
                    external: 0
                };
            }
            if (this.performanceMetrics.cpuUsage !== undefined) {
                metadata.gpuUsage = {
                    memoryUsed: 0,
                    utilization: this.performanceMetrics.cpuUsage
                };
            }

            return {
                success: true,
                output: data.choices[0].message.content,
                finishReason: data.choices[0].finish_reason,
                metadata
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

    private validateResponse(response: unknown): {
        choices: Array<{
            message: { content: string };
            finish_reason: string;
        }>;
        usage: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
    } {
        if (
            typeof response === 'object' && 
            response !== null &&
            'choices' in response &&
            Array.isArray((response as any).choices) &&
            (response as any).choices.length > 0 &&
            typeof (response as any).choices[0].message?.content === 'string' &&
            typeof (response as any).choices[0].finish_reason === 'string'
        ) {
            return response as any;
        }
        throw new Error('Invalid response format from the model');
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
        this.lastError = error instanceof Error ? error : new Error('Unknown error');
        this.updateStatusBar();

        if (this.errorCount >= LocalAIService.MAX_RETRIES) {
            this.errorCount = 0;
            vscode.window.showErrorMessage(
                `LocalAI service encountered multiple errors. Attempting to restart...`,
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
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

    public getModels(): LocalAIModel[] {
        return [...this.models];
    }

    public async setModel(modelId: string): Promise<void> {
        const model = this.models.find(m => m.id === modelId);
        if (!model) {
            throw new Error(`Model not found: ${modelId}`);
        }
        
        this.currentModel = modelId;
        model.lastUsed = new Date();
        
        await vscode.workspace.getConfiguration('smile-ai.localai')
            .update('model', modelId, true);
        
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
        this.disposables.forEach(d => d.dispose());
        this.statusBarItem.dispose();
        this.dockerService.stopContainer(LocalAIService.CONTAINER_NAME).catch(console.error);
    }
} 