import * as vscode from 'vscode';
import { LlamaModel, LlamaContext, LlamaChatSession } from 'node-llama-cpp';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { indexService } from './indexService';

type AIProvider = 'local' | 'openai' | 'anthropic' | 'ollama';

export class AIService {
    private static instance: AIService;
    private provider: AIProvider = 'local';
    private localModel: LlamaModel | null = null;
    private localContext: LlamaContext | null = null;
    private localChatSession: LlamaChatSession | null = null;
    private openai: OpenAI | null = null;
    private anthropic: Anthropic | null = null;
    private apiKey: string = '';

    private constructor() {
        this.initializeProvider();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('smile-ai')) {
                this.initializeProvider();
            }
        });
    }

    public static getInstance(): AIService {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }

    private async initializeProvider() {
        try {
            const config = vscode.workspace.getConfiguration('smile-ai');
            this.provider = config.get<AIProvider>('provider') || 'local';

            // Mevcut kaynakları temizle
            this.dispose();

            switch (this.provider) {
                case 'local':
                    await this.initializeLocalModel();
                    break;
                case 'openai':
                    await this.initializeOpenAI();
                    break;
                case 'anthropic':
                    await this.initializeAnthropic();
                    break;
                case 'ollama':
                    // Ollama için özel bir başlatma gerekmez
                    break;
            }

            vscode.window.showInformationMessage(`Smile AI: ${this.provider} sağlayıcısı başarıyla yapılandırıldı`);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            vscode.window.showErrorMessage(`Smile AI: Sağlayıcı yapılandırılırken hata oluştu: ${errorMessage}`);
        }
    }

    private async initializeLocalModel() {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const localConfig = config.get<any>('localModel');

        if (!localConfig?.path) {
            throw new Error('Yerel model yolu yapılandırılmamış');
        }

        this.localModel = new LlamaModel({
            modelPath: localConfig.path,
            contextSize: localConfig.contextSize || 2048,
            gpuLayers: localConfig.gpuLayers || 0
        });

        this.localContext = new LlamaContext({ model: this.localModel });
        this.localChatSession = new LlamaChatSession({ context: this.localContext });
    }

    private async initializeOpenAI() {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const openaiConfig = config.get<any>('openai');

        if (!openaiConfig?.apiKey) {
            throw new Error('OpenAI API anahtarı yapılandırılmamış');
        }

        this.openai = new OpenAI({
            apiKey: openaiConfig.apiKey
        });
    }

    private async initializeAnthropic() {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const anthropicConfig = config.get<any>('anthropic');

        if (!anthropicConfig?.apiKey) {
            throw new Error('Anthropic API anahtarı yapılandırılmamış');
        }

        this.anthropic = new Anthropic({
            apiKey: anthropicConfig.apiKey
        });
    }

    public setProvider(provider: AIProvider): void {
        this.provider = provider;
    }

    public setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
    }

    public async generateResponse(prompt: string): Promise<string> {
        if (this.provider === 'openai' && !this.apiKey) {
            throw new Error('OpenAI API key is required');
        }

        try {
            // İlgili dosyaları bul
            const relevantFiles = await indexService.getRelevantFiles(prompt);
            const context = relevantFiles.map(file => 
                `File: ${file.filePath}\nLanguage: ${file.language}\nContent:\n${file.content}\n---\n`
            ).join('\n');

            const fullPrompt = context ? 
                `Context from workspace:\n${context}\n\nUser Query: ${prompt}` : 
                prompt;

            switch (this.provider) {
                case 'local':
                    return await this.generateLocalResponse(fullPrompt);
                case 'openai':
                    return await this.generateOpenAIResponse(fullPrompt);
                case 'anthropic':
                    return await this.generateAnthropicResponse(fullPrompt);
                case 'ollama':
                    return await this.generateOllamaResponse(fullPrompt);
                default:
                    throw new Error('Geçersiz AI sağlayıcısı');
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            throw new Error(`Yanıt üretilirken hata oluştu: ${errorMessage}`);
        }
    }

    private async generateLocalResponse(prompt: string): Promise<string> {
        if (!this.localChatSession) {
            throw new Error('Yerel model başlatılmamış');
        }
        return await this.localChatSession.prompt(prompt);
    }

    private async generateOpenAIResponse(prompt: string): Promise<string> {
        if (!this.openai) {
            throw new Error('OpenAI yapılandırılmamış');
        }

        const config = vscode.workspace.getConfiguration('smile-ai');
        const openaiConfig = config.get<any>('openai');

        const response = await this.openai.chat.completions.create({
            model: openaiConfig?.model || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }]
        });

        return response.choices[0]?.message?.content || '';
    }

    private async generateAnthropicResponse(prompt: string): Promise<string> {
        if (!this.anthropic) {
            throw new Error('Anthropic yapılandırılmamış');
        }

        const config = vscode.workspace.getConfiguration('smile-ai');
        const anthropicConfig = config.get<any>('anthropic');

        const response = await this.anthropic.messages.create({
            model: anthropicConfig?.model || 'claude-3-sonnet',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }]
        });

        if (response.content[0]?.type === 'text') {
            return response.content[0].text;
        }
        return '';
    }

    private async generateOllamaResponse(prompt: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const ollamaConfig = config.get<any>('ollama');

        const response = await axios.post(`${ollamaConfig?.endpoint || 'http://localhost:11434'}/api/generate`, {
            model: ollamaConfig?.model || 'llama2',
            prompt: prompt
        });

        return response.data.response;
    }

    public async generateCode(prompt: string, context?: string): Promise<string> {
        try {
            const fullPrompt = context ? `${prompt}\n\nContext:\n${context}` : prompt;
            const response = await this.generateResponse(fullPrompt);
            return this.extractCodeFromResponse(response);
        } catch (error) {
            console.error('Error generating code:', error);
            return '';
        }
    }

    private extractCodeFromResponse(response: string): string {
        // Yanıttan kod önerilerini ayıkla
        const lines = response.split('\n');
        return lines
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('Here are'))
            .join('\n');
    }

    public dispose() {
        if (this.localChatSession) {
            this.localChatSession = null;
        }
        if (this.localContext) {
            this.localContext = null;
        }
        if (this.localModel) {
            this.localModel = null;
        }
        this.openai = null;
        this.anthropic = null;
    }
}

export const aiService = AIService.getInstance(); 