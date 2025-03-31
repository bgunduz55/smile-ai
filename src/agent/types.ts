import { AIResponse } from '../ai-engine/types';
import { FileContext } from '../utils/FileAnalyzer';
import { CodeAnalysis } from '../utils/CodeAnalyzer';

export interface TaskMetadata {
    fileContext: FileContext;
    codeAnalysis: CodeAnalysis;
    taskAnalysis?: any;
    subtaskAnalysis?: any;
    [key: string]: any;
}

export interface Task {
    id: string;
    type: TaskType;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    subtasks?: Task[];
    metadata?: TaskMetadata;
    result?: TaskResult;
    parent?: string;
    created: number;
    updated: number;
}

export enum TaskType {
    CODE_ANALYSIS = 'CODE_ANALYSIS',
    CODE_GENERATION = 'CODE_GENERATION',
    CODE_MODIFICATION = 'CODE_MODIFICATION',
    TEST_GENERATION = 'TEST_GENERATION',
    DOCUMENTATION = 'DOCUMENTATION',
    REFACTORING = 'REFACTORING',
    EXPLANATION = 'EXPLANATION'
}

export enum TaskStatus {
    PENDING = 'PENDING',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED'
}

export enum TaskPriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL'
}

export interface TaskResult {
    success: boolean;
    data?: any;
    error?: string;
    aiResponse?: AIResponse;
}

export interface AgentContext {
    currentTask?: Task;
    taskQueue: Task[];
    taskHistory: Task[];
    metadata: Record<string, any>;
}

export interface TaskExecutor {
    execute(task: Task): Promise<TaskResult>;
    canHandle(task: Task): boolean;
}

export interface TaskPlanner {
    planTask(description: string): Promise<Task>;
    breakdownTask(task: Task): Promise<Task[]>;
}

export interface TaskManager {
    addTask(task: Task): void;
    updateTask(taskId: string, updates: Partial<Task>): void;
    getTask(taskId: string): Task | undefined;
    getTasks(status?: TaskStatus): Task[];
    cancelTask(taskId: string): void;
}

// --- Future Improvement Notes --- 

export enum ImprovementNoteStatus {
    PENDING = 'pending',
    DONE = 'done',
    DISMISSED = 'dismissed'
}

export interface ImprovementNoteContext {
    filePath?: string;
    symbolName?: string;
    selection?: {
        startLine: number;
        startChar: number;
        endLine: number;
        endChar: number;
    };
    selectedText?: string;
}

export interface ImprovementNote {
    id: string;
    description: string;
    context?: ImprovementNoteContext;
    status: ImprovementNoteStatus;
    createdAt: number;
} 