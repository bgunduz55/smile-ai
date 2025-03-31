import { Task, TaskType, TaskResult, TaskExecutor, StatusCallbacks } from '../types';
import { AIEngine } from '../../ai-engine/AIEngine';

export class ReviewExecutor implements TaskExecutor {
    constructor(
        private readonly aiEngine: AIEngine,
        private readonly statusCallbacks: StatusCallbacks
    ) {}

    public canHandle(task: Task): boolean {
        return task.type === TaskType.REVIEW;
    }

    public async execute(task: Task): Promise<TaskResult> {
        try {
            this.statusCallbacks.showLoading('Reviewing code...');
            // Implementation to be added
            this.statusCallbacks.showReady('Review complete');
            return { success: true };
        } catch (error) {
            this.statusCallbacks.showError('Failed to review code');
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
} 