import { CodebaseIndex } from './CodebaseIndex';

export class CodebaseIndexer extends CodebaseIndex {
    private static indexerInstance: CodebaseIndexer;

    private constructor() {
        super();
    }

    public static override getInstance(): CodebaseIndexer {
        if (!CodebaseIndexer.indexerInstance) {
            CodebaseIndexer.indexerInstance = new CodebaseIndexer();
        }
        return CodebaseIndexer.indexerInstance;
    }
} 