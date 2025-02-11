import * as vscode from 'vscode';
import OpenAI from 'openai';
import { LLMService } from './llmService';
import { AgentTask, TaskResult } from './types';

export class OpenAIService implements LLMService {
    private client: OpenAI | null = null;
    private currentModel: string = 'gpt-4';
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.initialize();
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('smile-ai.openai')) {
                    this.initialize();
                }
            })
        );
    }

    public async initialize(): Promise<void> {
        const config = vscode.workspace.getConfiguration('smile-ai.openai');
        const apiKey = config.get<string>('apiKey');
        const model = config.get<string>('model');

        if (!apiKey) {
            vscode.window.showErrorMessage('OpenAI API key is not configured');
            return;
        }

        this.client = new OpenAI({
            apiKey: apiKey
        });

        if (model) {
            this.currentModel = model;
        }
    }

    public async setModel(model: string): Promise<void> {
        this.currentModel = model;
        await vscode.workspace.getConfiguration('smile-ai.openai').update('model', model, true);
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        if (!this.client) {
            return {
                success: false,
                error: 'OpenAI client is not initialized',
                output: ''
            };
        }

        try {
            const response = await this.client.chat.completions.create({
                model: this.currentModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful AI assistant specialized in software development.'
                    },
                    {
                        role: 'user',
                        content: task.input
                    }
                ],
                temperature: 0.7,
                max_tokens: 2048
            });

            return {
                success: true,
                output: response.choices[0]?.message?.content || ''
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
                output: ''
            };
        }
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.client = null;
    }
} 