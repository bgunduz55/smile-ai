import * as vscode from 'vscode';
import { AIEngine } from './ai-engine/AIEngine';
import { TaskType, TaskExecutor, TaskStatus, TaskPriority } from './agent/types';
import { CodeModificationExecutor } from './agent/executors/CodeModificationExecutor';
import { TestGenerationExecutor } from './agent/executors/TestGenerationExecutor';
import { DocumentationExecutor } from './agent/executors/DocumentationExecutor';
import { RefactoringExecutor } from './agent/executors/RefactoringExecutor';
import { ExplanationExecutor } from './agent/executors/ExplanationExecutor';
import { ImprovementManager } from './improvements/ImprovementManager';
import { CodebaseIndexer } from './indexing/CodebaseIndexer';
import { FileAnalyzer } from './utils/FileAnalyzer';
import { CodeAnalyzer } from './utils/CodeAnalyzer';
import { ImprovementNoteExecutor } from './agent/executors/ImprovementNoteExecutor';
import { TestingExecutor } from './agent/executors/TestingExecutor';
import { DebuggingExecutor } from './agent/executors/DebuggingExecutor';
import { OptimizationExecutor } from './agent/executors/OptimizationExecutor';
import { SecurityExecutor } from './agent/executors/SecurityExecutor';
import { ReviewExecutor } from './agent/executors/ReviewExecutor';
import { ImprovementTreeProvider } from './views/ImprovementTreeProvider';
import { AIAssistantPanel } from './views/AIAssistantPanel';
import { ModelManager } from './utils/ModelManager';
import { AIEngineConfig } from './ai-engine/AIEngineConfig';
import { RAGService } from './indexing/RAGService';
import { CompletionManager } from './completion/CompletionManager';
import { AgentCommandHandler } from './agent/AgentCommandHandler';
import { TaskManager } from './agent/TaskManager';
import { MCPController } from './models/mcp/MCPController';
import { MCPAgentService } from './models/mcp/services/MCPAgentService';
import { AIEngineAdapter } from './models/mcp/adapters/AIEngineAdapter';
import { MCPService } from './mcp/MCPService';
import { MCPAgentAdapter } from './mcp/MCPAgentAdapter';
import { AIProvider } from './mcp/interfaces';
import { ChatService } from './utils/ChatService';
import { ChatViewProvider } from './webview/ChatViewProvider';

// Export the main extension class
export class SmileAIExtension {
    private readonly aiEngine: AIEngine;
    private readonly fileAnalyzer: FileAnalyzer;
    private readonly codeAnalyzer: CodeAnalyzer;
    public readonly codebaseIndexer: CodebaseIndexer;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly taskExecutors: Map<TaskType, TaskExecutor>;
    private readonly improvementProvider: ImprovementTreeProvider;
    private readonly modelManager: ModelManager;
    private readonly improvementManager: ImprovementManager;
    private readonly completionManager: CompletionManager;
    private aiAssistantPanel: AIAssistantPanel | undefined;
    private readonly context: vscode.ExtensionContext;
    private mcpService: MCPService | undefined;
    private mcpAgentAdapter: MCPAgentAdapter | undefined;
    private chatService: ChatService | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.fileAnalyzer = FileAnalyzer.getInstance();
        this.codeAnalyzer = CodeAnalyzer.getInstance();
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusBarItem.show();

        // Initialize managers and providers
        this.modelManager = ModelManager.getInstance();
        this.improvementManager = ImprovementManager.getInstance();
        
        // Get RAG settings from configuration
        const config = vscode.workspace.getConfiguration('smile-ai');
        const enableRAG = config.get<boolean>('enableRAG', true);
        
        // Initialize AI Engine with active model from ModelManager
        const activeModel = this.modelManager.getActiveModel();
        if (!activeModel) {
            // If no active model, use default settings
            const aiConfig: AIEngineConfig = {
                provider: {
                    name: 'ollama',
                    modelName: 'qwen2.5-coder:7b',
                    apiEndpoint: 'http://localhost:11434'
                },
                maxTokens: 2048,
                temperature: 0.7,
                embeddingModelName: 'nomic-embed-text',
                enableRAG: enableRAG
            };
            this.aiEngine = new AIEngine(aiConfig);
        } else {
            const aiConfig: AIEngineConfig = {
                provider: {
                    name: activeModel.provider,
                    modelName: activeModel.modelName,
                    apiEndpoint: activeModel.apiEndpoint
                },
                maxTokens: activeModel.maxTokens || 2048,
                temperature: activeModel.temperature || 0.7,
                embeddingModelName: activeModel.embeddingModelName || 'nomic-embed-text',
                enableRAG: activeModel.enableRAG !== undefined ? activeModel.enableRAG : enableRAG
            };
            this.aiEngine = new AIEngine(aiConfig);
        }
        
        // Initialize CodebaseIndexer
        this.codebaseIndexer = CodebaseIndexer.getInstance(this.aiEngine);
        
        // Initialize RAG service with codebase index
        this.aiEngine.initRAG(this.codebaseIndexer.getIndex());
        
        // Initialize CompletionManager
        this.completionManager = new CompletionManager(this.aiEngine, this.codebaseIndexer, context);
        console.log('Smile AI: CompletionManager initialized in SmileAIExtension');
        
        // Update RAG settings from configuration
        if (this.aiEngine) {
            const ragService = RAGService.getInstance(this.aiEngine, this.codebaseIndexer.getIndex());
            if (ragService) {
                ragService.setEnabled(enableRAG);
                ragService.setMaxChunks(config.get<number>('rag.maxChunks', 5));
                ragService.setMaxChunkSize(config.get<number>('rag.maxChunkSize', 2000));
                ragService.setMinSimilarity(config.get<number>('rag.minSimilarity', 0.7));
            }
        }
        
        // Initialize tree view provider
        this.improvementProvider = new ImprovementTreeProvider(this.improvementManager);
        vscode.window.registerTreeDataProvider('smile-ai.futureImprovements', this.improvementProvider);

        // Register webview provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('smile-ai.assistant', {
                resolveWebviewView: (webviewView: vscode.WebviewView) => {
                    // Set webview options
                    webviewView.webview.options = {
                        enableScripts: true,
                        enableCommandUris: true,
                        localResourceRoots: [
                            vscode.Uri.joinPath(context.extensionUri, 'media'),
                            vscode.Uri.joinPath(context.extensionUri, 'dist')
                        ]
                    };
                    
                    this.aiAssistantPanel = new AIAssistantPanel(
                        webviewView,
                        context,
                        this.aiEngine,
                        this.modelManager,
                        this.codebaseIndexer
                    );
                }
            }, { webviewOptions: { retainContextWhenHidden: true } })
        );
        
        this.taskExecutors = new Map();

        // Register commands
        this.registerCommands();

        this.initializeComponents();
    }

    private setStatusBarMessage(text: string, tooltip?: string, icon?: string): void {
        this.statusBarItem.text = icon ? `${icon} ${text}` : text;
        if (tooltip) {
            this.statusBarItem.tooltip = tooltip;
        }
    }

    private showLoading(message?: string): void {
        this.setStatusBarMessage(message || 'Loading...', undefined, '$(sync~spin)');
    }

    private showReady(message?: string): void {
        this.setStatusBarMessage(message || 'Ready', undefined, '$(check)');
    }

    private showError(message?: string): void {
        this.setStatusBarMessage(message || 'Error', undefined, '$(error)');
        vscode.window.showErrorMessage(message || 'An error occurred');
    }

    public async analyzeFile(document: vscode.TextDocument): Promise<boolean> {
        try {
            const uri = document.uri;
            const fileContext = await this.fileAnalyzer.analyzeFile(uri);
            const analysis = await this.codeAnalyzer.analyzeCode(uri, fileContext);
            
            // Update the file context with analysis results
            fileContext.analysis = analysis;
            
            return true;
        } catch (error) {
            console.error('Error analyzing file:', error);
            return false;
        }
    }

    private async startIndexing(): Promise<void> {
        await this.codebaseIndexer.indexWorkspace();
    }

    private async initializeComponents(): Promise<void> {
        try {
            console.log('🔧 [SmileAIExtension.initializeComponents] Başlatılıyor...');
            
            // Register task executors (code modifiers, etc.)
            this.registerTaskExecutors();
            
            // Start codebase indexing
            await this.startIndexing();
            
            // Listen for configuration changes
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('smile-ai.enableRAG') || 
                    e.affectsConfiguration('smile-ai.rag')) {
                    this.updateRAGSettings();
                }
                
                // Update completion settings when behavior config changes
                if (e.affectsConfiguration('smile-ai.behavior')) {
                    this.completionManager.updateFromConfig();
                }
                
                // Update MCP settings when mcp config changes
                if (e.affectsConfiguration('smile-ai.mcp')) {
                    this.updateMCPSettings();
                }
            });
            
            // Add other initialization tasks here
            this.showReady('Smile AI ready');

            // Initialize the Task Manager
            const taskManager = new TaskManager();
            
            // Improvements provider
            vscode.window.registerTreeDataProvider('smile-ai.improvements', this.improvementProvider);
            
            // Initialize the Agent Command Handler
            const agentCommandHandler = AgentCommandHandler.initialize(
                this.context,
                this.aiEngine,
                taskManager,
                this.codebaseIndexer
            );
            
            // Register agent commands
            agentCommandHandler.registerCommands(this.context);
            
            // MCP Bileşenlerini zorunlu başlatma
            console.log('🧩 [SmileAIExtension.initializeComponents] MCP servisini başlatma girişimi...');
            const mcpSuccess = await this.initializeMCPService();
            console.log(`🧩 [SmileAIExtension.initializeComponents] MCP servisi başlatıldı: ${mcpSuccess ? 'Başarılı' : 'Başarısız'}`);
            
            if (mcpSuccess) {
                console.log('🧩 [SmileAIExtension.initializeComponents] ChatService başlatılıyor...');
                await this.initializeChatService();
                console.log('✅ [SmileAIExtension.initializeComponents] ChatService başarıyla başlatıldı');
            } else {
                console.warn('⚠️ [SmileAIExtension.initializeComponents] MCP bağlantısı kurulamadı, yerel AI kullanılacak');
            }
            
            console.log('✅ [SmileAIExtension.initializeComponents] Tüm bileşenler başlatıldı');
        } catch (error) {
            this.showError(`Initialization error: ${error instanceof Error ? error.message : String(error)}`);
            console.error('❌ [SmileAIExtension.initializeComponents] Hata:', error);
        }
    }

    private registerTaskExecutors(): void {
        this.taskExecutors.set(TaskType.EXPLANATION, new ExplanationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.CODE_MODIFICATION, new CodeModificationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.TEST_GENERATION, new TestGenerationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.DOCUMENTATION, new DocumentationExecutor(this.aiEngine));
        this.taskExecutors.set(TaskType.REFACTORING, new RefactoringExecutor(this.aiEngine, this.codebaseIndexer));
        this.taskExecutors.set(TaskType.IMPROVEMENT_NOTE, new ImprovementNoteExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.TESTING, new TestingExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.DEBUGGING, new DebuggingExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.OPTIMIZATION, new OptimizationExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.SECURITY, new SecurityExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
        this.taskExecutors.set(TaskType.REVIEW, new ReviewExecutor(this.aiEngine, {
            setStatusBar: (text: string, tooltip?: string) => this.setStatusBarMessage(text, tooltip),
            showLoading: (message?: string) => this.showLoading(message),
            showReady: (message?: string) => this.showReady(message),
            showError: (message?: string) => this.showError(message)
        }));
    }

    private updateRAGSettings(): void {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const enableRAG = config.get<boolean>('enableRAG', true);
        
        const ragService = RAGService.getInstance(this.aiEngine, this.codebaseIndexer.getIndex());
        if (ragService) {
            ragService.setEnabled(enableRAG);
            ragService.setMaxChunks(config.get<number>('rag.maxChunks', 5));
            ragService.setMaxChunkSize(config.get<number>('rag.maxChunkSize', 2000));
            ragService.setMinSimilarity(config.get<number>('rag.minSimilarity', 0.7));
        }
        
        // Update AI engine config
        this.aiEngine.updateConfig({ enableRAG });
    }

    /**
     * MCP ayarlarını günceller
     */
    private async updateMCPSettings(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('smile-ai');
            const useLocalServer = config.get<boolean>('mcp.useLocalServer', true);
            
            if (useLocalServer) {
                const mcpServerUrl = config.get<string>('mcp.serverUrl', 'ws://localhost:3010');
                
                // MCP servisi zaten başlatıldıysa ve URL değiştiyse yeniden bağlan
                if (this.mcpService && this.mcpService.isConnected()) {
                    await vscode.commands.executeCommand('smile-ai.reconnectServer');
                } else if (!this.mcpService) {
                    // MCP servisi hiç başlatılmadıysa başlat
                    await this.initializeMCPService();
                }
            } else {
                // Lokal server kullanılmayacaksa ve bağlantı varsa kapat
                if (this.mcpService) {
                    this.mcpService.dispose();
                    this.mcpService = undefined;
                }
            }
        } catch (error) {
            console.error('Error updating MCP settings:', error);
        }
    }

    private registerCommands(): void {
        const context = this.context;
        
        // Add command registration for AI Interaction commands
        context.subscriptions.push(
            vscode.commands.registerCommand('smile-ai.analyzeCode', async () => {
                try {
                    this.showLoading('Analyzing code...');
                    const editor = vscode.window.activeTextEditor;
                    
                    if (!editor) {
                        vscode.window.showErrorMessage('No active editor');
                        this.showError('No active editor');
                        return;
                    }
                    
                    const document = editor.document;
                    const success = await this.analyzeFile(document);
                    
                    if (success) {
                        this.showReady('Code analysis complete');
                        vscode.window.showInformationMessage('Code analysis complete');
                    } else {
                        this.showError('Code analysis failed');
                    }
                } catch (error) {
                    this.showError(`Analysis error: ${error instanceof Error ? error.message : String(error)}`);
                    console.error('Error during code analysis:', error);
                }
            }),
            
            vscode.commands.registerCommand('smile-ai.generateTests', async () => {
                try {
                    this.showLoading('Generating tests...');
                    const editor = vscode.window.activeTextEditor;
                    
                    if (!editor) {
                        vscode.window.showErrorMessage('No active editor');
                        this.showError('No active editor');
                        return;
                    }
                    
                    const document = editor.document;
                    const executor = this.taskExecutors.get(TaskType.TEST_GENERATION);
                    
                    if (executor) {
                        await executor.execute({
                            id: Date.now().toString(),
                            type: TaskType.TEST_GENERATION,
                            description: 'Generate tests for the current file',
                            status: TaskStatus.PENDING,
                            priority: TaskPriority.MEDIUM,
                            created: Date.now(),
                            updated: Date.now(),
                            metadata: {
                                fileContext: await this.fileAnalyzer.analyzeFile(document.uri),
                                codeAnalysis: await this.codeAnalyzer.analyzeCode(document.uri, await this.fileAnalyzer.analyzeFile(document.uri))
                            }
                        });
                        this.showReady('Test generation complete');
                    } else {
                        this.showError('Test generation executor not available');
                    }
                } catch (error) {
                    this.showError(`Test generation error: ${error instanceof Error ? error.message : String(error)}`);
                    console.error('Error during test generation:', error);
                }
            }),
            
            // Refactor Code command
            vscode.commands.registerCommand('smile-ai.refactorCode', async () => {
                try {
                    this.showLoading('Refactoring code...');
                    const editor = vscode.window.activeTextEditor;
                    
                    if (!editor) {
                        vscode.window.showErrorMessage('No active editor');
                        this.showError('No active editor');
                        return;
                    }
                    
                    const document = editor.document;
                    const executor = this.taskExecutors.get(TaskType.REFACTORING);
                    
                    if (executor) {
                        await executor.execute({
                            id: Date.now().toString(),
                            type: TaskType.REFACTORING,
                            description: 'Refactor the current file',
                            status: TaskStatus.PENDING,
                            priority: TaskPriority.MEDIUM,
                            created: Date.now(),
                            updated: Date.now(),
                            metadata: {
                                fileContext: await this.fileAnalyzer.analyzeFile(document.uri),
                                codeAnalysis: await this.codeAnalyzer.analyzeCode(document.uri, await this.fileAnalyzer.analyzeFile(document.uri))
                            }
                        });
                        this.showReady('Code refactoring complete');
                    } else {
                        this.showError('Refactoring executor not available');
                    }
                } catch (error) {
                    this.showError(`Refactoring error: ${error instanceof Error ? error.message : String(error)}`);
                    console.error('Error during code refactoring:', error);
                }
            }),
            
            // Explain Code command
            vscode.commands.registerCommand('smile-ai.explainCode', async () => {
                try {
                    this.showLoading('Explaining code...');
                    const editor = vscode.window.activeTextEditor;
                    
                    if (!editor) {
                        vscode.window.showErrorMessage('No active editor');
                        this.showError('No active editor');
                        return;
                    }
                    
                    const document = editor.document;
                    const executor = this.taskExecutors.get(TaskType.EXPLANATION);
                    
                    if (executor) {
                        await executor.execute({
                            id: Date.now().toString(),
                            type: TaskType.EXPLANATION,
                            description: 'Explain the current file',
                            status: TaskStatus.PENDING,
                            priority: TaskPriority.MEDIUM,
                            created: Date.now(),
                            updated: Date.now(),
                            metadata: {
                                fileContext: await this.fileAnalyzer.analyzeFile(document.uri),
                                codeAnalysis: await this.codeAnalyzer.analyzeCode(document.uri, await this.fileAnalyzer.analyzeFile(document.uri))
                            }
                        });
                        this.showReady('Code explanation complete');
                    } else {
                        this.showError('Explanation executor not available');
                    }
                } catch (error) {
                    this.showError(`Explanation error: ${error instanceof Error ? error.message : String(error)}`);
                    console.error('Error during code explanation:', error);
                }
            }),
            
            // Reindex Codebase command
            vscode.commands.registerCommand('smile-ai.reindexCodebase', async () => {
                try {
                    this.showLoading('Reindexing codebase...');
                    await this.codebaseIndexer.indexWorkspace();
                    this.showReady('Codebase reindexing complete');
                    vscode.window.showInformationMessage('Codebase reindexing complete');
                } catch (error) {
                    this.showError(`Reindexing error: ${error instanceof Error ? error.message : String(error)}`);
                    console.error('Error during codebase reindexing:', error);
                }
            }),
            
            // Note Future Improvement
            vscode.commands.registerCommand('smile-ai.noteImprovement', async () => {
                try {
                    const executor = this.taskExecutors.get(TaskType.IMPROVEMENT_NOTE);
                    
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showErrorMessage('No active editor');
                        return;
                    }
                    
                    if (executor) {
                        const fileContext = await this.fileAnalyzer.analyzeFile(editor.document.uri);
                        const codeAnalysis = await this.codeAnalyzer.analyzeCode(editor.document.uri, fileContext);
                        await executor.execute({
                            id: Date.now().toString(),
                            type: TaskType.IMPROVEMENT_NOTE,
                            description: 'Note improvement for the current file',
                            status: TaskStatus.PENDING,
                            priority: TaskPriority.MEDIUM,
                            created: Date.now(),
                            updated: Date.now(),
                            metadata: {
                                fileContext,
                                codeAnalysis
                            }
                        });
                    } else {
                        vscode.window.showErrorMessage('Improvement note executor not available');
                    }
                } catch (error) {
                    console.error('Error noting improvement:', error);
                    vscode.window.showErrorMessage(`Error noting improvement: ${error instanceof Error ? error.message : String(error)}`);
                }
            }),
            
            vscode.commands.registerCommand('smile-ai.markImprovementDone', (item) => {
                if (item && item.id) {
                    this.improvementManager.updateNoteStatus(item.id, 'done');
                    this.improvementProvider.refresh();
                }
            }),
            
            vscode.commands.registerCommand('smile-ai.dismissImprovement', (item) => {
                if (item && item.id) {
                    this.improvementManager.updateNoteStatus(item.id, 'dismissed');
                    this.improvementProvider.refresh();
                }
            }),
            
            vscode.commands.registerCommand('smile-ai.setImprovementPriority', async (item) => {
                if (item && item.id) {
                    const priorities = ['low', 'medium', 'high', 'none'];
                    const selected = await vscode.window.showQuickPick(priorities, {
                        placeHolder: 'Select priority level'
                    });
                    
                    if (selected) {
                        this.improvementManager.updateNotePriority(item.id, selected as 'low' | 'medium' | 'high' | 'none');
                        this.improvementProvider.refresh();
                    }
                }
            }),
            
            // Add/remove/select model commands - Pass to modelManager
            vscode.commands.registerCommand('smile-ai.addModel', async () => {
                await this.modelManager.promptAddModel();
                
                // Check if AIAssistantPanel exists and update models
                if (this.aiAssistantPanel) {
                    //this.aiAssistantPanel.updateModels();
                }
            }),
            
            vscode.commands.registerCommand('smile-ai.removeModel', async () => {
                await this.modelManager.removeModel((await this.modelManager.getActiveModel())?.name || '');
                
                // Check if AIAssistantPanel exists and update models
                if (this.aiAssistantPanel) {
                    //this.aiAssistantPanel.updateModels();
                }
            }),
            
            vscode.commands.registerCommand('smile-ai.selectActiveModel', async () => {
                await this.modelManager.promptSelectActiveModel();
                
                // Update AI Engine with new model if changed
                const activeModel = this.modelManager.getActiveModel();
                if (activeModel) {
                    // Update the AI engine configuration
                    const aiConfig = {
                        provider: {
                            name: activeModel.provider,
                            modelName: activeModel.modelName,
                            apiEndpoint: activeModel.apiEndpoint
                        },
                        maxTokens: activeModel.maxTokens || 2048,
                        temperature: activeModel.temperature || 0.7
                    };
                    this.aiEngine.updateConfig(aiConfig);
                }
                
                // Check if AIAssistantPanel exists and update models
                if (this.aiAssistantPanel) {
                    //this.aiAssistantPanel.updateModels();
                }
            }),
            
            // Add command to send a chat message with ctrl+enter
            vscode.commands.registerCommand('smile-ai.sendChatMessage', () => {
                console.log('Command smile-ai.sendChatMessage called');
                // This command will be intercepted by the webview and handled there
                if (this.aiAssistantPanel) {
                    console.log('AIAssistantPanel found, sending message to webview');
                    this.aiAssistantPanel.sendMessageToWebview({
                        command: 'triggerSendMessage'
                    });
                } else {
                    console.log('AIAssistantPanel not found, focusing and retrying');
                    // If the AIAssistantPanel is not active, focus it first
                    vscode.commands.executeCommand('smile-ai.assistant.focus');
                    // Give it a moment to activate before sending the command
                    setTimeout(() => {
                        if (this.aiAssistantPanel) {
                            console.log('AIAssistantPanel now available, sending message');
                            this.aiAssistantPanel.sendMessageToWebview({
                                command: 'triggerSendMessage'
                            });
                        } else {
                            console.warn('AIAssistantPanel still not available after focus');
                        }
                    }, 500);
                }
            })
        );
    }

    /**
     * MCP Servisini başlatır ve SmileAgent Server'a bağlanır
     */
    private async initializeMCPService(): Promise<boolean> {
        try {
            console.log('🌐 Starting MCP Service initialization');
            
            // Her durumda bağlantıyı deneyeceğiz
            // Config default değerlerini değiştirsek de olur
            const mcpServerUrl = 'ws://localhost:3010';
            console.log(`🌐 Trying to connect to SmileAgent Server at ${mcpServerUrl}`);
            
            this.mcpService = new MCPService({
                serverUrl: mcpServerUrl,
                reconnectInterval: 5000,
                maxReconnectAttempts: 5
            });
            
            // MCPService'i başlat ve bağlantıyı kur
            const connected = await this.mcpService.initialize();
            
            if (connected) {
                // Bağlantı başarılıysa MCPAgentAdapter'ı oluştur
                this.mcpAgentAdapter = new MCPAgentAdapter(this.mcpService);
                console.log('✅ MCPAgentAdapter initialized successfully');
                
                // Initialize chat functionality
                await this.initializeChatService();
                
                vscode.window.showInformationMessage('✅ Connected to SmileAgent Server. AI requests will be processed on the server.');
                return true;
            } else {
                console.warn('⚠️ Failed to connect to SmileAgent Server, MCPAgentAdapter not initialized');
                vscode.window.showWarningMessage('⚠️ Could not connect to SmileAgent Server. Using local AI engine.');
                return false;
            }
        } catch (error) {
            console.error('❌ Error initializing MCPService:', error);
            vscode.window.showErrorMessage(`❌ Error connecting to SmileAgent Server: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Sunucu bağlantısına göre AI Engine veya MCP Agent Adapter'ı döndürür
     */
    public getAIProvider(): AIProvider {
        // MCP bağlantısı varsa ve kullanımı etkinse, MCP Agent Adapter'ı kullan
        console.log('🔍 getAIProvider called, checking MCP adapter status');
        
        try {
            // Önce MCPService bağlantısını kontrol et
            if (this.mcpService) {
                const mcpConnected = this.mcpService.isConnected();
                console.log(`⚡ MCPService connection status: ${mcpConnected ? 'Connected' : 'Not connected'}`);
                
                // Sonra MCPAgentAdapter'ı kontrol et
                if (this.mcpAgentAdapter) {
                    const adapterConnected = this.mcpAgentAdapter.isConnected();
                    console.log(`⚡ MCPAgentAdapter connection status: ${adapterConnected ? 'Connected' : 'Not connected'}`);
                    
                    if (adapterConnected) {
                        console.log('✅ Using MCPAgentAdapter as AI provider (SmileAgent Server)');
                        return this.mcpAgentAdapter;
                    } else {
                        console.log('⚠️ MCPAgentAdapter exists but reports not connected');
                    }
                } else {
                    console.log('⚠️ MCPService exists but MCPAgentAdapter not initialized');
                    
                    // MCPService varsa ama adapter yoksa, adapter'ı oluştur ve dene
                    if (mcpConnected) {
                        console.log('🔄 Creating MCPAgentAdapter from existing MCPService');
                        this.mcpAgentAdapter = new MCPAgentAdapter(this.mcpService);
                        
                        if (this.mcpAgentAdapter.isConnected()) {
                            console.log('✅ Newly created MCPAgentAdapter is connected, using it');
                            return this.mcpAgentAdapter;
                        }
                    }
                }
            } else {
                console.log('⚠️ MCPService not initialized');
                
                // MCPService yoksa, oluşturmayı dene
                const config = vscode.workspace.getConfiguration('smile-ai');
                const useLocalServer = config.get<boolean>('mcp.useLocalServer', true);
                
                if (useLocalServer) {
                    console.log('🔄 Trying to initialize MCPService on-demand');
                    // Explicit type cast to Promise<boolean>
                    const initPromise = this.initializeMCPService() as Promise<boolean>;
                    initPromise.then(success => {
                        if (success) {
                            console.log('MCPService initialization successful');
                            if (this.mcpAgentAdapter && this.mcpAgentAdapter.isConnected()) {
                                console.log('✅ New MCPAgentAdapter is connected and ready for next request');
                            }
                        } else {
                            console.log('MCPService initialization failed');
                        }
                    }).catch(error => {
                        console.error('Error initializing MCPService:', error);
                    });
                }
            }
        } catch (error) {
            console.error('❌ Error checking MCP provider:', error);
        }
        
        // Yoksa yerel AI Engine'i kullan
        console.log('⚙️ Using local AIEngine as provider');
        return this.aiEngine;
    }

    // Helper methods to work with private AIAssistantPanel methods
    public dispose() {
        this.statusBarItem.dispose();
        // Dispose the completion manager
        this.completionManager.dispose();
        // Note: CodebaseIndexer and ImprovementManager don't need dispose methods
        if (this.aiAssistantPanel) {
            this.aiAssistantPanel.dispose();
        }
        
        // MCP servisi ve adaptörü varsa dispose et
        if (this.mcpService) {
            this.mcpService.dispose();
            this.mcpService = undefined;
            this.mcpAgentAdapter = undefined;
        }
    }

    // Initialize chat functionality with server connectivity
    private async initializeChatService(): Promise<void> {
        try {
            if (!this.mcpService) {
                console.error('❌ Cannot initialize ChatService - MCPService not available');
                return;
            }

            console.log('🚀 Initializing ChatService for server-based chat');
            this.chatService = ChatService.getInstance(this.mcpService.getClient(), this.context);
            
            // Register the chat view provider
            const chatViewProvider = new ChatViewProvider(this.context.extensionUri, this.chatService);
            this.context.subscriptions.push(
                vscode.window.registerWebviewViewProvider('smile-ai.chatView', chatViewProvider)
            );
            
            console.log('✅ ChatService initialized and Chat View registered');
        } catch (error) {
            console.error('❌ Error initializing ChatService:', error);
        }
    }
}

// Extension activation
let extension: SmileAIExtension | undefined;

// Export the extension instance for other modules to use
export { extension };

export async function activate(context: vscode.ExtensionContext) {
    console.log('Smile AI active!');

    // Create the extension instance
    extension = new SmileAIExtension(context);

    // Register commands that don't require the extension instance
    context.subscriptions.push(
        vscode.commands.registerCommand('smile-ai.startChat', () => {
            vscode.commands.executeCommand('smile-ai.assistant.focus');
        }),
        vscode.commands.registerCommand('smile-ai.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'smile-ai');
        }),
        vscode.commands.registerCommand('smile-ai.attachFile', async (uri: vscode.Uri) => {
            if (uri) {
                await extension?.codebaseIndexer.attachFile(uri.fsPath);
            }
        }),
        vscode.commands.registerCommand('smile-ai.attachFolder', async (uri: vscode.Uri) => {
            if (uri) {
                await extension?.codebaseIndexer.attachFolder(uri.fsPath);
            }
        })
    );

    // Initial indexing
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Indexing workspace...",
        cancellable: false
    }, async (progress) => {
        await extension?.codebaseIndexer.indexWorkspace((message) => {
            progress.report({ message });
        });
    });
}

// Extension deactivation
export function deactivate() {
    if (extension) {
        extension.dispose();
    }
    console.log('Smile AI inactive!');
    extension = undefined;
} 
