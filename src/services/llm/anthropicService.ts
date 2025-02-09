import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { LLMService } from './llmService';
import { AgentTask, TaskResult } from './types';

export class AnthropicService implements LLMService {
    private client: Anthropic | null = null;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.initialize();
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('smile-ai.anthropic')) {
                    this.initialize();
                }
            })
        );
    }

    private initialize(): void {
        const config = vscode.workspace.getConfiguration('smile-ai.anthropic');
        const apiKey = config.get<string>('apiKey');

        if (!apiKey) {
            vscode.window.showErrorMessage('Anthropic API key is not configured');
            return;
        }

        this.client = new Anthropic({
            apiKey: apiKey
        });
    }

    public async processTask(task: AgentTask): Promise<TaskResult> {
        if (!this.client) {
            return {
                success: false,
                error: 'Anthropic client is not initialized',
                output: ''
            };
        }

        try {
            const response = await this.client.messages.create({
                model: 'claude-3-sonnet-20240229',
                max_tokens: 2048,
                messages: [
                    {
                        role: 'user',
                        content: task.input
                    }
                ]
            });

            const content = response.content[0];
            if (content?.type === 'text') {
                return {
                    success: true,
                    output: content.text
                };
            }

            return {
                success: false,
                error: 'Unexpected response format',
                output: ''
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