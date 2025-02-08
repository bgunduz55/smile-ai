import { TaskType } from './types';

interface PromptTemplate {
    requiresContext: boolean;
    maxInputLength: number;
    supportedLanguages: string[];
    template: string;
}

export const promptTemplates: Record<TaskType, PromptTemplate> = {
    text_generation: {
        requiresContext: false,
        maxInputLength: 2048,
        supportedLanguages: ['*'],
        template: 'Generate a response for the following prompt:\n\n{input}'
    },
    code_completion: {
        requiresContext: true,
        maxInputLength: 1024,
        supportedLanguages: ['*'],
        template: 'Complete the following code:\n\nContext:\n{context}\n\nCode to complete:\n{input}'
    },
    code_analysis: {
        requiresContext: true,
        maxInputLength: 4096,
        supportedLanguages: ['*'],
        template: 'Analyze the following code:\n\nContext:\n{context}\n\nCode to analyze:\n{input}'
    },
    code_generation: {
        requiresContext: false,
        maxInputLength: 2048,
        supportedLanguages: ['*'],
        template: 'Generate code based on the following requirements:\n\n{input}'
    },
    documentation: {
        requiresContext: true,
        maxInputLength: 4096,
        supportedLanguages: ['*'],
        template: 'Generate documentation for the following code:\n\nContext:\n{context}\n\nCode to document:\n{input}'
    },
    test_generation: {
        requiresContext: true,
        maxInputLength: 4096,
        supportedLanguages: ['*'],
        template: 'Generate test cases for the following code:\n\nContext:\n{context}\n\nCode to test:\n{input}'
    },
    refactoring: {
        requiresContext: true,
        maxInputLength: 4096,
        supportedLanguages: ['*'],
        template: 'Refactor the following code:\n\nContext:\n{context}\n\nCode to refactor:\n{input}'
    },
    bug_fix: {
        requiresContext: true,
        maxInputLength: 4096,
        supportedLanguages: ['*'],
        template: 'Fix bugs in the following code:\n\nContext:\n{context}\n\nCode with bugs:\n{input}'
    }
}; 