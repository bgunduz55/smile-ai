import * as vscode from 'vscode';
import { LlamaModel, LlamaContext, LlamaChatSession, LlamaModelOptions, LLamaChatPromptOptions } from 'node-llama-cpp';
import { ModelConfig, AgentTask, TaskResult, TaskType, AgentCapability } from './types';
import { promptTemplates } from './promptTemplates';
import path from 'path';
import fs from 'fs';
import { LLMService } from './llmService';

interface ModelMetadata {
    name: string;
    format: 'gguf' | 'ggml';
    size: number;
    parameters: number;
    lastUsed: Date;
    performance: {
        averageResponseTime: number;
        tokensPerSecond: number;
        totalTokensGenerated: number;
    };
}

export class LlamaService implements LLMService {
    private model: LlamaModel | null = null;
    private context: LlamaContext | null = null;
    private chatSession: LlamaChatSession | null = null;
    private capabilities: Map<TaskType, AgentCapability>;
    private disposables: vscode.Disposable[] = [];
    private modelMetadata: ModelMetadata | null = null;
    private readonly config: ModelConfig;
    private isInitialized: boolean = false;
    private lastError?: Error;
    private statusBarItem: vscode.StatusBarItem;

    constructor(config: ModelConfig) {
        this.config = config;
        this.capabilities = this.initializeCapabilities();
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        if (!this.isInitialized) {
            this.statusBarItem.text = "$(sync~spin) Llama";
            this.statusBarItem.tooltip = "Llama is starting...";
        } else if (this.lastError) {
            this.statusBarItem.text = "$(error) Llama";
            this.statusBarItem.tooltip = `Error: ${this.lastError.message}`;
        } else {
            this.statusBarItem.text = "$(check) Llama";
            this.statusBarItem.tooltip = `Model: ${this.modelMetadata?.name || 'Unknown'}\nTPS: ${this.modelMetadata?.performance.tokensPerSecond.toFixed(2) || 0}`;
        }
        this.statusBarItem.show();
    }

    private initializeCapabilities(): Map<TaskType, AgentCapability> {
        const capabilities = new Map<TaskType, AgentCapability>();
        
        Object.entries(promptTemplates).forEach(([taskType, template]) => {
            capabilities.set(taskType as TaskType, {
                taskType: taskType as TaskType,
                supportedLanguages: template.supportedLanguages,
                requiresContext: template.requiresContext,
                maxInputLength: template.maxInputLength,
                description: this.getTaskDescription(taskType as TaskType)
            });
        });

        return capabilities;
    }

    private getTaskDescription(taskType: TaskType): string {
        const descriptions: Record<TaskType, string> = {
            text_generation: 'Text generation and chat responses',
            code_completion: 'Code completion suggestions',
            code_analysis: 'Code quality, potential errors, and improvements',
            code_generation: 'Generate code based on the specified requirements',
            documentation: 'Create documentation for the code',
            test_generation: 'Create unit tests and test scenarios',
            refactoring: 'Refactor the code to follow better practices',
            bug_fix: 'Detect errors and provide fixes'
        };

        return descriptions[taskType];
    }

    public async initialize(): Promise<void> {
        try {
            await this.validateConfig();
            await this.loadModel();
            this.registerEventHandlers();
            await this.updateModelMetadata();
            this.isInitialized = true;
            this.updateStatusBar();
        } catch (error) {
            this.lastError = error instanceof Error ? error : new Error('Unknown error');
            this.updateStatusBar();
            console.error('Llama model initialization failed:', error);
            throw error;
        }
    }

    private async validateConfig(): Promise<void> {
        if (!this.config.modelPath) {
            throw new Error('Model path is not configured');
        }

        if (!fs.existsSync(this.config.modelPath)) {
            throw new Error(`Model file not found at: ${this.config.modelPath}`);
        }

        const fileStats = fs.statSync(this.config.modelPath);
        if (fileStats.size < 1024 * 1024) { // 1MB'dan küçük
            throw new Error('Invalid model file: File size is too small');
        }
    }

    private async loadModel(): Promise<void> {
        try {
            const modelOptions = {
                path: this.config.modelPath,
                enableLogging: false,
                nCtx: this.config.contextSize || 4096,
                nGpuLayers: await this.detectGPUSupport(),
                batchSize: this.calculateOptimalBatchSize(),
                nThreads: this.getOptimalThreadCount(),
                useMlock: true,
                useMemorymap: true
            };

            this.model = new LlamaModel(modelOptions);
            this.context = new LlamaContext(this.model);
            this.chatSession = new LlamaChatSession(this.context);
        } catch (error) {
            throw new Error(`Failed to load model: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async detectGPUSupport(): Promise<number> {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const gpuEnabled = config.get<boolean>('gpu.enabled') ?? true;
        
        if (!gpuEnabled) {
            return 0;
        }

        try {
            const gpuLayers = config.get<number>('gpu.layers') ?? 32;
            const gpuDevice = config.get<string>('gpu.device') ?? 'cuda';
            
            // GPU desteğini kontrol et
            if (process.platform === 'win32' && gpuDevice === 'cuda') {
                const nvidiaSmiPath = 'C:\\Windows\\System32\\nvidia-smi.exe';
                if (fs.existsSync(nvidiaSmiPath)) {
                    return gpuLayers;
                }
            } else if (process.platform === 'darwin' && gpuDevice === 'metal') {
                return gpuLayers;
            }
        } catch (error) {
            console.warn('GPU detection failed:', error);
        }

        return 0;
    }

    private calculateOptimalBatchSize(): number {
        // Sistem belleğine göre optimal batch size hesapla
        const systemMemory = this.getSystemMemory();
        return Math.min(512, Math.floor(systemMemory / 4));
    }

    private getSystemMemory(): number {
        // Node.js os modülü ile sistem belleğini al (GB cinsinden)
        const os = require('os');
        return Math.floor(os.totalmem() / (1024 * 1024 * 1024));
    }

    private getOptimalThreadCount(): number {
        // CPU çekirdek sayısının yarısını kullan
        const os = require('os');
        return Math.max(1, Math.floor(os.cpus().length / 2));
    }

    private async updateModelMetadata(): Promise<void> {
        if (!this.model) return;

        const modelInfo = {
            parameterCount: 7000000000, // Yaklaşık değer
            contextLength: this.config.contextSize
        };

        this.modelMetadata = {
            name: path.basename(this.config.modelPath),
            format: this.config.modelPath.endsWith('.gguf') ? 'gguf' : 'ggml',
            size: fs.statSync(this.config.modelPath).size,
            parameters: modelInfo.parameterCount,
            lastUsed: new Date(),
            performance: {
                averageResponseTime: 0,
                tokensPerSecond: 0,
                totalTokensGenerated: 0
            }
        };
    }

    private registerEventHandlers(): void {
        this.disposables.push(
            vscode.commands.registerCommand('smile-ai.executeTask', async (task: AgentTask) => {
                return await this.processTask(task);
            }),
            vscode.workspace.onDidChangeConfiguration(async e => {
                if (e.affectsConfiguration('smile-ai')) {
                    await this.handleConfigurationChange();
                }
            })
        );
    }

    private async handleConfigurationChange(): Promise<void> {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const newConfig: ModelConfig = {
            modelPath: config.get('modelPath') || this.config.modelPath,
            contextSize: config.get('contextSize') || this.config.contextSize,
            temperature: config.get('temperature') || this.config.temperature,
            topP: config.get('topP') || this.config.topP,
            maxTokens: config.get('maxTokens') || this.config.maxTokens,
            stopTokens: config.get('stopTokens') || this.config.stopTokens
        };

        if (this.shouldReloadModel(newConfig)) {
            await this.reloadModel();
        }
    }

    private shouldReloadModel(newConfig: ModelConfig): boolean {
        return (
            newConfig.modelPath !== this.config.modelPath ||
            newConfig.contextSize !== this.config.contextSize
        );
    }

    private async reloadModel(): Promise<void> {
        await this.dispose();
        await this.loadModel();
        await this.updateModelMetadata();
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        if (!this.isInitialized) {
            throw new Error('LlamaService is not initialized');
        }

        const startTime = Date.now();
        
        try {
            const capability = this.capabilities.get(task.type);
            if (!capability) {
                throw new Error(`Unsupported task type: ${task.type}`);
            }

            if (capability.requiresContext && !task.context) {
                throw new Error(`Task ${task.type} requires context`);
            }

            const prompt = this.buildPrompt(task);
            const response = await this.generateResponse(prompt);
            const endTime = Date.now();
            
            // Performans metriklerini güncelle
            if (this.modelMetadata) {
                const executionTime = endTime - startTime;
                const tokensGenerated = response.length / 4; // Yaklaşık token sayısı
                
                this.modelMetadata.performance.totalTokensGenerated += tokensGenerated;
                this.modelMetadata.performance.averageResponseTime = 
                    (this.modelMetadata.performance.averageResponseTime + executionTime) / 2;
                this.modelMetadata.performance.tokensPerSecond = 
                    tokensGenerated / (executionTime / 1000);
                this.modelMetadata.lastUsed = new Date();
                this.updateStatusBar();
            }

            return {
                success: true,
                output: response,
                metadata: {
                    tokensUsed: response.length / 4,
                    executionTime: endTime - startTime,
                    modelName: this.modelMetadata?.name || 'llama2'
                }
            };
        } catch (error) {
            this.lastError = error instanceof Error ? error : new Error('Unknown error');
            this.updateStatusBar();
            
            return {
                success: false,
                output: '',
                error: this.lastError.message,
                metadata: {
                    tokensUsed: 0,
                    executionTime: Date.now() - startTime,
                    modelName: this.modelMetadata?.name || 'llama2'
                }
            };
        }
    }

    private buildPrompt(task: AgentTask): string {
        const template = promptTemplates[task.type];
        let prompt = template.template;

        if (task.context) {
            prompt = prompt.replace('{{context}}', task.context);
        }

        prompt = prompt.replace('{{input}}', task.input);
        prompt = prompt.replace('{{constraints}}', 
            task.constraints ? JSON.stringify(task.constraints, null, 2) : 'No specific constraints');

        return prompt;
    }

    private async generateResponse(prompt: string): Promise<string> {
        if (!this.chatSession) {
            throw new Error('Model not initialized');
        }

        try {
            const options: LLamaChatPromptOptions = {
                temperature: this.config.temperature || 0.7,
                topP: this.config.topP || 0.9,
                maxTokens: this.config.maxTokens || 2048
            };

            return await this.chatSession.prompt(prompt, options);
        } catch (error) {
            throw new Error(`Failed to generate response: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public getCapabilities(): AgentCapability[] {
        return Array.from(this.capabilities.values());
    }

    public getModelMetadata(): ModelMetadata | null {
        return this.modelMetadata;
    }

    public async dispose(): Promise<void> {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.statusBarItem.dispose();
        
        if (this.chatSession) {
            this.chatSession = null;
        }
        if (this.context) {
            this.context = null;
        }
        if (this.model) {
            this.model = null;
        }
        
        this.isInitialized = false;
    }
} 