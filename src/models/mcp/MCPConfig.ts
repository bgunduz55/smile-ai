import * as vscode from 'vscode';
import { MCPServerConfig } from './types';

/**
 * Manages MCP server configurations
 */
export class MCPConfig {
    private static readonly CONFIG_SECTION = 'smileAI.mcp';
    private static readonly SERVERS_KEY = 'servers';

    /**
     * Get all registered server configurations
     */
    public async getServerConfigurations(): Promise<MCPServerConfig[]> {
        const config = vscode.workspace.getConfiguration(MCPConfig.CONFIG_SECTION);
        const servers = config.get<MCPServerConfig[]>(MCPConfig.SERVERS_KEY, []);
        return servers;
    }

    /**
     * Add a new server configuration
     */
    public async addServerConfiguration(server: MCPServerConfig): Promise<void> {
        const config = vscode.workspace.getConfiguration(MCPConfig.CONFIG_SECTION);
        const servers = config.get<MCPServerConfig[]>(MCPConfig.SERVERS_KEY, []);
        
        // Check if server with same name already exists
        const existingIndex = servers.findIndex(s => s.name === server.name);
        
        if (existingIndex >= 0) {
            // Update existing server
            servers[existingIndex] = server;
        } else {
            // Add new server
            servers.push(server);
        }
        
        await config.update(MCPConfig.SERVERS_KEY, servers, vscode.ConfigurationTarget.Global);
    }

    /**
     * Remove a server configuration
     */
    public async removeServerConfiguration(serverName: string): Promise<void> {
        const config = vscode.workspace.getConfiguration(MCPConfig.CONFIG_SECTION);
        let servers = config.get<MCPServerConfig[]>(MCPConfig.SERVERS_KEY, []);
        
        // Remove server with matching name
        servers = servers.filter(s => s.name !== serverName);
        
        await config.update(MCPConfig.SERVERS_KEY, servers, vscode.ConfigurationTarget.Global);
    }

    /**
     * Get a specific server configuration by name
     */
    public async getServerConfiguration(serverName: string): Promise<MCPServerConfig | undefined> {
        const servers = await this.getServerConfigurations();
        return servers.find(s => s.name === serverName);
    }

    /**
     * Set active state of a server
     */
    public async setServerActive(serverName: string, isActive: boolean): Promise<void> {
        const config = vscode.workspace.getConfiguration(MCPConfig.CONFIG_SECTION);
        const servers = config.get<MCPServerConfig[]>(MCPConfig.SERVERS_KEY, []);
        
        // Find the server
        const serverIndex = servers.findIndex(s => s.name === serverName);
        
        if (serverIndex >= 0) {
            // Update active state
            servers[serverIndex].isActive = isActive;
            
            await config.update(MCPConfig.SERVERS_KEY, servers, vscode.ConfigurationTarget.Global);
        }
    }
} 