import * as vscode from 'vscode';
import { OpenAIService } from './llm/openaiService';
import { AnthropicService } from './llm/anthropicService';
import { OllamaService } from './llm/ollamaService';
import { LMStudioService } from './llm/lmStudioService';
import { LocalAIService } from './llm/localAIService';
import { DeepseekService } from './llm/deepseekService';
import { QwenService } from './llm/qwenService';
import { LLMService } from './llm/llmService';
import { AgentTask, TaskResult } from './llm/types';
import { SettingsService } from './settingsService';
import { RateLimiterService } from './rateLimiterService';
import { ErrorHandlingService } from './errorHandlingService';

export class AIService implements vscode.Disposable {
    private static instance: AIService;
    private openai: OpenAIService | null = null;
    private anthropic: AnthropicService | null = null;
    private ollama: OllamaService | null = null;
    private lmstudio: LMStudioService | null = null;
    private localai: LocalAIService | null = null;
    private deepseek: DeepseekService | null = null;
    private qwen: QwenService | null = null;
    private currentProvider: string = 'openai';
    private currentModel: string = '';
    private settingsService: SettingsService;
    private disposables: vscode.Disposable[] = [];

    private constructor() {
        this.settingsService = SettingsService.getInstance();
        const rateLimiter = RateLimiterService.getInstance(this.settingsService);
        const errorHandler = ErrorHandlingService.getInstance(this.settingsService);

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('smile-ai')) {
                    this.updateProvider();
                }
            })
        );
        this.updateProvider();
    }

    public static getInstance(): AIService {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }

    private async updateProvider(): Promise<void> {
        const settings = this.settingsService.getSettings();
        this.currentProvider = settings.modelProvider || 'openai';
        const providerSettings = settings.providers[this.currentProvider] || {};
        this.currentModel = providerSettings.model || '';
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
            case 'lmstudio':
                await this.initializeLMStudio();
                break;
            case 'localai':
                await this.initializeLocalAI();
                break;
            case 'deepseek':
                await this.initializeDeepseek();
                break;
            case 'qwen':
                await this.initializeQwen();
                break;
            default:
                throw new Error(`Unsupported provider: ${this.currentProvider}`);
        }
    }

    private async initializeOpenAI(): Promise<void> {
        if (!this.openai) {
            this.openai = new OpenAIService(
                this.settingsService.getSettings()
            );
        }
        if (this.currentModel) {
            await this.openai.setModel(this.currentModel);
        }
    }

    private async initializeAnthropic(): Promise<void> {
        if (!this.anthropic) {
            this.anthropic = new AnthropicService(
                this.settingsService,
                RateLimiterService.getInstance(this.settingsService),
                ErrorHandlingService.getInstance(this.settingsService)
            );
        }
        if (this.currentModel) {
            await this.anthropic.setModel(this.currentModel);
        }
    }

    private async initializeOllama(): Promise<void> {
        if (!this.ollama) {
            this.ollama = new OllamaService(
                this.settingsService,
                RateLimiterService.getInstance(this.settingsService),
                ErrorHandlingService.getInstance(this.settingsService)
            );
        }
        if (this.currentModel) {
            await this.ollama.setModel(this.currentModel);
        }
    }

    private async initializeLMStudio(): Promise<void> {
        if (!this.lmstudio) {
            this.lmstudio = new LMStudioService(
                this.settingsService,
                RateLimiterService.getInstance(this.settingsService),
                ErrorHandlingService.getInstance(this.settingsService)
            );
        }
        if (this.currentModel) {
            await this.lmstudio.setModel(this.currentModel);
        }
    }

    private async initializeLocalAI(): Promise<void> {
        if (!this.localai) {
            this.localai = new LocalAIService(
                this.settingsService,
                RateLimiterService.getInstance(this.settingsService),
                ErrorHandlingService.getInstance(this.settingsService)
            );
        }
        if (this.currentModel) {
            await this.localai.setModel(this.currentModel);
        }
    }

    private async initializeDeepseek(): Promise<void> {
        if (!this.deepseek) {
            this.deepseek = new DeepseekService(
                this.settingsService,
                RateLimiterService.getInstance(this.settingsService),
                ErrorHandlingService.getInstance(this.settingsService)
            );
        }
        if (this.currentModel) {
            await this.deepseek.setModel(this.currentModel);
        }
    }

    private async initializeQwen(): Promise<void> {
        if (!this.qwen) {
            this.qwen = new QwenService(
                this.settingsService,
                RateLimiterService.getInstance(this.settingsService),
                ErrorHandlingService.getInstance(this.settingsService)
            );
        }
        if (this.currentModel) {
            await this.qwen.setModel(this.currentModel);
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
            case 'lmstudio':
                service = this.lmstudio;
                break;
            case 'localai':
                service = this.localai;
                break;
            case 'deepseek':
                service = this.deepseek;
                break;
            case 'qwen':
                service = this.qwen;
                break;
        }

        if (!service) {
            throw new Error('No AI service initialized');
        }

        const response = await service.processTask(task.input);
        return {
            success: true,
            output: response
        };
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
        if (this.lmstudio) {
            this.lmstudio.dispose();
            this.lmstudio = null;
        }
        if (this.localai) {
            this.localai.dispose();
            this.localai = null;
        }
        if (this.deepseek) {
            this.deepseek.dispose();
            this.deepseek = null;
        }
        if (this.qwen) {
            this.qwen.dispose();
            this.qwen = null;
        }
    }
}

export const aiService = AIService.getInstance(); 