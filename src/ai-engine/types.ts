export interface AIProvider {
    name: string;
    modelName: string;
    apiEndpoint: string;
}

export interface AIConfig {
    provider: AIProvider;
    maxTokens: number;
    temperature: number;
}

export interface AIRequest {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
}

export interface AIResponse {
    message: string;
    codeChanges?: any;
}

export interface AIContext {
    messages: AIMessage[];
    metadata?: Record<string, any>;
}

export interface AIMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    context?: {
        file?: string;
        selection?: string;
        codebase?: any;
    };
}

export interface AIResult {
    success: boolean;
    message: string;
    data?: any;
}

export interface AIError {
    code: string;
    message: string;
    details?: any;
}

export interface CodeAnalysisResult {
    suggestions: string[];
    issues: CodeIssue[];
    metrics: CodeMetrics;
}

export interface CodeIssue {
    type: 'error' | 'warning' | 'info';
    message: string;
    line?: number;
    column?: number;
    file?: string;
}

export interface CodeMetrics {
    complexity: number;
    maintainability: number;
    testability: number;
    documentation: number;
} 