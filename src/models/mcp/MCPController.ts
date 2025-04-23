import { v4 as uuidv4 } from 'uuid';
import {
    MCPMessageType,
    MCPRequest,
    MCPResponse,
    MCPErrorMessage,
    MCPStreamMessage,
    MCPServerConfig,
    MCPToolCall
} from './types';
import { MCPConfig } from './MCPConfig';

/**
 * Controller for the Model Context Protocol
 * Manages MCP messages and routes them to appropriate providers
 */
export class MCPController {
    private static instance: MCPController;
    private servers: Map<string, MCPServerConfig> = new Map();
    private localHandlers: Map<string, (request: MCPRequest) => Promise<MCPResponse | AsyncIterable<MCPStreamMessage>>> = new Map();
    private config: MCPConfig;

    private constructor() {
        this.config = new MCPConfig();
        this.initializeDefaultHandlers();
    }

    /**
     * Get the singleton instance of the MCPController
     */
    public static getInstance(): MCPController {
        if (!MCPController.instance) {
            MCPController.instance = new MCPController();
        }
        return MCPController.instance;
    }

    /**
     * Initialize the controller with configuration
     */
    public async initialize(): Promise<void> {
        // Load server configurations
        const servers = await this.config.getServerConfigurations();
        servers.forEach((server: MCPServerConfig) => {
            this.servers.set(server.name, server);
        });
        
        // Log available servers
        console.log(`MCP initialized with ${this.servers.size} servers`);
    }

    /**
     * Register a local handler for specific capabilities
     */
    public registerLocalHandler(
        capability: string,
        handler: (request: MCPRequest) => Promise<MCPResponse | AsyncIterable<MCPStreamMessage>>
    ): void {
        this.localHandlers.set(capability, handler);
        console.log(`Registered local handler for capability: ${capability}`);
    }

    /**
     * Register an external MCP server
     */
    public async registerServer(server: MCPServerConfig): Promise<void> {
        // Validate server configuration
        if (!server.name || !server.endpoint) {
            throw new Error('Invalid server configuration: name and endpoint are required');
        }

        // Add to configuration
        await this.config.addServerConfiguration(server);
        
        // Add to in-memory map
        this.servers.set(server.name, server);
        
        console.log(`Registered MCP server: ${server.name} at ${server.endpoint}`);
    }

    /**
     * Remove a registered server
     */
    public async removeServer(serverName: string): Promise<void> {
        await this.config.removeServerConfiguration(serverName);
        this.servers.delete(serverName);
        console.log(`Removed MCP server: ${serverName}`);
    }

    /**
     * Process an MCP request
     */
    public async processRequest(
        request: Omit<MCPRequest, 'id' | 'timestamp' | 'version' | 'type'>,
        onStreamUpdate?: (message: MCPStreamMessage) => void
    ): Promise<MCPResponse> {
        // Create a proper MCPRequest with required fields
        const fullRequest: MCPRequest = {
            ...request,
            id: uuidv4(),
            timestamp: Date.now(),
            version: '1.0',
            type: MCPMessageType.REQUEST
        };

        try {
            // Determine where to route the request
            if (fullRequest.serverName) {
                // Route to specific server
                return await this.routeToServer(fullRequest, onStreamUpdate);
            } else {
                // Route based on capability matching
                return await this.routeByCapability(fullRequest, onStreamUpdate);
            }
        } catch (error) {
            console.error('Error processing MCP request:', error);
            
            // Create error response
            const errorResponse: MCPErrorMessage = {
                id: uuidv4(),
                type: MCPMessageType.ERROR,
                timestamp: Date.now(),
                version: '1.0',
                error: {
                    code: 'processing_error',
                    message: error instanceof Error ? error.message : String(error)
                }
            };
            
            // Convert to regular response format
            return {
                id: fullRequest.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: `Error: ${errorResponse.error.message}`
            };
        }
    }

    /**
     * Process a tool call from an MCP response
     */
    public async processToolCall(toolCall: MCPToolCall): Promise<any> {
        try {
            // Find the appropriate handler for this tool
            const handler = this.localHandlers.get(toolCall.name);
            
            if (!handler) {
                throw new Error(`No handler registered for tool: ${toolCall.name}`);
            }
            
            // Parse arguments
            const args = typeof toolCall.arguments === 'string' 
                ? JSON.parse(toolCall.arguments) 
                : toolCall.arguments;
            
            // Execute the tool
            const result = await this.executeLocalTool(toolCall.name, args);
            
            return result;
        } catch (error) {
            console.error(`Error processing tool call ${toolCall.name}:`, error);
            return {
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Route a request to a specific server
     */
    private async routeToServer(
        request: MCPRequest,
        onStreamUpdate?: (message: MCPStreamMessage) => void
    ): Promise<MCPResponse> {
        const serverName = request.serverName;
        
        if (!serverName) {
            throw new Error('Server name is required for routing');
        }
        
        const server = this.servers.get(serverName);
        
        if (!server) {
            throw new Error(`No MCP server found with name: ${serverName}`);
        }
        
        // Handle streaming if needed
        if (request.options?.streaming && onStreamUpdate) {
            return this.handleStreamingRequest(server, request, onStreamUpdate);
        }
        
        // Handle regular request
        return this.sendRequestToServer(server, request);
    }

    /**
     * Route a request based on capability matching
     */
    private async routeByCapability(
        request: MCPRequest,
        onStreamUpdate?: (message: MCPStreamMessage) => void
    ): Promise<MCPResponse> {
        // Determine what capabilities are needed for this request
        const requiredCapabilities = this.determineRequiredCapabilities(request);
        
        // Check if we have local handlers for these capabilities
        for (const capability of requiredCapabilities) {
            const handler = this.localHandlers.get(capability);
            
            if (handler) {
                console.log(`Using local handler for capability: ${capability}`);
                const response = await handler(request);
                
                // Handle streaming response if needed
                if ('then' in response && 'catch' in response) {
                    // It's a Promise<MCPResponse>
                    return response as MCPResponse;
                } else {
                    // It's an AsyncIterable<MCPStreamMessage>
                    return this.processAsyncIterable(response as AsyncIterable<MCPStreamMessage>, request.id);
                }
            }
        }
        
        // Find best server match
        const server = this.findBestServerMatch(requiredCapabilities);
        
        if (!server) {
            throw new Error(`No suitable MCP server found for capabilities: ${requiredCapabilities.join(', ')}`);
        }
        
        console.log(`Routing to server ${server.name} for capabilities: ${requiredCapabilities.join(', ')}`);
        
        // Handle streaming if needed
        if (request.options?.streaming && onStreamUpdate) {
            return this.handleStreamingRequest(server, request, onStreamUpdate);
        }
        
        // Handle regular request
        return this.sendRequestToServer(server, request);
    }

    /**
     * Send a request to an external MCP server
     */
    private async sendRequestToServer(server: MCPServerConfig, request: MCPRequest): Promise<MCPResponse> {
        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            
            // Add authentication headers
            this.addAuthHeaders(headers, server);
            
            const response = await fetch(server.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(request)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server error (${response.status}): ${errorText}`);
            }
            
            const data = await response.json();
            return data as MCPResponse;
        } catch (error) {
            console.error(`Error sending request to server ${server.name}:`, error);
            throw error;
        }
    }

    /**
     * Handle a streaming request to an external MCP server
     */
    private async handleStreamingRequest(
        server: MCPServerConfig,
        request: MCPRequest,
        onStreamUpdate: (message: MCPStreamMessage) => void
    ): Promise<MCPResponse> {
        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            };
            
            // Add authentication headers
            this.addAuthHeaders(headers, server);
            
            const response = await fetch(server.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(request)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server error (${response.status}): ${errorText}`);
            }
            
            if (!response.body) {
                throw new Error('Response body is null');
            }
            
            // Process the stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    break;
                }
                
                // Decode the chunk and add to buffer
                buffer += decoder.decode(value, { stream: true });
                
                // Process complete messages in the buffer
                const messages = buffer.split('\n\n');
                buffer = messages.pop() || '';
                
                for (const message of messages) {
                    if (message.trim()) {
                        try {
                            // Parse the message
                            const streamMessage = this.parseStreamMessage(message);
                            
                            // Add to full content
                            if (streamMessage.content) {
                                fullContent += streamMessage.content;
                            }
                            
                            // Notify the callback
                            onStreamUpdate(streamMessage);
                        } catch (e) {
                            console.error('Error parsing stream message:', e, message);
                        }
                    }
                }
            }
            
            // Create final response
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: fullContent
            };
        } catch (error) {
            console.error(`Error handling streaming request to server ${server.name}:`, error);
            throw error;
        }
    }

    /**
     * Parse a stream message from SSE format
     */
    private parseStreamMessage(message: string): MCPStreamMessage {
        // Parse SSE format
        const lines = message.split('\n');
        const data = lines.find(line => line.startsWith('data:'))?.substring(5).trim();
        
        if (!data) {
            throw new Error('Invalid stream message format: missing data field');
        }
        
        try {
            return JSON.parse(data) as MCPStreamMessage;
        } catch (e) {
            // If not JSON, treat as plain text content
            return {
                id: uuidv4(),
                type: MCPMessageType.STREAM,
                timestamp: Date.now(),
                version: '1.0',
                content: data,
                isDelta: true
            };
        }
    }

    /**
     * Process an AsyncIterable of stream messages into a single response
     */
    private async processAsyncIterable(
        iterable: AsyncIterable<MCPStreamMessage>,
        requestId: string
    ): Promise<MCPResponse> {
        let fullContent = '';
        let toolCalls: MCPToolCall[] = [];
        
        for await (const message of iterable) {
            if (message.content) {
                fullContent += message.content;
            }
            
            if (message.toolCall) {
                // Collect tool calls
                const existingIndex = toolCalls.findIndex(tc => tc.id === message.toolCall?.id);
                
                if (existingIndex >= 0 && message.toolCall.id) {
                    // Update existing tool call
                    toolCalls[existingIndex] = {
                        ...toolCalls[existingIndex],
                        ...message.toolCall
                    } as MCPToolCall;
                } else if (message.toolCall.id && message.toolCall.name) {
                    // Add new tool call
                    toolCalls.push(message.toolCall as MCPToolCall);
                }
            }
        }
        
        return {
            id: requestId,
            type: MCPMessageType.RESPONSE,
            timestamp: Date.now(),
            version: '1.0',
            content: fullContent,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        };
    }

    /**
     * Add authentication headers based on server configuration
     */
    private addAuthHeaders(headers: Record<string, string>, server: MCPServerConfig): void {
        if (!server.authDetails) {
            return;
        }
        
        switch (server.authType) {
            case 'api_key':
                if (server.authDetails.apiKeyName && server.authDetails.apiKey) {
                    headers[server.authDetails.apiKeyName] = server.authDetails.apiKey;
                }
                break;
                
            case 'bearer':
                if (server.authDetails.bearerToken) {
                    headers['Authorization'] = `Bearer ${server.authDetails.bearerToken}`;
                }
                break;
                
            case 'oauth2':
                // OAuth2 would need more complex handling with token refresh, etc.
                if (server.authDetails.bearerToken) {
                    headers['Authorization'] = `Bearer ${server.authDetails.bearerToken}`;
                }
                break;
                
            case 'none':
            default:
                // No auth needed
                break;
        }
    }

    /**
     * Determine what capabilities are required for a request
     */
    private determineRequiredCapabilities(request: MCPRequest): string[] {
        const capabilities: string[] = [];
        
        // Add capability based on the model
        if (request.model) {
            capabilities.push(`model:${request.model}`);
        }
        
        // Add capabilities based on tools
        if (request.tools) {
            for (const tool of request.tools) {
                capabilities.push(`tool:${tool.name}`);
            }
        }
        
        // Add generic capability
        capabilities.push('mcp:basic');
        
        return capabilities;
    }

    /**
     * Find the best server match for the required capabilities
     */
    private findBestServerMatch(requiredCapabilities: string[]): MCPServerConfig | undefined {
        let bestMatch: MCPServerConfig | undefined;
        let bestScore = -1;
        
        for (const server of this.servers.values()) {
            if (!server.isActive) {
                continue;
            }
            
            // Calculate match score
            let score = 0;
            for (const reqCap of requiredCapabilities) {
                // Exact match
                if (server.capabilities.includes(reqCap)) {
                    score += 10;
                    continue;
                }
                
                // Wildcard match
                if (reqCap.includes(':') && server.capabilities.some(cap => 
                    cap.endsWith('*') && reqCap.startsWith(cap.slice(0, -1)))) {
                    score += 5;
                }
            }
            
            // Adjust score by server priority
            score *= (1 + server.priority / 10);
            
            if (score > bestScore) {
                bestScore = score;
                bestMatch = server;
            }
        }
        
        return bestMatch;
    }

    /**
     * Execute a local tool
     */
    private async executeLocalTool(toolName: string, args: any): Promise<any> {
        // Get the handler for this tool
        const handler = this.localHandlers.get(toolName);
        
        if (!handler) {
            throw new Error(`No handler registered for tool: ${toolName}`);
        }
        
        // Execute the tool
        try {
            const result = await handler({
                id: uuidv4(),
                type: MCPMessageType.REQUEST,
                timestamp: Date.now(),
                version: '1.0',
                model: 'local',
                messages: [{
                    role: 'system',
                    content: `Execute ${toolName} with arguments: ${JSON.stringify(args)}`
                }],
                context: {
                    toolCall: {
                        name: toolName,
                        arguments: args
                    }
                }
            });
            
            return result;
        } catch (error) {
            console.error(`Error executing local tool ${toolName}:`, error);
            throw error;
        }
    }

    /**
     * Initialize default tool handlers
     */
    private initializeDefaultHandlers(): void {
        // Register some basic handlers
        this.registerLocalHandler('file:read', async (request) => {
            // Implementation will come later
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: 'File read operation placeholder'
            };
        });
        
        this.registerLocalHandler('file:write', async (request) => {
            // Implementation will come later
            return {
                id: request.id,
                type: MCPMessageType.RESPONSE,
                timestamp: Date.now(),
                version: '1.0',
                content: 'File write operation placeholder'
            };
        });
    }
} 