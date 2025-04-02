import { CodebaseIndex } from './CodebaseIndex';
import { AIEngine } from '../ai-engine/AIEngine';

export class CodebaseIndexer extends CodebaseIndex {
    private static indexerInstance: CodebaseIndexer;
    protected aiEngine?: AIEngine;

    private constructor() {
        super();
    }

    public static override getInstance(): CodebaseIndexer {
        if (!CodebaseIndexer.indexerInstance) {
            CodebaseIndexer.indexerInstance = new CodebaseIndexer();
        }
        return CodebaseIndexer.indexerInstance;
    }

    public setAIEngine(aiEngine: AIEngine): void {
        this.aiEngine = aiEngine;
    }
}