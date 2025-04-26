import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { sleep } from '../utils/utils';
import * as WebSocket from 'ws';

// WebSocket tipi için yardımcı değişken
const WebSocketClass = (WebSocket as any).WebSocket || WebSocket;

// WebSocket readyState values as constants with explicit types
const WS_CONNECTING: number = 0;
const WS_OPEN: number = 1;
const WS_CLOSING: number = 2;
const WS_CLOSED: number = 3;

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
    public async connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                console.log('🔄 [MCPClient.connect] Bağlantı girişimi başlatılıyor...');
                
                if (this.socket && (this.socket.readyState as number) === WS_OPEN) {
                    console.log('✅ [MCPClient.connect] Zaten bağlı, yeni bağlantı gerekmiyor');
                    this.isConnected = true;
                    resolve();
                    return;
                }
                
                // Eğer varsa mevcut soketi kapat
                if (this.socket) {
                    console.log('🔄 [MCPClient.connect] Aktif soket bulundu, kapatılıyor...');
                    
                    // Only close the socket if it's not already closing or closed
                    if ((this.socket.readyState as number) !== WS_CLOSING && 
                        (this.socket.readyState as number) !== WS_CLOSED) {
                        try {
                            this.socket.close();
                        } catch (closeError) {
                            console.warn('⚠️ [MCPClient.connect] Error closing existing socket:', closeError);
                        }
                    }
                    this.socket = null;
                }
                
                console.log(`🔄 [MCPClient.connect] WebSocket bağlantısı kuruluyor: ${this.config.serverUrl}`);
                
                // Socket oluşturma ve bağlantı kurma
                try {
                    // WebSocket yerine WebSocketClass kullanıyoruz (TypeScript hatasını gidermek için)
                    this.socket = new WebSocketClass(this.config.serverUrl);
                    console.log('🔄 [MCPClient.connect] WebSocket yapıcısı çağrıldı, socket:', 
                              this.socket ? 'oluşturuldu' : 'null',
                              'readyState:', this.socket ? this.socket.readyState : 'N/A');
                } catch (socketError) {
                    console.error('❌ [MCPClient.connect] WebSocket oluşturulurken hata:', socketError);
                    reject(new Error(`WebSocket creation failed: ${socketError instanceof Error ? socketError.message : String(socketError)}`));
                    return;
                }
                
                // Socket olaylarını dinle
                if (this.socket) {
                    // Define error handler outside the event listeners for reuse
                    const errorHandler = (error: any) => {
                        console.error('❌ [MCPClient.connect] WebSocket error:', error);
                        this.isConnected = false;
                        this.emit('error', error);
                        if (!this.isConnected) {
                            reject(error);
                        }
                    };
                    
                    // Define timeout handler outside for reuse
                    let timeoutId: NodeJS.Timeout;
                    const setConnectionTimeout = () => {
                        timeoutId = setTimeout(() => {
                            console.error('⏱️ [MCPClient.connect] Connection timeout occurred');
                            if (this.socket) {
                                // Remove all listeners before closing to prevent callbacks
                                this.socket.removeAllListeners?.();
                                this.socket.close();
                                this.socket = null;
                            }
                            reject(new Error('Connection timeout'));
                        }, 10000);
                    };
                    
                    // Set the timeout
                    setConnectionTimeout();
                    
                    this.socket.on('open', () => {
                        console.log('🎉 [MCPClient.connect] WebSocket bağlantısı açıldı');
                        this.isConnected = true;
                        this.reconnectAttempts = 0;
                        
                        // Clear the timeout
                        clearTimeout(timeoutId);
                        
                        this.emit('connected');
                        
                        // Socket durumunu kontrol et ve log'a yaz
                        if (this.socket) {
                            console.log('🔄 [MCPClient.connect] WebSocket açıldıktan sonra durum:',
                                      'readyState:', this.socket.readyState || 'N/A',
                                      'bufferedAmount:', this.socket.bufferedAmount || 'N/A');
                            
                            // Send a test query immediately to verify the connection is working properly
                            try {
                                console.log('🧪 [MCPClient.connect] Sending test message to verify connection...');
                                const testMsg: McpMessage = {
                                    id: uuidv4(),
                                    type: McpMessageType.QUERY,
                                    payload: {
                                        query: "Test connection",
                                        test: true
                                    }
                                };
                                
                                const testMessageStr = JSON.stringify(testMsg);
                                console.log('📤 [MCPClient.connect] Test message content:', testMessageStr);
                                
                                // Send the test message
                                this.socket.send(testMessageStr);
                                console.log('✅ [MCPClient.connect] Test message sent successfully');
                            } catch (testError) {
                                console.error('❌ [MCPClient.connect] Error sending test message:', testError);
                                // Don't reject here, we'll still consider the connection successful
                                // But log the error for diagnostics
                            }
                        }
                        
                        resolve();
                    });
                    
                    this.socket.on('message', (data: any) => {
                        // If this is our first message, and we were waiting for a response, 
                        // clear the timeout in case it hasn't triggered yet
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                        }
                        
                        try {
                            console.log('📥 [MCPClient.socket.onmessage] Yanıt alındı, raw data tipi:', typeof data);
                            
                            // WebSocket mesajı parse et - UTF-8 karakter kodlama düzeltmesi
                            let message: McpMessage;
                            let jsonString: string;
                            
                            if (typeof data === 'string') {
                                jsonString = data;
                            } else if (data instanceof Buffer) {
                                jsonString = data.toString('utf8');
                            } else if (typeof data.toString === 'function') {
                                jsonString = data.toString();
                            } else {
                                console.error('❌ [MCPClient.socket.onmessage] Geçersiz mesaj formatı:', typeof data);
                                return;
                            }
                            
                            // UTF-8 karakter sorunlarını kontrol et
                            try {
                                message = JSON.parse(jsonString);
                            } catch (parseError) {
                                console.error('❌ [MCPClient.socket.onmessage] JSON parse hatası, UTF-8 düzeltmesi denenecek:', parseError);
                                // Bazı özel karakter sorunlarını düzeltmeyi deneyelim
                                jsonString = jsonString.replace(/\\u([0-9a-fA-F]{4})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)));
                                message = JSON.parse(jsonString);
                            }
                            
                            // Check for test response
                            if (message.type === McpMessageType.RESPONSE && 
                                message.payload?.result?.test === true) {
                                console.log('✅ [MCPClient.socket.onmessage] Test connection successful!');
                                this.emit('testConnectionSuccess');
                            }
                            
                            // Mesajı işle
                            console.log(`📩 [MCPClient.socket.onmessage] Mesaj alındı, Tip: ${message.type}, ID: ${message.id}`);
                            this.handleMessage(message);
                        } catch (parseError) {
                            console.error('❌ [MCPClient.socket.onmessage] JSON parse hatası:', parseError);
                            console.log('❌ [MCPClient.socket.onmessage] Hata veren data:', typeof data === 'string' ? data.substring(0, 200) : data);
                        }
                    });
                    
                    this.socket.on('error', errorHandler);
                    
                    this.socket.on('close', (code: number, reason: string) => {
                        console.log(`🔌 [MCPClient.socket.onclose] WebSocket bağlantısı kapandı. Kod: ${code}, Neden: ${reason}`);
                        this.isConnected = false;
                        this.socket = null;
                        this.emit('disconnected');
                        
                        // Clear timeout if still active
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                        }
                        
                        // Yeniden bağlantı dene
                        this.attemptReconnect();
                    });
                }
            } catch (error) {
                console.error('❌ [MCPClient.connect] Genel bağlantı hatası:', error);
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
     * Sends a chat message to the server
     */
    public async sendChatMessage(content: string, conversationId: string = 'default', streaming: boolean = true): Promise<any> {
        console.log(`\n📨 [MCPClient.sendChatMessage] Chat mesajı gönderiliyor`);
        console.log(`📝 [MCPClient.sendChatMessage] İçerik: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
        console.log(`🔌 [MCPClient.sendChatMessage] Socket durumu: ${this.socket ? `ReadyState: ${this.socket.readyState}` : 'Socket yok!'}`);
        console.log(`✅ [MCPClient.sendChatMessage] Bağlantı durumu: ${this.isConnected ? 'Bağlı' : 'Bağlı değil'}`);
        console.log(`💨 [MCPClient.sendChatMessage] Streaming: ${streaming ? 'Evet' : 'Hayır'}`);
        
        // More detailed socket diagnostics
        if (this.socket) {
            console.log(`🔍 [MCPClient.sendChatMessage] Socket details: readyState=${this.socket.readyState} (${this.socket.readyState === WS_OPEN ? 'OPEN' : this.socket.readyState === WS_CONNECTING ? 'CONNECTING' : this.socket.readyState === WS_CLOSING ? 'CLOSING' : 'CLOSED'})`);
            console.log(`🔍 [MCPClient.sendChatMessage] Socket bufferedAmount: ${this.socket.bufferedAmount}`);
            console.log(`🔍 [MCPClient.sendChatMessage] Socket protocol: ${this.socket.protocol || 'none'}`);
        }

        // Socket bağlantısı kontrolü
        if (!this.isConnectedToServer()) {
            console.error('❌ [MCPClient.sendChatMessage] SmileAgent Server\'a bağlı değil! Bağlantı kuruluyor...');
            try {
                await this.connect();
                console.log('✅ [MCPClient.sendChatMessage] Bağlantı başarıyla kuruldu, mesaj gönderimi devam edecek');
                
                // Double-check socket status after connection
                console.log(`🔄 [MCPClient.sendChatMessage] Connection reestablished, rechecking socket: ${this.socket ? `ReadyState: ${this.socket.readyState}` : 'Socket still null!'}`);
                console.log(`🔄 [MCPClient.sendChatMessage] isConnected flag: ${this.isConnected}`);
                
                // Ensure we're really connected
                if (!this.socket || this.socket.readyState !== WS_OPEN) {
                    console.error('❌ [MCPClient.sendChatMessage] Reconnection failed to create a valid socket!');
                    throw new Error('Reconnection attempt did not result in an open socket');
                }
            } catch (error) {
                console.error('❌ [MCPClient.sendChatMessage] Bağlantı hatası:', error);
                throw new Error('Unable to connect to SmileAgent Server');
            }
        }
        
        // WebSocket hazır mı?
        if (this.socket?.readyState !== WS_OPEN) {
            console.error(`❌ [MCPClient.sendChatMessage] Socket durumu uygun değil: ${this.socket ? this.socket.readyState : 'Socket yok'}`);
            throw new Error('WebSocket is not in OPEN state');
        }

        // Create message object - CHAT_MESSAGE tipini sabit tut
        const messageId = uuidv4();
        const message: McpMessage = {
            id: messageId,
            type: McpMessageType.CHAT_MESSAGE, // Sabit tip - enum kullan
            payload: {
                content,
                conversationId,
                streaming
            }
        };

        // Double-check that we're using the correct enum value
        console.log(`🔑 [MCPClient.sendChatMessage] Mesaj tipi: ${message.type}`);
        console.log(`🔍 [MCPClient.sendChatMessage] Enum değeri: ${McpMessageType.CHAT_MESSAGE}`);
        console.log(`🧪 [MCPClient.sendChatMessage] Tip kontrolü: ${message.type === McpMessageType.CHAT_MESSAGE ? 'EVET' : 'HAYIR'}`);

        if (streaming) {
            console.log('🔄 [MCPClient.sendChatMessage] Streaming mesaj gönderiliyor, Event emitter bekleniyor');
            
            // Streaming mode - we don't wait for a response from sendMessage
            // Instead we expect 'chat-stream' events to be emitted
            try {
                this.sendMessageWithoutWaiting(message);
                console.log('✅ [MCPClient.sendChatMessage] Streaming mesaj gönderildi, messageId:', messageId);
                
                // Return a promise that will resolve when the streaming is complete
                return new Promise((resolve, reject) => {
                    let fullContent = '';
                    let lastChunk: { content: string; status: string; originalMessageId: string } | null = null;
                    
                    const onStreamData = (data: any) => {
                        console.log(`📥 [MCPClient.sendChatMessage] Stream veri alındı, status: ${data.status}`);
                        
                        // Check if this is a response to our message
                        if (data.originalMessageId === messageId) {
                            if (data.status === 'completed') {
                                console.log('✓ [MCPClient.sendChatMessage] Streaming tamamlandı');
                                
                                // Clean up event listeners
                                this.removeListener('chat-stream', onStreamData);
                                this.removeListener('error', onError);
                                
                                // Resolve with the complete response
                                resolve({
                                    content: data.content || fullContent,
                                    status: 'completed',
                                    messageId
                                });
                            } else if (data.status === 'streaming') {
                                // Update the full content with this chunk
                                fullContent = data.content;
                                lastChunk = data;
                            }
                        } else {
                            console.log(`⚠️ [MCPClient.sendChatMessage] Farklı mesaj için stream alındı: ${data.originalMessageId} (beklenen: ${messageId})`);
                        }
                    };
                    
                    const onError = (error: Error) => {
                        console.error('❌ [MCPClient.sendChatMessage] Stream error:', error);
                        
                        // Clean up event listeners
                        this.removeListener('chat-stream', onStreamData);
                        this.removeListener('error', onError);
                        
                        reject(error);
                    };
                    
                    // Set up event listeners
                    this.on('chat-stream', onStreamData);
                    this.on('error', onError);
                    
                    // Set up a timeout to automatically resolve if we don't get a "completed" status
                    setTimeout(() => {
                        // If we have received something but not the completed event
                        if (lastChunk && !this.listeners('chat-stream').includes(onStreamData)) {
                            console.warn('⚠️ [MCPClient.sendChatMessage] Streaming zaman aşımı, son alınan chunk ile tamamlanıyor');
                            
                            // Clean up event listeners
                            this.removeListener('chat-stream', onStreamData);
                            this.removeListener('error', onError);
                            
                            resolve({
                                content: fullContent,
                                status: 'completed',
                                messageId
                            });
                        }
                    }, 60000); // 60 seconds timeout
                });
            } catch (error) {
                console.error('❌ [MCPClient.sendChatMessage] Streaming mesaj gönderme hatası:', error);
                throw error;
            }
        } else {
            console.log('🔄 [MCPClient.sendChatMessage] Non-streaming mesaj gönderiliyor');
            
            // Non-streaming mode - we wait for a CHAT_RESPONSE message
            try {
                return await this.sendMessage(message);
            } catch (error) {
                console.error('❌ [MCPClient.sendChatMessage] Non-streaming mesaj gönderme hatası:', error);
                throw error;
            }
        }
    }

    /**
     * Bir mesajı yanıt beklemeden gönderir (streaming için)
     */
    private sendMessageWithoutWaiting(message: McpMessage): void {
        // Add debug logging to show more details about the message being sent
        console.log('\n🔍 [MCPClient.sendMessageWithoutWaiting] DEBUG - Message object structure:');
        console.log('🔑 Message ID:', message.id);
        console.log('📝 Message Type:', message.type);
        console.log('📦 Payload:', JSON.stringify(message.payload, null, 2));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Force a fresh socket check rather than relying on class variables
        const isSocketReady = this.socket !== null && (this.socket.readyState as number) === WS_OPEN;
        
        if (!isSocketReady) {
            console.error('❌ [MCPClient.sendMessageWithoutWaiting] Socket is not in OPEN state!');
            console.log(`🔌 [MCPClient.sendMessageWithoutWaiting] Socket details: ${this.socket ? `readyState=${this.socket.readyState} (${(this.socket.readyState as number) === WS_OPEN ? 'OPEN' : (this.socket.readyState as number) === WS_CONNECTING ? 'CONNECTING' : (this.socket.readyState as number) === WS_CLOSING ? 'CLOSING' : 'CLOSED'})` : 'Socket is null'}`);
            
            // Only attempt reconnection if socket is null or closed
            if (!this.socket || (this.socket.readyState as number) === WS_CLOSED) {
                console.log('🔄 [MCPClient.sendMessageWithoutWaiting] Trying to reestablish connection...');
                
                // Convert to Promise-based reconnection with retry
                this.ensureSocketIsReady()
                    .then(socket => {
                        if (socket) {
                            try {
                                const messageStr = JSON.stringify(message);
                                socket.send(messageStr);
                                console.log('✅ [MCPClient.sendMessageWithoutWaiting] Message sent after reconnection');
                            } catch (retryError) {
                                console.error('❌ [MCPClient.sendMessageWithoutWaiting] Failed to send after reconnection:', retryError);
                                this.emit('error', new Error(`Failed to send message after reconnection: ${retryError}`));
                            }
                        } else {
                            console.error('❌ [MCPClient.sendMessageWithoutWaiting] Could not get a ready socket after multiple attempts');
                            this.emit('error', new Error('Could not get a ready socket after multiple attempts'));
                        }
                    })
                    .catch(error => {
                        console.error('❌ [MCPClient.sendMessageWithoutWaiting] Error during reconnection:', error);
                        this.emit('error', new Error(`Reconnection failed: ${error}`));
                    });
                
                return; // Important: Don't throw an error here, just return
            } else if (this.socket && (this.socket.readyState as number) === WS_CONNECTING) {
                // If socket is connecting, wait for it to open and then send
                console.log('⏳ [MCPClient.sendMessageWithoutWaiting] Socket is connecting, will send when ready...');
                
                const onOpen = () => {
                    if (this.socket) {
                        try {
                            const messageStr = JSON.stringify(message);
                            this.socket.send(messageStr);
                            console.log('✅ [MCPClient.sendMessageWithoutWaiting] Message sent after socket connected');
                        } catch (sendError) {
                            console.error('❌ [MCPClient.sendMessageWithoutWaiting] Failed to send after connection:', sendError);
                            this.emit('error', new Error(`Failed to send message after connection: ${sendError}`));
                        }
                        this.socket.removeEventListener('open', onOpen);
                    }
                };
                
                this.socket.addEventListener('open', onOpen);
                return;
            } else {
                // Socket is in CLOSING state, wait and try to reconnect
                console.warn('⚠️ [MCPClient.sendMessageWithoutWaiting] Socket is in CLOSING state, waiting to reconnect...');
                
                setTimeout(() => {
                    this.sendMessageWithoutWaiting(message);
                }, 1000); // Wait 1 second and try again
                
                return;
            }
        }

        try {
            // Socket is ready, send the message
            if (!this.socket) {
                throw new Error("Socket is unexpectedly null");
            }
            
            const messageStr = JSON.stringify(message);
            this.socket.send(messageStr);
            console.log('✅ [MCPClient.sendMessageWithoutWaiting] Message sent successfully');
        } catch (error) {
            console.error('❌ [MCPClient.sendMessageWithoutWaiting] Error sending message:', error);
            this.emit('error', new Error(`Failed to send message: ${error}`));
        }
    }

    /**
     * Ensures that the socket is ready before sending a message
     * Returns a promise that resolves with the ready socket or null if it couldn't be made ready
     */
    private async ensureSocketIsReady(): Promise<WebSocket.WebSocket | null> {
        // Try to connect up to 3 times
        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`🔄 [MCPClient.ensureSocketIsReady] Attempt ${attempt}/3 to get ready socket`);
            
            try {
                await this.connect();
                
                if (this.socket && (this.socket.readyState as number) === 1) {
                    console.log('✅ [MCPClient.ensureSocketIsReady] Socket is now ready');
                    return this.socket;
                } else {
                    console.warn(`⚠️ [MCPClient.ensureSocketIsReady] Socket still not ready after connect() call. State: ${this.socket ? this.socket.readyState : 'null'}`);
                    
                    // If socket is connecting, wait for it to open
                    if (this.socket && (this.socket.readyState as number) === 0) {
                        console.log('⏳ [MCPClient.ensureSocketIsReady] Socket is connecting, waiting for open event...');
                        
                        await new Promise<void>((resolve, reject) => {
                            if (!this.socket) {
                                reject(new Error("Socket is unexpectedly null"));
                                return;
                            }
                            
                            const onOpen = () => {
                                this.socket?.removeEventListener('open', onOpen);
                                this.socket?.removeEventListener('error', onError);
                                resolve();
                            };
                            
                            const onError = (error: any) => {
                                this.socket?.removeEventListener('open', onOpen);
                                this.socket?.removeEventListener('error', onError);
                                reject(error);
                            };
                            
                            this.socket.addEventListener('open', onOpen);
                            this.socket.addEventListener('error', onError);
                            
                            // Set a timeout in case the socket never opens
                            setTimeout(() => {
                                this.socket?.removeEventListener('open', onOpen);
                                this.socket?.removeEventListener('error', onError);
                                reject(new Error("Socket connection timeout"));
                            }, 5000);
                        });
                        
                        if (this.socket && (this.socket.readyState as number) === 1) {
                            console.log('✅ [MCPClient.ensureSocketIsReady] Socket is now open after waiting');
                            return this.socket;
                        }
                    }
                }
            } catch (error) {
                console.error(`❌ [MCPClient.ensureSocketIsReady] Connection attempt ${attempt} failed:`, error);
            }
            
            // Wait before next attempt
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.error('❌ [MCPClient.ensureSocketIsReady] Failed to get ready socket after 3 attempts');
        return null;
    }

    /**
     * Mesajı sunucuya gönderir ve yanıtı bekler
     */
    private async sendMessage(message: McpMessage): Promise<any> {
        console.log(`\n📤 [MCPClient.sendMessage] Mesaj gönderiliyor, ID: ${message.id}, Tip: ${message.type}`);
        
        if (!this.isConnectedToServer()) {
            console.error('❌ [MCPClient.sendMessage] SmileAgent Server\'a bağlı değil veya soket hazır değil');
            throw new Error('Not connected to SmileAgent Server');
        }
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.error(`⏱️ [MCPClient.sendMessage] Yanıt zaman aşımına uğradı, ID: ${message.id}`);
                
                if (this.pendingMessages.has(message.id)) {
                    this.pendingMessages.delete(message.id);
                    reject(new Error('Response timeout'));
                }
            }, 30000); // 30 saniye zaman aşımı
            
            this.pendingMessages.set(message.id, {
                resolve,
                reject,
                timeout
            });
            
            try {
                this.sendMessageWithoutWaiting(message);
                console.log('✅ [MCPClient.sendMessage] Mesaj başarıyla gönderildi, yanıt bekleniyor...');
            } catch (error) {
                console.error('❌ [MCPClient.sendMessage] Mesaj gönderirken hata:', error);
                clearTimeout(timeout);
                this.pendingMessages.delete(message.id);
                reject(error);
            }
        });
    }

    /**
     * Sunucudan gelen mesajları işler
     */
    private handleMessage(message: McpMessage): void {
        // Enhanced debugging for incoming messages
        console.log(`\n🔍 [MCPClient.handleMessage] DEBUG - Incoming message details:`);
        console.log(`🆔 Message ID: ${message.id}`);
        console.log(`📋 Message Type: ${message.type}`);
        console.log(`📦 Payload preview: ${JSON.stringify(message.payload).substring(0, 300)}...`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        this.emit('message', message);

        console.log(`\n🔍 [MCPClient.handleMessage] Alınan mesaj tipi: ${message.type}`);
        console.log(`📄 [MCPClient.handleMessage] Detaylar: ${JSON.stringify(message.payload).substring(0, 100)}...`);

        switch (message.type) {
            case McpMessageType.INIT:
                console.log('🚀 [MCPClient.handleMessage] Init mesajı alındı');
                
                // İlk bağlantı sonrası test sorgusu yapalım
                if (message.payload.message && message.payload.message.includes('Connected to SmileAgent Server')) {
                    console.log('✅ [MCPClient.handleMessage] Başarılı bağlantı mesajı alındı');
                    
                    // Eğer bekleyen mesaj varsa, yeniden göndermeyi dene
                    if (this.pendingMessages.size > 0) {
                        console.log(`⚠️ [MCPClient.handleMessage] ${this.pendingMessages.size} bekleyen mesaj var. Bunları göndermeyi yeniden deneyeceğiz...`);
                        
                        // 1 saniye sonra çalıştır
                        setTimeout(() => {
                            // Kullanıcıya hata bildirimi sunma, çünkü arka planda yeniden deneyeceğiz
                            console.log("🔄 [MCPClient.handleMessage] Sorgu yeniden gönderilecek...");
                        }, 1000);
                    }
                }
                this.emit('init', message.payload);
                break;
            case McpMessageType.RESPONSE:
                this.handleResponseMessage(message);
                break;
            case McpMessageType.ERROR:
                this.handleErrorMessage(message);
                break;
            case McpMessageType.CHAT_RESPONSE:
                console.log('💬 [MCPClient.handleMessage] Chat yanıtı alındı');
                console.log('🔍 [MCPClient.handleMessage] DEBUG - Chat response payload:', JSON.stringify(message.payload, null, 2));
                this.handleChatResponseMessage(message);
                break;
            case McpMessageType.CHAT_STREAM:
                console.log('📲 [MCPClient.handleMessage] Chat stream chunk alındı');
                console.log('🔍 [MCPClient.handleMessage] DEBUG - Chat stream payload:', JSON.stringify(message.payload, null, 2));
                this.handleChatStreamMessage(message.payload);
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
            console.error(`💬 [MCPClient.handleErrorMessage] Hata mesajı: ${message.payload.message}`);
            console.error(`📄 [MCPClient.handleErrorMessage] Detaylar: ${JSON.stringify(message.payload.details).substring(0, 100)}...`);
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        } else {
            console.warn('⚠️ [MCPClient.handleErrorMessage] Bekleyen istek bulunamadı veya eşleşme yok, ID:', originalMessageId || 'undefined');
        }
    }

    /**
     * Chat yanıtı mesajlarını işler
     */
    private handleChatResponseMessage(message: McpMessage): void {
        console.log('💬 [MCPClient.handleChatResponseMessage] Chat yanıtı mesajı işleniyor...');
        
        const originalMessageId = message.payload.originalMessageId;
        if (originalMessageId && this.pendingMessages.has(originalMessageId)) {
            console.log('✅ [MCPClient.handleChatResponseMessage] Bekleyen istek bulundu, ID:', originalMessageId);
            
            const pendingMessage = this.pendingMessages.get(originalMessageId)!;
            clearTimeout(pendingMessage.timeout);
            this.pendingMessages.delete(originalMessageId);
            
            console.log('\n💬 [MCPClient.handleChatResponseMessage] Chat yanıtı alındı:');
            console.log(`💬 [MCPClient.handleChatResponseMessage] Yanıt: ${message.payload.message.substring(0, 50)}${message.payload.message.length > 50 ? '...' : ''}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            pendingMessage.resolve(message.payload.message);
        } else {
            console.warn('⚠️ [MCPClient.handleChatResponseMessage] Bekleyen istek bulunamadı veya eşleşme yok, ID:', originalMessageId || 'undefined');
        }
    }

    /**
     * Chat stream mesajlarını işler
     */
    private handleChatStreamMessage(payload: any): void {
        console.log('📲 [MCPClient.handleChatStreamMessage] Chat stream mesajı işleniyor...');
        console.log(`🔍 [MCPClient.handleChatStreamMessage] DEBUG - Payload:`, JSON.stringify(payload, null, 2));
        
        // Received stream chunk will always emit an event rather than resolve a promise
        this.emit('chat-stream', payload);
        console.log(`📢 [MCPClient.handleChatStreamMessage] 'chat-stream' event emitted with status: ${payload.status}`);
        
        // If this is a final chunk (completed status), and there is a pending message, resolve it
        const originalMessageId = payload.originalMessageId;
        if (payload.status === 'completed' && originalMessageId && this.pendingMessages.has(originalMessageId)) {
            console.log('✅ [MCPClient.handleChatStreamMessage] Bekleyen istek tamamlandı, ID:', originalMessageId);
            
            const pendingMessage = this.pendingMessages.get(originalMessageId)!;
            clearTimeout(pendingMessage.timeout);
            this.pendingMessages.delete(originalMessageId);
            
            pendingMessage.resolve(payload);
        } else if (payload.status === 'completed') {
            console.log('ℹ️ [MCPClient.handleChatStreamMessage] Tamamlanan mesaj için bekleyen istek bulunamadı, ID:', originalMessageId || 'undefined');
        }
    }

    /**
     * Sunucuya bağlantı kontrolü
     */
    public isConnectedToServer(): boolean {
        // Enhanced socket check for better reliability
        const socketIsValid = this.socket !== null && 
                             (this.socket.readyState as number) === WS_OPEN;
        
        // Check if our internal state agrees with the socket state
        if (this.isConnected !== socketIsValid) {
            console.warn(`⚠️ [MCPClient.isConnectedToServer] Inconsistent connection state detected!`);
            console.warn(`⚠️ [MCPClient.isConnectedToServer] this.isConnected=${this.isConnected}, but socket is ${socketIsValid ? 'valid' : 'invalid'}`);
            console.warn(`⚠️ [MCPClient.isConnectedToServer] Socket details: ${this.socket ? `readyState=${this.socket.readyState}` : 'Socket is null'}`);
            
            // Update our flag to match reality - otherwise we'll continuously try to reconnect
            this.isConnected = socketIsValid;
        }
        
        return this.isConnected;
    }

    /**
     * Yeniden bağlantı dene
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts < this.config.maxReconnectAttempts!) {
            this.reconnectAttempts++;
            console.log(`🔄 [MCPClient.attemptReconnect] ${this.reconnectAttempts}. bağlantı denemesi...`);
            this.connect().then(() => {
                console.log('✅ [MCPClient.attemptReconnect] Bağlantı başarıyla kuruldu');
            }).catch((error) => {
                console.error('❌ [MCPClient.attemptReconnect] Bağlantı kurulurken hata:', error);
                setTimeout(() => this.attemptReconnect(), this.config.reconnectInterval!);
            });
        } else {
            console.error('❌ [MCPClient.attemptReconnect] Maksimum bağlantı deneme sayısına ulaşıldı');
            this.emit('error', new Error('Maximum reconnection attempts reached'));
        }
    }

    /**
     * Dispose method
     */
    public dispose(): void {
        this.disconnect();
    }
}
