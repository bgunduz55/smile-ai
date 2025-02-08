import * as vscode from 'vscode';
import { OpenAIService } from './llm/openaiService';
import { AnthropicService } from './llm/anthropicService';
import { OllamaService } from './llm/ollamaService';
import { LLMService } from './llm/llmService';
import { AgentTask, TaskResult } from './llm/types';

export class AIService implements vscode.Disposable {
    private openai: OpenAIService | null = null;
    private anthropic: AnthropicService | null = null;
    private ollama: OllamaService | null = null;
    private currentProvider: string = 'openai';
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('smile-ai.provider')) {
                    this.updateProvider();
                }
            })
        );
    }

    private async updateProvider(): Promise<void> {
        const config = vscode.workspace.getConfiguration('smile-ai');
        this.currentProvider = config.get('provider') || 'openai';
        await this.initializeProvider();
    }

    private async initializeProvider(): Promise<void> {
        switch (this.currentProvider) {
            case 'openai':
                await this.initializeOpenAI();
                break;
            case 'anthropic':
                await this.initializeAnthropic();
                break;
            case 'ollama':
                await this.initializeOllama();
                break;
            default:
                throw new Error(`Unsupported provider: ${this.currentProvider}`);
        }
    }

    private async initializeOpenAI(): Promise<void> {
        if (!this.openai) {
            this.openai = new OpenAIService();
        }
    }

    private async initializeAnthropic(): Promise<void> {
        if (!this.anthropic) {
            this.anthropic = new AnthropicService();
        }
    }

    private async initializeOllama(): Promise<void> {
        if (!this.ollama) {
            this.ollama = new OllamaService();
            await this.ollama.initialize();
        }
    }

    public async generateResponse(prompt: string): Promise<string> {
        const task = {
            type: 'text_generation' as const,
            input: prompt
        };

        const result = await this.processTask(task);
        if (!result.success) {
            throw new Error(result.error || 'Failed to generate response');
        }

        return result.output;
    }

    public async generateCode(prompt: string, context?: string): Promise<string> {
        const task = {
            type: 'code_generation' as const,
            input: context ? `${prompt}\n\nContext:\n${context}` : prompt
        };

        const result = await this.processTask(task);
        if (!result.success) {
            throw new Error(result.error || 'Failed to generate code');
        }

        return this.extractCodeFromResponse(result.output);
    }

    private extractCodeFromResponse(response: string): string {
        const lines = response.split('\n');
        return lines
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('Here are'))
            .join('\n');
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        let service: LLMService | null = null;

        switch (this.currentProvider) {
            case 'openai':
                service = this.openai;
                break;
            case 'anthropic':
                service = this.anthropic;
                break;
            case 'ollama':
                service = this.ollama;
                break;
        }

        if (!service) {
            throw new Error('No AI service initialized');
        }

        return await service.processTask(task);
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];

        if (this.openai) {
            this.openai.dispose();
            this.openai = null;
        }
        if (this.anthropic) {
            this.anthropic.dispose();
            this.anthropic = null;
        }
        if (this.ollama) {
            this.ollama.dispose();
            this.ollama = null;
        }
    }
}

export const aiService = new AIService(); 