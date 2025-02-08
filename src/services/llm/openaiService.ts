import * as vscode from 'vscode';
import OpenAI from 'openai';
import { LLMService } from './llmService';
import { AgentTask, TaskResult } from './types';

export class OpenAIService implements LLMService {
    private client: OpenAI | null = null;
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

    private initialize(): void {
        const config = vscode.workspace.getConfiguration('smile-ai.openai');
        const apiKey = config.get<string>('apiKey');

        if (!apiKey) {
            vscode.window.showErrorMessage('OpenAI API key is not configured');
            return;
        }

        this.client = new OpenAI({
            apiKey: apiKey
        });
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
                model: 'gpt-4',
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