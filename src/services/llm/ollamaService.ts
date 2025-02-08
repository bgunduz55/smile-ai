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
    };
}

export class OllamaService implements LLMService {
    private endpoint: string;
    private currentModel: string;
    private models: OllamaModel[] = [];
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        const config = vscode.workspace.getConfiguration('smile-ai.ollama');
        this.endpoint = config.get('endpoint') || 'http://localhost:11434';
        this.currentModel = config.get('defaultModel') || 'llama2';
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.statusBarItem.text = "$(hubot) Ollama";
        this.statusBarItem.tooltip = "Ollama AI Service";
        this.statusBarItem.show();
    }

    public async initialize(): Promise<void> {
        try {
            await this.loadModels();
            this.statusBarItem.text = "$(check) Ollama";
        } catch (error) {
            this.statusBarItem.text = "$(error) Ollama";
            throw error;
        }
    }

    private async loadModels(): Promise<void> {
        try {
            const response = await axios.get(`${this.endpoint}/api/tags`);
            this.models = response.data.models;
        } catch (error) {
            console.error('Error loading Ollama models:', error);
            throw new Error('Ollama model listesi yüklenemedi. Ollama servisinin çalıştığından emin olun.');
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
        await vscode.workspace.getConfiguration('smile-ai.ollama').update('defaultModel', modelName, true);
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        const startTime = Date.now();

        try {
            const prompt = this.buildPrompt(task);
            const options: OllamaGenerateOptions = {
                model: this.currentModel,
                prompt,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_ctx: 4096,
                    stop: ['</s>', '<s>']
                }
            };

            const response = await axios.post(`${this.endpoint}/api/generate`, options);
            const executionTime = Date.now() - startTime;

            return {
                success: true,
                output: response.data.response,
                metadata: {
                    tokensUsed: response.data.total_duration || 0,
                    executionTime,
                    modelName: this.currentModel
                }
            };
        } catch (error) {
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