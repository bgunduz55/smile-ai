import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { sleep } from '../utils/utils';
import * as WebSocket from 'ws';

// WebSocket tipi için yardımcı değişken
const WebSocketClass = (WebSocket as any).WebSocket || WebSocket;

// WebSocket readyState values as constants
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

// MCP Mesaj Tipleri
export enum McpMessageType {
    INIT = 'init',
    QUERY = 'query',
    RESPONSE = 'response',
    ERROR = 'error',
    FILE_READ = 'file_read',
    FILE_WRITE = 'file_write',
    CODE_ANALYSIS = 'code_analysis',
    COMMAND_EXECUTION = 'command_execution',
    CHAT_MESSAGE = 'chat_message',
    CHAT_RESPONSE = 'chat_response',
    CHAT_STREAM = 'chat_stream',
}

// Server side task types
export enum AgentTaskType {
    CODE_COMPLETION = 'code_completion',
    CODE_EXPLANATION = 'code_explanation',
    CODE_REFACTOR = 'code_refactor',
    CODE_REVIEW = 'code_review',
    CODE_GENERATION = 'code_generation',
    COMMAND_EXECUTION = 'command_execution',
}

// MCP Mesajı
export interface McpMessage {
    id: string;
    type: McpMessageType;
    payload: any;
}

// MCP İstemci yapılandırması
export interface McpClientConfig {
    serverUrl: string;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
}

/**
 * SmileAgent Server ile iletişim kuran MCP istemci sınıfı
 */
export class MCPClient extends EventEmitter implements vscode.Disposable {
    private socket: WebSocket.WebSocket | null = null;
    private isConnected = false;
    private reconnectAttempts = 0;
    private pendingMessages: Map<string, {
        resolve: (value: any) => void;
        reject: (reason: any) => void;
        timeout: NodeJS.Timeout;
    }> = new Map();
    private config: McpClientConfig;

    constructor(config: McpClientConfig) {
        super();
        this.config = {
            reconnectInterval: 5000,
            maxReconnectAttempts: 5,
            ...config
        };
    }

    /**
     * Sunucuya bağlanır
     */
    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.isConnected) {
                resolve();
                return;
            }

            try {
                // WebSocket oluşturma düzeltmesi
                this.socket = new WebSocketClass(this.config.serverUrl);
                
                // Bağlantı için zaman aşımı ayarla
                const connectionTimeoutPromise = new Promise<boolean>((_, reject) => {
                    setTimeout(() => {
                        if (this.socket && this.socket.readyState as number !== WS_OPEN) {
                            console.error('⏱️ [MCPClient.connect] Bağlantı zaman aşımına uğradı');
                            reject('Bağlantı zaman aşımına uğradı');
                        }
                    }, 10000); // 10 saniye zaman aşımı
                });
                
                // WebSocket olaylarını dinle ve bağlantının açılmasını bekle
                const connectionPromise = new Promise<boolean>((resolve) => {
                    if (this.socket) {
                        this.socket.onopen = () => {
                            resolve(true);
                        };
                        
                        this.socket.onclose = (event) => {
                            console.log(`🔌 [MCPClient.close] WebSocket bağlantısı kapatıldı, code: ${event.code}, reason: ${event.reason}`);
                            this.isConnected = false;
                            this.emit('disconnected');
                            resolve(false);
                        };
                        
                        this.socket.onerror = (error) => {
                            console.error('❌ [MCPClient.error] WebSocket bağlantı hatası:', error);
                            // Error'da resolve etmeyelim, close'da resolve edilecek
                        };
                    }
                });
                
                Promise.race([connectionTimeoutPromise, connectionPromise])
                    .then(result => {
                        if (result) {
                            this.isConnected = true;
                            this.reconnectAttempts = 0;
                            console.log('🎉 [MCPClient.connect] WebSocket bağlantısı açıldı');
                            vscode.window.setStatusBarMessage('Connected to SmileAgent Server', 3000);
                            this.emit('connected');
                            resolve();
                        }
                    })
                    .catch(error => {
                        console.error('❌ [MCPClient.connect] Bağlantı kurulurken hata:', error);
                        this.emit('error', error);
                        reject(error);
                    });
            } catch (error) {
                console.error('❌ [MCPClient.connect] WebSocket oluşturma hatası:', error);
                this.emit('error', error);
                reject(error);
            }
        });
    }

    /**
     * Sunucu bağlantısını kapatır
     */
    public disconnect(): void {
        console.log('🔄 [MCPClient.disconnect] WebSocket bağlantısı kapatılıyor');
        if (this.socket && this.isConnected) {
            this.socket.close();
            this.isConnected = false;
            this.socket = null;
            console.log('✅ [MCPClient.disconnect] WebSocket bağlantısı başarıyla kapatıldı');
        } else {
            console.log('ℹ️ [MCPClient.disconnect] Kapatılacak aktif bağlantı yok');
        }
    }

    /**
     * Sorgu mesajı gönderir ve yanıtı bekler
     */
    public async sendQuery(query: string, context: any = {}, taskType: string = AgentTaskType.CODE_GENERATION): Promise<any> {
        console.log('\n📤 [MCPClient.sendQuery] MCP Sorgusu gönderiliyor:');
        console.log(`💬 [MCPClient.sendQuery] Sorgu: ${query.substring(0, 50)}${query.length > 50 ? '...' : ''}`);
        console.log(`📋 [MCPClient.sendQuery] Task Tipi: ${taskType}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Bağlantı kontrolü
        if (!this.isConnectedToServer()) {
            console.error('❌ [MCPClient.sendQuery] Server\'a bağlantı yok!');
            throw new Error('Not connected to SmileAgent Server');
        }

        const messageId = uuidv4();
        const message: McpMessage = {
            id: messageId,
            type: McpMessageType.QUERY,
            payload: {
                query,
                context,
                taskType
            }
        };

        return this.sendMessage(message);
    }

    /**
     * Dosya okuma mesajı gönderir
     */
    public async readFile(filePath: string): Promise<string> {
        const messageId = uuidv4();
        const message: McpMessage = {
            id: messageId,
            type: McpMessageType.FILE_READ,
            payload: {
                path: filePath
            }
        };

        const response = await this.sendMessage(message);
        return response.content;
    }

    /**
     * Dosya yazma mesajı gönderir
     */
    public async writeFile(filePath: string, content: string): Promise<boolean> {
        const messageId = uuidv4();
        const message: McpMessage = {
            id: messageId,
            type: McpMessageType.FILE_WRITE,
            payload: {
                path: filePath,
                content
            }
        };

        const response = await this.sendMessage(message);
        return response.success;
    }

    /**
     * Kod analizi mesajı gönderir
     */
    public async analyzeCode(code: string, language: string): Promise<any> {
        const messageId = uuidv4();
        const message: McpMessage = {
            id: messageId,
            type: McpMessageType.CODE_ANALYSIS,
            payload: {
                code,
                language
            }
        };

        return this.sendMessage(message);
    }

    /**
     * Komut yürütme mesajı gönderir
     */
    public async executeCommand(command: string, workingDirectory?: string): Promise<any> {
        const messageId = uuidv4();
        const message: McpMessage = {
            id: messageId,
            type: McpMessageType.COMMAND_EXECUTION,
            payload: {
                command,
                workingDirectory
            }
        };

        return this.sendMessage(message);
    }

    /**
     * Chat mesajı gönderir
     */
    public async sendChatMessage(content: string, conversationId: string = 'default', streaming: boolean = true): Promise<any> {
        console.log('\n📤 [MCPClient.sendChatMessage] Chat mesajı gönderiliyor');
        console.log(`💬 [MCPClient.sendChatMessage] İçerik: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
        console.log(`🏷️ [MCPClient.sendChatMessage] Conversation ID: ${conversationId}`);
        console.log(`🔄 [MCPClient.sendChatMessage] Streaming: ${streaming}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Bağlantı kontrolü
        if (!this.isConnectedToServer()) {
            console.error('❌ [MCPClient.sendChatMessage] Server\'a bağlantı yok!');
            throw new Error('Not connected to SmileAgent Server');
        }

        const messageId = uuidv4();
        const message: McpMessage = {
            id: messageId,
            type: McpMessageType.CHAT_MESSAGE,
            payload: {
                content,
                conversationId,
                streaming
            }
        };

        try {
            if (!streaming) {
                // Non-streaming mode uses regular message flow
                return await this.sendMessage(message, 120000); // Extend timeout to 120 seconds
            } else {
                // Streaming mode emits events instead of waiting for a complete response
                this.sendMessageWithoutWaiting(message);
                
                // Return the message ID so caller can match response events
                return { messageId, status: 'sent' };
            }
        } catch (error) {
            console.error('❌ [MCPClient.sendChatMessage] Mesaj gönderme hatası:', error);
            throw error;
        }
    }

    /**
     * Bir mesajı yanıt beklemeden gönderir (streaming için)
     */
    private sendMessageWithoutWaiting(message: McpMessage): void {
        if (!this.isConnected || !this.socket) {
            console.error('❌ [MCPClient.sendMessageWithoutWaiting] SmileAgent Server\'a bağlı değil');
            throw new Error('Not connected to SmileAgent Server');
        }

        try {
            console.log('📤 [MCPClient.sendMessageWithoutWaiting] Mesaj gönderiliyor, ID:', message.id);
            const messageStr = JSON.stringify(message);
            this.socket!.send(messageStr);
            console.log('✅ [MCPClient.sendMessageWithoutWaiting] Mesaj başarıyla gönderildi');
        } catch (error) {
            console.error('❌ [MCPClient.sendMessageWithoutWaiting] Mesaj gönderme hatası:', error);
            throw error;
        }
    }

    /**
     * Sunucudan gelen mesajları işler
     */
    private handleMessage(message: McpMessage): void {
        this.emit('message', message);

        console.log(`\n🔍 [MCPClient.handleMessage] Alınan mesaj tipi: ${message.type}`);
        console.log(`📄 [MCPClient.handleMessage] Detaylar: ${JSON.stringify(message.payload).substring(0, 100)}...`);

        switch (message.type) {
            case McpMessageType.RESPONSE:
                this.handleResponseMessage(message);
                break;
            case McpMessageType.ERROR:
                this.handleErrorMessage(message);
                break;
            case McpMessageType.INIT:
                console.log("🚀 [MCPClient.handleMessage] Server bağlantısı başlatıldı!");
                // Init durumunda bir sorgu mesajı varsa, originalMessageId olabilir
                if (message.payload && message.payload.originalMessageId) {
                    // Var olan sorguya cevap olarak INIT mesajı gelmiş
                    const originalMessageId = message.payload.originalMessageId;
                    if (this.pendingMessages.has(originalMessageId)) {
                        const pendingMessage = this.pendingMessages.get(originalMessageId)!;
                        console.log("⚠️ [MCPClient.handleMessage] Init mesajı, bekleyen bir sorguya yanıt olarak geldi! ID:", originalMessageId);
                        
                        // Bağlantı sonrası bir süre bekleyip sorguyu yeniden gönderelim
                        setTimeout(() => {
                            // Eğer bekleyen bir istek varsa, timeout'u iptal et
                            clearTimeout(pendingMessage.timeout);
                            this.pendingMessages.delete(originalMessageId);
                            
                            // Kullanıcıya hata bildirimi sunma, çünkü arka planda yeniden deneyeceğiz
                            console.log("🔄 [MCPClient.handleMessage] Sorgu yeniden gönderilecek...");
                        }, 1000);
                    }
                }
                this.emit('init', message.payload);
                break;
            case McpMessageType.CHAT_RESPONSE:
                console.log('💬 [MCPClient.handleMessage] Chat yanıtı alındı');
                this.handleChatResponseMessage(message);
                break;
            case McpMessageType.CHAT_STREAM:
                console.log('📲 [MCPClient.handleMessage] Chat stream chunk alındı');
                this.handleChatStreamMessage(message);
                break;
            default:
                console.log(`⚠️ [MCPClient.handleMessage] İşlenmeyen mesaj tipi: ${message.type}`);
        }
    }

    /**
     * Yanıt mesajlarını işler
     */
    private handleResponseMessage(message: McpMessage): void {
        console.log('📥 [MCPClient.handleResponseMessage] Yanıt mesajı işleniyor...');
        
        const originalMessageId = message.payload.originalQueryId;
        if (originalMessageId && this.pendingMessages.has(originalMessageId)) {
            console.log('✅ [MCPClient.handleResponseMessage] Bekleyen istek bulundu, ID:', originalMessageId);
            
            const pendingMessage = this.pendingMessages.get(originalMessageId)!;
            clearTimeout(pendingMessage.timeout);
            this.pendingMessages.delete(originalMessageId);
            
            console.log('\n📥 [MCPClient.handleResponseMessage] MCP yanıtı alındı:');
            if (message.payload.result && message.payload.result.message) {
                console.log(`💬 [MCPClient.handleResponseMessage] Yanıt: ${message.payload.result.message.substring(0, 50)}${message.payload.result.message.length > 50 ? '...' : ''}`);
            } else if (message.payload.result) {
                console.log(`💬 [MCPClient.handleResponseMessage] Yanıt: ${JSON.stringify(message.payload.result).substring(0, 100)}...`);
            } else {
                console.log('⚠️ [MCPClient.handleResponseMessage] Yanıt içeriği yok veya boş');
            }
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            pendingMessage.resolve(message.payload.result);
        } else {
            console.warn('⚠️ [MCPClient.handleResponseMessage] Bekleyen istek bulunamadı veya eşleşme yok, ID:', originalMessageId || 'undefined');
        }
    }

    /**
     * Hata mesajlarını işler
     */
    private handleErrorMessage(message: McpMessage): void {
        console.error('❌ [MCPClient.handleErrorMessage] Hata mesajı alındı');
        
        const originalMessageId = message.payload.originalMessageId;
        if (originalMessageId && this.pendingMessages.has(originalMessageId)) {
            console.log('✅ [MCPClient.handleErrorMessage] Bekleyen istek bulundu, ID:', originalMessageId);
            
            const pendingMessage = this.pendingMessages.get(originalMessageId)!;
            clearTimeout(pendingMessage.timeout);
            this.pendingMessages.delete(originalMessageId);
            
            console.error('\n❌ [MCPClient.handleErrorMessage] MCP hata mesajı alındı:');
            console.error(`🛑 [MCPClient.handleErrorMessage] Hata: ${message.payload.message}`);
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            pendingMessage.reject(new Error(message.payload.message));
        } else {
            console.warn('⚠️ [MCPClient.handleErrorMessage] Bekleyen istek bulunamadı veya eşleşme yok, ID:', originalMessageId || 'undefined');
            console.error(`🛑 [MCPClient.handleErrorMessage] Genel hata: ${message.payload.message}`);
        }
        this.emit('error', new Error(message.payload.message));
    }

    /**
     * Chat yanıt mesajlarını işler
     */
    private handleChatResponseMessage(message: McpMessage): void {
        const originalMessageId = message.payload.originalMessageId;
        
        // Eğer bekleyen bir mesaj varsa resolve et
        if (originalMessageId && this.pendingMessages.has(originalMessageId)) {
            const pendingMessage = this.pendingMessages.get(originalMessageId)!;
            clearTimeout(pendingMessage.timeout);
            this.pendingMessages.delete(originalMessageId);
            
            if (message.payload.status === 'completed') {
                pendingMessage.resolve(message.payload);
            }
        }
        
        // Olayı yayınla
        this.emit('chat-response', message.payload);
    }

    /**
     * Chat stream mesajlarını işler
     */
    private handleChatStreamMessage(message: McpMessage): void {
        try {
            // Stream olaylarını yayınla
            console.log(`💬 [MCPClient.handleChatStreamMessage] Stream parçası alındı, status: ${message.payload.status}`);
            this.emit('chat-stream', message.payload);
        } catch (error) {
            console.error('❌ [MCPClient.handleChatStreamMessage] Stream işleme hatası:', error);
        }
    }

    /**
     * Yeniden bağlanma denemesi yapar
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 5)) {
            console.error('Max reconnection attempts reached');
            this.emit('reconnectFailed');
            return;
        }

        this.reconnectAttempts++;
        setTimeout(() => {
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
            this.connect()
                .then(() => console.log('Reconnected successfully'))
                .catch(error => console.error('Reconnection failed:', error));
        }, this.config.reconnectInterval);
    }

    /**
     * Bağlantı durumunu kontrol eder
     */
    public isConnectedToServer(): boolean {
        const connected = this.isConnected && this.socket !== null;
        console.log('🔌 [MCPClient.isConnectedToServer] WebSocket bağlantı durumu:', 
                   connected ? 'Bağlı' : 'Bağlı değil', 
                   '(socket:', this.socket ? 'Var' : 'Yok', 
                   'isConnected:', this.isConnected, ')');
        return connected;
    }

    /**
     * Sunucuya mesaj gönderir ve yanıtı bekler
     */
    private async sendMessage(message: McpMessage, timeoutMs: number = 120000): Promise<any> {
        if (!this.isConnected || !this.socket) {
            console.error('❌ [MCPClient.sendMessage] SmileAgent Server\'a bağlı değil');
            throw new Error('Not connected to SmileAgent Server');
        }

        return new Promise((resolve, reject) => {
            try {
                console.log('📤 [MCPClient.sendMessage] Mesaj gönderiliyor, ID:', message.id);
                const messageStr = JSON.stringify(message);
                this.socket!.send(messageStr);
                console.log('✅ [MCPClient.sendMessage] Mesaj başarıyla gönderildi');

                // Yanıt için bekleyecek Promise oluştur
                const timeout = setTimeout(() => {
                    if (this.pendingMessages.has(message.id)) {
                        console.error('⏱️ [MCPClient.sendMessage] Zaman aşımı, ID:', message.id);
                        this.pendingMessages.delete(message.id);
                        reject(new Error(`Request timed out after ${timeoutMs}ms`));
                    }
                }, timeoutMs);

                console.log('⏳ [MCPClient.sendMessage] Mesaj bekleyenler listesine ekleniyor, ID:', message.id);
                this.pendingMessages.set(message.id, {
                    resolve,
                    reject,
                    timeout
                });
            } catch (error) {
                console.error('❌ [MCPClient.sendMessage] Mesaj gönderme hatası:', error);
                reject(error);
            }
        });
    }

    dispose(): void {
        this.disconnect();
    }
} 