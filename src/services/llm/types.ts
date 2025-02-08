export type TaskType =
    | 'text_generation'
    | 'code_generation'
    | 'code_completion'
    | 'code_analysis'
    | 'documentation'
    | 'test_generation'
    | 'refactoring'
    | 'bug_fix';

export interface ModelConfig {
    modelPath: string;
    contextSize: number;
    temperature: number;
    topP: number;
    maxTokens: number;
    stopTokens: string[];
    gpuConfig?: {
        enabled: boolean;
        layers?: number;
        device?: string;
    };
    performance?: {
        batchSize?: number;
        threads?: number;
        useMlock?: boolean;
        useMemorymap?: boolean;
    };
    caching?: {
        enabled: boolean;
        maxSize?: number;
        ttl?: number;
    };
}

export interface AgentTask {
    type: TaskType;
    input: string;
    context?: string;
    constraints?: TaskConstraints;
}

export interface TaskConstraints {
    maxLength?: number;
    language?: string;
    style?: string;
    framework?: string;
    timeout?: number;
}

export interface TaskResult {
    success: boolean;
    output: string;
    error?: string;
    metadata?: {
        tokensUsed: number;
        executionTime: number;
        modelName: string;
        memoryUsage?: {
            heapUsed: number;
            heapTotal: number;
            external: number;
        };
        gpuUsage?: {
            memoryUsed: number;
            utilization: number;
        };
    };
}

export interface ModelMetadata {
    name: string;
    format: 'gguf' | 'ggml';
    size: number;
    parameters: number;
    lastUsed: Date;
    performance: {
        averageResponseTime: number;
        tokensPerSecond: number;
        totalTokensGenerated: number;
    };
}

export interface AgentCapability {
    taskType: TaskType;
    supportedLanguages: string[];
    requiresContext: boolean;
    maxInputLength: number;
    description: string;
}

export type PromptTemplates = {
    [K in TaskType]: string;
}; 