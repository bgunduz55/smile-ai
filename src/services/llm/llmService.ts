import { AgentTask, TaskResult } from './types';

export interface LLMService {
    processTask(task: AgentTask): Promise<TaskResult>;
    setModel(model: string): Promise<void>;
    initialize?(): Promise<void>;
    dispose?(): void;
} 