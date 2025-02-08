import * as vscode from 'vscode';
import { LlamaModel, LlamaContext, LlamaChatSession, LlamaModelOptions } from 'node-llama-cpp';
import { ModelConfig, AgentTask, TaskResult, TaskType, AgentCapability } from './types';
import { promptTemplates } from './promptTemplates';
import path from 'path';
import fs from 'fs';

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

export class LlamaService {
    private model: LlamaModel | null = null;
    private context: LlamaContext | null = null;
    private chatSession: LlamaChatSession | null = null;
    private capabilities: Map<TaskType, AgentCapability>;
    private disposables: vscode.Disposable[] = [];
    private modelMetadata: ModelMetadata | null = null;
    private readonly config: ModelConfig;

    constructor(config: ModelConfig) {
        this.config = config;
        this.capabilities = this.initializeCapabilities();
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
            text_generation: 'Metin üretme ve sohbet yanıtları oluşturur',
            code_completion: 'Kod tamamlama önerileri sunar',
            code_analysis: 'Kod kalitesi, olası hatalar ve iyileştirmeler için analiz yapar',
            code_generation: 'Belirtilen gereksinimlere göre kod üretir',
            documentation: 'Kod için dokümantasyon oluşturur',
            test_generation: 'Birim testleri ve test senaryoları oluşturur',
            refactoring: 'Kodu daha iyi pratiklere uygun şekilde yeniden düzenler',
            bug_fix: 'Hata tespiti ve düzeltme önerileri sunar'
        };

        return descriptions[taskType];
    }

    public async initialize(): Promise<void> {
        try {
            await this.loadModel();
            this.registerEventHandlers();
            await this.updateModelMetadata();
        } catch (error) {
            console.error('Llama model initialization failed:', error);
            throw error;
        }
    }

    private async loadModel(): Promise<void> {
        const modelOptions: LlamaModelOptions = {
            modelPath: this.config.modelPath,
            contextSize: this.config.contextSize,
            gpuLayers: this.detectGPUSupport(),
            batchSize: this.calculateOptimalBatchSize(),
            threads: this.getOptimalThreadCount(),
            useMlock: true
        };

        this.model = new LlamaModel(modelOptions);
        this.context = new LlamaContext({ model: this.model });
        this.chatSession = new LlamaChatSession({ context: this.context });
    }

    private detectGPUSupport(): number {
        // TODO: Implement GPU detection logic
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
                return await this.executeTask(task);
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

    public async executeTask(task: AgentTask): Promise<TaskResult> {
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
            }

            return {
                success: true,
                output: response,
                metadata: {
                    tokensUsed: response.length / 4, // Yaklaşık token sayısı
                    executionTime: endTime - startTime,
                    modelName: this.modelMetadata?.name || 'llama2'
                }
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: error instanceof Error ? error.message : 'Unknown error occurred',
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

        return await this.chatSession.prompt(prompt, {
            temperature: this.config.temperature,
            topP: this.config.topP,
            maxTokens: this.config.maxTokens
        });
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
        if (this.chatSession) {
            this.chatSession = null;
        }
        if (this.context) {
            this.context = null;
        }
        if (this.model) {
            this.model = null;
        }
    }
} 