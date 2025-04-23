/**
 * Model Context Protocol (MCP) - Core Type Definitions
 * 
 * This file contains the core type definitions for the Model Context Protocol,
 * which provides a standardized way for handling AI context and tool operations
 * both internally and with external MCP servers.
 */

/**
 * Base interface for all MCP messages
 */
export interface MCPMessage {
    id: string;
    type: MCPMessageType;
    timestamp: number;
    version: string;
}

/**
 * Supported message types in the MCP
 */
export enum MCPMessageType {
    REQUEST = 'request',
    RESPONSE = 'response',
    ERROR = 'error',
    STREAM = 'stream',
    SYSTEM = 'system'
}

/**
 * Interface for MCP request messages
 */
export interface MCPRequest extends MCPMessage {
    type: MCPMessageType.REQUEST;
    model: string;
    messages: MCPChatMessage[];
    tools?: MCPTool[];
    context?: MCPContext;
    options?: MCPRequestOptions;
    serverName?: string; // Name of the MCP server to route to
}

/**
 * Interface for MCP response messages
 */
export interface MCPResponse extends MCPMessage {
    type: MCPMessageType.RESPONSE;
    content: string;
    toolCalls?: MCPToolCall[];
    usage?: MCPUsage;
}

/**
 * Interface for MCP streaming messages
 */
export interface MCPStreamMessage extends MCPMessage {
    type: MCPMessageType.STREAM;
    content: string;
    isDelta?: boolean;
    toolCall?: Partial<MCPToolCall>;
    isComplete?: boolean;
}

/**
 * Interface for MCP error messages
 */
export interface MCPErrorMessage extends MCPMessage {
    type: MCPMessageType.ERROR;
    error: {
        code: string;
        message: string;
        details?: any;
    };
}

/**
 * Interface for system messages (like heartbeat, config updates)
 */
export interface MCPSystemMessage extends MCPMessage {
    type: MCPMessageType.SYSTEM;
    action: string;
    payload?: any;
}

/**
 * Interface for chat messages within MCP
 */
export interface MCPChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    name?: string;
    id?: string;
    toolCalls?: MCPToolCall[];
    toolCallId?: string; // For tool responses
}

/**
 * Interface for defining tools available to the AI
 */
export interface MCPTool {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties?: Record<string, any>;
        required?: string[];
    };
}

/**
 * Interface for a tool call made by the AI
 */
export interface MCPToolCall {
    id: string;
    name: string;
    arguments: Record<string, any> | string;
    status?: 'pending' | 'success' | 'error';
    result?: any;
}

/**
 * Interface for providing context to the AI
 */
export interface MCPContext {
    project?: {
        name?: string;
        type?: string;
        language?: string;
        dependencies?: string[];
    };
    codebase?: {
        relevantFiles?: Array<{
            path: string;
            content?: string;
            summary?: string;
        }>;
    };
    session?: {
        history?: MCPChatMessage[];
        metadata?: Record<string, any>;
    };
    vscode?: {
        version?: string;
        extensions?: string[];
        settings?: Record<string, any>;
    };
    [key: string]: any;
}

/**
 * Interface for MCP request options
 */
export interface MCPRequestOptions {
    temperature?: number;
    maxTokens?: number;
    streaming?: boolean;
    topP?: number;
    stopSequences?: string[];
    [key: string]: any;
}

/**
 * Interface for token usage information
 */
export interface MCPUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

/**
 * Interface for MCP server configuration
 */
export interface MCPServerConfig {
    name: string;
    endpoint: string;
    capabilities: string[];
    authType: 'none' | 'api_key' | 'bearer' | 'oauth2';
    authDetails?: {
        apiKeyName?: string;
        apiKey?: string;
        bearerToken?: string;
        clientId?: string;
        clientSecret?: string;
        tokenUrl?: string;
    };
    isActive: boolean;
    priority: number;
    description?: string;
} 