import { AgentTask, TaskResult } from './types';

export interface LLMService {
    processTask(task: AgentTask): Promise<TaskResult>;
} 