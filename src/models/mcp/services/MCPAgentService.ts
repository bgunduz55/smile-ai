import { v4 as uuidv4 } from 'uuid';
import { MCPController } from '../MCPController';
import { 
    MCPMessageType, 
    MCPRequest, 
    MCPResponse, 
    MCPTool
} from '../types';
import { AgentCommandHandler } from '../../../agent/AgentCommandHandler';

/**
 * Service for handling agent operations through MCP
 */
export class MCPAgentService {
    private static instance: MCPAgentService;
    private mcpController: MCPController;
    private agentCommandHandler: AgentCommandHandler;
    private activeOperations: Map<string, { cancel: () => void }> = new Map();
    
    private constructor() {
        this.mcpController = MCPController.getInstance();
        this.agentCommandHandler = AgentCommandHandler.getInstance();
        this.registerAgentTools();
    }
    
    /**
     * Get the singleton instance
     */
    public static getInstance(): MCPAgentService {
        if (!MCPAgentService.instance) {
            MCPAgentService.instance = new MCPAgentService();
        }
        return MCPAgentService.instance;
    }
    
    /**
     * Initialize the service and register it with the MCP controller
     */
    public initialize(): void {
        // Register the service as a local handler for agent capabilities
        this.mcpController.registerLocalHandler('agent:execute', this.handleAgentExecute.bind(this));
        this.mcpController.registerLocalHandler('agent:cancel', this.handleAgentCancel.bind(this));
        this.mcpController.registerLocalHandler('agent:status', this.handleAgentStatus.bind(this));
        
        console.log('MCP Agent Service initialized');
    }
    
    /**
     * Handle an agent execution request
     */
    private async handleAgentExecute(request: MCPRequest): Promise<MCPResponse> {
        try {
            const operationId = uuidv4();
            const userMessage = request.messages[request.messages.length - 1].content;
            
            console.log(`Starting agent operation ${operationId} with message: ${userMessage}`);
            
            // Set up cancel function
            let cancelRequested = false;
            const cancelOperation = () => {
                cancelRequested = true;
                console.log(`Agent operation ${operationId} cancelled`);
            };
            
            // Store operation for potential cancellation
            this.activeOperations.set(operationId, { cancel: cancelOperation });
            
            // Execute agent operation
            const result = await this.agentCommandHandler.executeCommand(userMessage, {
                onProgress: (progress) => {
                    console.log(`Agent operation ${operationId} progress: ${progress}`);
                    // For a streaming implementation, we would send progress updates here
                },
                checkCancellation: () => cancelRequested
            });
            
            // Remove from active operations
            this.activeOperations.delete(operationId);
            
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: result.message || 'Agent operation completed successfully',
                usage: {
                    promptTokens: 0, // We don't track token usage for agent operations yet
                    completionTokens: 0,
                    totalTokens: 0
                }
            };
        } catch (error) {
            console.error('Error in agent execution:', error);
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Agent operation failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Handle an agent cancellation request
     */
    private async handleAgentCancel(request: MCPRequest): Promise<MCPResponse> {
        try {
            const operationId = request.context?.operationId;
            
            if (!operationId) {
                return {
                    id: request.id,
                    type: MCPMessageType.RESPONSE,
                    timestamp: Date.now(),
                    version: '1.0',
                    content: 'No operation ID provided for cancellation'
                };
            }
            
            const operation = this.activeOperations.get(operationId);
            
            if (!operation) {
                return {
                    id: request.id,
                    type: MCPMessageType.RESPONSE,
                    timestamp: Date.now(),
                    version: '1.0',
                    content: `No active operation found with ID ${operationId}`
                };
            }
            
            // Cancel the operation
            operation.cancel();
            
            // Remove from active operations
            this.activeOperations.delete(operationId);
            
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Operation ${operationId} cancelled successfully`
            };
        } catch (error) {
            console.error('Error cancelling agent operation:', error);
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Error cancelling operation: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Handle an agent status request
     */
    private async handleAgentStatus(request: MCPRequest): Promise<MCPResponse> {
        try {
            const activeOperationsCount = this.activeOperations.size;
            const operations = Array.from(this.activeOperations.keys());
            
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: JSON.stringify({
                    activeOperations: activeOperationsCount,
                    operationIds: operations
                })
            };
        } catch (error) {
            console.error('Error getting agent status:', error);
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Error getting agent status: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Register agent-related tools with the MCP controller
     */
    private registerAgentTools(): void {
        // Define agent tools
        const agentTools: MCPTool[] = [
            {
                name: 'file_read',
                description: 'Read the contents of a file',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: {
                            type: 'string',
                            description: 'Path to the file to read'
                        }
                    },
                    required: ['filePath']
                }
            },
            {
                name: 'file_write',
                description: 'Write content to a file',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: {
                            type: 'string',
                            description: 'Path to the file to write'
                        },
                        content: {
                            type: 'string',
                            description: 'Content to write to the file'
                        },
                        append: {
                            type: 'boolean',
                            description: 'Whether to append to the file instead of overwriting'
                        }
                    },
                    required: ['filePath', 'content']
                }
            },
            {
                name: 'run_command',
                description: 'Run a shell command',
                parameters: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            description: 'Command to run'
                        },
                        cwd: {
                            type: 'string',
                            description: 'Working directory for the command'
                        }
                    },
                    required: ['command']
                }
            },
            {
                name: 'list_directory',
                description: 'List the contents of a directory',
                parameters: {
                    type: 'object',
                    properties: {
                        dirPath: {
                            type: 'string',
                            description: 'Path to the directory to list'
                        }
                    },
                    required: ['dirPath']
                }
            }
        ];
        
        // Register tool handlers
        this.mcpController.registerLocalHandler('tool:file_read', this.handleFileRead.bind(this));
        this.mcpController.registerLocalHandler('tool:file_write', this.handleFileWrite.bind(this));
        this.mcpController.registerLocalHandler('tool:run_command', this.handleRunCommand.bind(this));
        this.mcpController.registerLocalHandler('tool:list_directory', this.handleListDirectory.bind(this));
        
        // Log registered tools
        console.log(`Registered ${agentTools.length} agent tools`);
    }
    
    /**
     * Handle file read tool call
     */
    private async handleFileRead(request: MCPRequest): Promise<MCPResponse> {
        try {
            // Extract file path from arguments
            const filePath = request.context?.toolCall?.arguments?.filePath;
            
            if (!filePath) {
                throw new Error('File path not provided');
            }
            
            // Read file using VSCode API
            const fileContent = await this.agentCommandHandler.readFile(filePath);
            
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: fileContent
            };
        } catch (error) {
            console.error('Error in file read tool:', error);
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Handle file write tool call
     */
    private async handleFileWrite(request: MCPRequest): Promise<MCPResponse> {
        try {
            // Extract arguments
            const args = request.context?.toolCall?.arguments;
            
            if (!args?.filePath || !args?.content) {
                throw new Error('File path or content not provided');
            }
            
            // Write file using VSCode API
            await this.agentCommandHandler.writeFile(
                args.filePath, 
                args.content, 
                args.append === true
            );
            
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `File ${args.filePath} ${args.append ? 'appended' : 'written'} successfully`
            };
        } catch (error) {
            console.error('Error in file write tool:', error);
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Handle run command tool call
     */
    private async handleRunCommand(request: MCPRequest): Promise<MCPResponse> {
        try {
            // Extract arguments
            const args = request.context?.toolCall?.arguments;
            
            if (!args?.command) {
                throw new Error('Command not provided');
            }
            
            // Run command using VSCode API
            const result = await this.agentCommandHandler.runCommand(args.command, args.cwd);
            
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: result
            };
        } catch (error) {
            console.error('Error in run command tool:', error);
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Handle list directory tool call
     */
    private async handleListDirectory(request: MCPRequest): Promise<MCPResponse> {
        try {
            // Extract arguments
            const dirPath = request.context?.toolCall?.arguments?.dirPath;
            
            if (!dirPath) {
                throw new Error('Directory path not provided');
            }
            
            // List directory using VSCode API
            const listing = await this.agentCommandHandler.listDirectory(dirPath);
            
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: JSON.stringify(listing)
            };
        } catch (error) {
            console.error('Error in list directory tool:', error);
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
} 