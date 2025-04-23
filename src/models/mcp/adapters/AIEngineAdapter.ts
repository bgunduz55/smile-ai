import { AIEngine } from '../../../ai-engine/AIEngine';
import { AIMessage, AIRequest } from '../../../ai-engine/types';
import {
    MCPChatMessage,
    MCPContext,
    MCPMessageType,
    MCPRequest,
    MCPResponse,
    MCPStreamMessage
} from '../types';

/**
 * Adapter to integrate MCP with the existing AIEngine
 * This provides compatibility with our current AIEngine implementation
 */
export class AIEngineAdapter {
    private aiEngine: AIEngine;
    
    constructor(aiEngine: AIEngine) {
        this.aiEngine = aiEngine;
    }
    
    /**
     * Convert MCP request to AIEngine request format
     */
    public async processMCPRequest(
        mcpRequest: MCPRequest,
        onStreamUpdate?: (message: MCPStreamMessage) => void
    ): Promise<MCPResponse> {
        try {
            // Convert MCP request to AIEngine format
            const aiRequest = this.convertToAIRequest(mcpRequest);
            
            // Determine mode based on context
            const mode = mcpRequest.context?.mode as 'chat' | 'agent' | 'ask' || 'agent';
            
            // Process with or without streaming
            let result: string;
            
            if (onStreamUpdate && mcpRequest.options?.streaming) {
                // Handle streaming request
                result = await this.processMCPRequestWithStreaming(mcpRequest, onStreamUpdate, mode);
            } else {
                // Process normal request based on mode
                switch (mode) {
                    case 'agent':
                        result = await this.aiEngine.processAgentMessage(
                            aiRequest.messages[aiRequest.messages.length - 1].content,
                            {
                                options: {
                                    temperature: aiRequest.temperature,
                                    maxTokens: aiRequest.maxTokens
                                },
                                contextHistory: this.convertMessagesToContextHistory(aiRequest.messages)
                            }
                        );
                        break;
                    case 'ask':
                        result = await this.aiEngine.processAskMessage(
                            aiRequest.messages[aiRequest.messages.length - 1].content,
                            {
                                options: {
                                    temperature: aiRequest.temperature,
                                    maxTokens: aiRequest.maxTokens
                                },
                                contextHistory: this.convertMessagesToContextHistory(aiRequest.messages)
                            }
                        );
                        break;
                    case 'chat':
                    default:
                        result = await this.aiEngine.processMessage(
                            aiRequest.messages[aiRequest.messages.length - 1].content,
                            {
                                options: {
                                    temperature: aiRequest.temperature,
                                    maxTokens: aiRequest.maxTokens,
                                    stream: false
                                },
                                contextHistory: this.convertMessagesToContextHistory(aiRequest.messages)
                            }
                        );
                        break;
                }
            }
            
            // Create MCP response
            return {
                id: mcpRequest.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: result || ''
            };
        } catch (error) {
            console.error('Error in AIEngineAdapter:', error);
            // Return error response
            return {
                id: mcpRequest.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Convert AIMessage[] to format expected by the AIEngine
     */
    private convertMessagesToContextHistory(messages: AIMessage[]): Array<{ role: string; content: string; timestamp: number }> {
        return messages.map(m => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp || Date.now()
        }));
    }
    
    /**
     * Process an MCP request with streaming response
     */
    private async processMCPRequestWithStreaming(
        mcpRequest: MCPRequest,
        onStreamUpdate: (message: MCPStreamMessage) => void,
        mode: 'chat' | 'agent' | 'ask'
    ): Promise<string> {
        // Get the user message
        const userMessage = mcpRequest.messages.find(m => m.role === 'user')?.content || '';
        
        // Convert to adapter format
        const options = {
            options: {
                temperature: mcpRequest.options?.temperature,
                maxTokens: mcpRequest.options?.maxTokens,
                stream: true,
                onChunk: (chunk: string) => {
                    // Send chunk as stream message
                    onStreamUpdate({
                        id: mcpRequest.id,
                        type: MCPMessageType.STREAM,
                        timestamp: Date.now(),
                        version: '1.0',
                        content: chunk,
                        isDelta: true
                    });
                }
            },
            contextHistory: mcpRequest.messages.map(m => ({
                role: m.role,
                content: m.content,
                timestamp: Date.now()
            }))
        };
        
        // Call the appropriate method based on mode
        let result: string;
        
        switch (mode) {
            case 'agent':
                result = await this.aiEngine.processAgentMessage(userMessage, options);
                break;
            case 'ask':
                result = await this.aiEngine.processAskMessage(userMessage, options);
                break;
            case 'chat':
            default:
                result = await this.aiEngine.processMessage(userMessage, options);
                break;
        }
        
        // Send completion message
        onStreamUpdate({
            id: mcpRequest.id,
            type: MCPMessageType.STREAM,
            timestamp: Date.now(),
            version: '1.0',
            content: '',
            isDelta: false,
            isComplete: true
        });
        
        return result;
    }
    
    /**
     * Convert MCP Request to AIEngine request format
     */
    private convertToAIRequest(mcpRequest: MCPRequest): AIRequest {
        // Convert MCP messages to AIEngine message format
        const messages: AIMessage[] = mcpRequest.messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: Date.now(),
            context: this.extractMessageContext(msg, mcpRequest.context)
        }));
        
        // Create AIRequest
        const aiRequest: AIRequest = {
            messages,
            // Use mode from context if available
            context: {
                mode: mcpRequest.context?.mode || 'agent',
                selectedText: mcpRequest.context?.selectedText,
                filePath: mcpRequest.context?.filePath,
                prompt: mcpRequest.context?.prompt,
                currentFile: mcpRequest.context?.currentFile
            },
            systemPrompt: this.generateSystemPrompt(mcpRequest),
            maxTokens: mcpRequest.options?.maxTokens,
            temperature: mcpRequest.options?.temperature
        };
        
        return aiRequest;
    }
    
    /**
     * Generate system prompt from MCP request
     */
    private generateSystemPrompt(mcpRequest: MCPRequest): string {
        // Start with basic system prompt
        let systemPrompt = 'You are an AI assistant integrated with VSCode, helping with coding tasks.';
        
        // Add information about the model
        systemPrompt += `\nYou are running as model: ${mcpRequest.model}`;
        
        // Add tool descriptions if tools are provided
        if (mcpRequest.tools && mcpRequest.tools.length > 0) {
            systemPrompt += '\n\nYou have access to the following tools:';
            
            for (const tool of mcpRequest.tools) {
                systemPrompt += `\n- ${tool.name}: ${tool.description}`;
            }
            
            systemPrompt += '\n\nTo use a tool, respond with a message that includes:';
            systemPrompt += '\n```json\n{"tool": "tool_name", "args": {"param1": "value1", "param2": "value2"}}\n```';
        }
        
        // Add project context
        if (mcpRequest.context?.project) {
            const project = mcpRequest.context.project;
            systemPrompt += `\n\nYou are working on a ${project.language || 'code'} project`;
            
            if (project.type) {
                systemPrompt += ` of type ${project.type}`;
            }
            
            if (project.name) {
                systemPrompt += ` named ${project.name}`;
            }
            
            if (project.dependencies && project.dependencies.length > 0) {
                systemPrompt += `\nThe project uses these dependencies: ${project.dependencies.join(', ')}`;
            }
        }
        
        return systemPrompt;
    }
    
    /**
     * Extract context from MCP message
     */
    private extractMessageContext(message: MCPChatMessage, context?: MCPContext): any {
        const messageContext: any = {};
        
        // Extract file context if available
        if (context?.codebase?.relevantFiles) {
            const fileForMessage = context.codebase.relevantFiles.find(f => 
                message.content.includes(f.path)
            );
            
            if (fileForMessage) {
                messageContext.file = fileForMessage.path;
            }
        }
        
        // Add selection context
        if (context?.selectedText) {
            messageContext.selection = context.selectedText;
        }
        
        return Object.keys(messageContext).length > 0 ? messageContext : undefined;
    }
} 