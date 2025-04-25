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
    public async connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                console.log('🔄 [MCPClient.connect] Bağlantı girişimi başlatılıyor...');
                
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    console.log('✅ [MCPClient.connect] Zaten bağlı, yeni bağlantı gerekmiyor');
                    this.isConnected = true;
                    resolve();
                    return;
                }
                
                // Eğer varsa mevcut soketi kapat
                if (this.socket) {
                    console.log('🔄 [MCPClient.connect] Aktif soket bulundu, kapatılıyor...');
                    this.socket.close();
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
                    this.socket.on('open', () => {
                        console.log('🎉 [MCPClient.connect] WebSocket bağlantısı açıldı');
                        this.isConnected = true;
                        this.reconnectAttempts = 0;
                        this.emit('connected');
                        
                        // Socket durumunu kontrol et ve log'a yaz
                        if (this.socket) {
                            console.log('🔄 [MCPClient.connect] WebSocket açıldıktan sonra durum:',
                                      'readyState:', this.socket.readyState || 'N/A',
                                      'bufferedAmount:', this.socket.bufferedAmount || 'N/A');
                            
                            // Test mesajını kaldırıyoruz çünkü server ping-test mesajını desteklemiyor
                        }
                        
                        resolve();
                    });
                    
                    this.socket.on('message', (data: any) => {
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
                            
                            // ping-test kontrolünü kaldırdık
                            
                            // Mesajı işle
                            console.log(`📩 [MCPClient.socket.onmessage] Mesaj alındı, Tip: ${message.type}, ID: ${message.id}`);
                            this.handleMessage(message);
                        } catch (parseError) {
                            console.error('❌ [MCPClient.socket.onmessage] JSON parse hatası:', parseError);
                            console.log('❌ [MCPClient.socket.onmessage] Hata veren data:', typeof data === 'string' ? data.substring(0, 200) : data);
                        }
                    });
                    
                    this.socket.on('error', (error: any) => {
                        console.error('❌ [MCPClient.socket.onerror] WebSocket hatası:', error);
                        this.emit('error', error);
                        if (!this.isConnected) {
                            reject(error);
                        }
                    });
                    
                    this.socket.on('close', (code: number, reason: string) => {
                        console.log(`🔌 [MCPClient.socket.onclose] WebSocket bağlantısı kapandı. Kod: ${code}, Neden: ${reason}`);
                        this.isConnected = false;
                        this.socket = null;
                        this.emit('disconnected');
                        
                        // Yeniden bağlantı dene
                        this.attemptReconnect();
                    });
                    
                    // Zaman aşımı ekle
                    const timeout = setTimeout(() => {
                        if (!this.isConnected) {
                            console.error('⏱️ [MCPClient.connect] Bağlantı zaman aşımına uğradı');
                            if (this.socket) {
                                this.socket.close();
                                this.socket = null;
                            }
                            reject(new Error('Connection timeout'));
                        }
                    }, 10000); // 10 saniye zaman aşımı
                    
                    // Zaman aşımını temizle (bağlantı kurulursa ya da hata alınırsa)
                    this.socket.once('open', () => clearTimeout(timeout));
                    this.socket.once('error', () => clearTimeout(timeout));
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
     * Chat mesajı gönderir
     */
    public async sendChatMessage(content: string, conversationId: string = 'default', streaming: boolean = true): Promise<any> {
        console.log('\n📤 [MCPClient.sendChatMessage] Chat mesajı gönderiliyor');
        console.log(`💬 [MCPClient.sendChatMessage] İçerik: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
        console.log(`🏷️ [MCPClient.sendChatMessage] Conversation ID: ${conversationId}`);
        console.log(`🔄 [MCPClient.sendChatMessage] Streaming: ${streaming}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Bağlantı kontrolü - daha detaylı hata raporlama ve durumu
        console.log(`🔌 [MCPClient.sendChatMessage] Socket durumu: ${this.socket ? 'Var' : 'Yok'}`);
        console.log(`🔌 [MCPClient.sendChatMessage] isConnected flag: ${this.isConnected}`);
        
        if (this.socket) {
            console.log(`🔌 [MCPClient.sendChatMessage] Socket readyState: ${this.socket.readyState}`);
            console.log(`🔌 [MCPClient.sendChatMessage] Socket bufferedAmount: ${this.socket.bufferedAmount}`);
        }
        
        // Geliştirilmiş bağlantı kontrolü
        if (!this.socket) {
            console.error('❌ [MCPClient.sendChatMessage] Socket oluşturulmamış!');
            try {
                console.log('🔄 [MCPClient.sendChatMessage] Socket oluşturulmamış, bağlantı kuruluyor...');
                await this.connect();
                console.log('✅ [MCPClient.sendChatMessage] Bağlantı başarılı, mesaj gönderimine devam ediliyor');
            } catch (connectError) {
                console.error('❌ [MCPClient.sendChatMessage] Bağlantı hatası:', connectError);
                throw new Error('Could not connect to SmileAgent Server');
            }
        } else if (this.socket.readyState !== WS_OPEN) {
            console.error(`❌ [MCPClient.sendChatMessage] Socket var ama hazır değil. readyState: ${this.socket.readyState}`);
            // Socket durumuna göre farklı işlem yap
            if (this.socket.readyState === WS_CONNECTING) {
                console.log('⏳ [MCPClient.sendChatMessage] Socket bağlanıyor, bağlantı tamamlanması bekleniyor...');
                try {
                    // Bağlantının tamamlanmasını bekleyelim (max 5 saniye)
                    await new Promise<void>((resolve, reject) => {
                        // Bağlantı zaten kurulmaya çalışılıyor, tamamlanmasını bekleyelim
                        const timeout = setTimeout(() => {
                            reject(new Error('Connection timeout while waiting for socket to connect'));
                        }, 5000);
                        
                        // Açılma olayını dinle
                        this.socket!.once('open', () => {
                            clearTimeout(timeout);
                            resolve();
                        });
                        
                        // Hata olayını dinle
                        this.socket!.once('error', (err) => {
                            clearTimeout(timeout);
                            reject(err);
                        });
                    });
                    console.log('✅ [MCPClient.sendChatMessage] Socket bağlantısı başarıyla tamamlandı');
                } catch (waitError) {
                    console.error('❌ [MCPClient.sendChatMessage] Socket bağlantısı beklenirken hata:', waitError);
                    throw new Error('Connection timeout while waiting for socket to connect');
                }
            } else {
                // Bağlantı kapanmış veya kapanmakta, yeniden bağlanmayı deneyelim
                console.log('🔄 [MCPClient.sendChatMessage] Socket kapalı veya kapanıyor, yeniden bağlanmaya çalışılıyor...');
                try {
                    // Önce mevcut soketi kapatmaya çalışalım
                    if (this.socket.readyState !== WS_CLOSED) {
                        this.socket.close();
                    }
                    this.socket = null;
                    
                    // Yeniden bağlan
                    await this.connect();
                    console.log('✅ [MCPClient.sendChatMessage] Yeniden bağlantı başarılı, mesaj gönderimine devam ediliyor');
                } catch (connectError) {
                    console.error('❌ [MCPClient.sendChatMessage] Yeniden bağlantı hatası:', connectError);
                    throw new Error('Could not reconnect to SmileAgent Server');
                }
            }
        }
        
        // Bağlantı durumunu son bir kez kontrol et
        const connected = this.isConnectedToServer();
        console.log(`🔌 [MCPClient.sendChatMessage] Bağlantı durumu: ${connected ? 'Aktif' : 'Bağlı değil'}`);
        
        if (!connected) {
            console.error('❌ [MCPClient.sendChatMessage] Tüm kontrollere rağmen bağlantı yok!');
            throw new Error('Not connected to SmileAgent Server despite connection attempts');
        }

        const messageId = uuidv4();
        console.log(`🆔 [MCPClient.sendChatMessage] Mesaj ID: ${messageId}`);
        
        // ÖNEMLİ: Mesaj tipini sabit string olarak ayarla, enum değil
        // Server tarafında beklenen kesin string değeri kullan
        const message: McpMessage = {
            id: messageId,
            type: "chat_message" as McpMessageType, // String literal kullan, tip uyumluluğu için as ile cast et
            payload: {
                content,
                conversationId,
                streaming
            }
        };

        console.log(`🔍 [MCPClient.sendChatMessage] DEBUG - Message prepared with type: ${message.type}`);
        console.log(`🔍 [MCPClient.sendChatMessage] DEBUG - String literal type used: "chat_message"`);

        try {
            if (!streaming) {
                // Log before sending
                console.log('📡 [MCPClient.sendChatMessage] Non-streaming mode kullanılıyor, sendMessage() çağrılacak');
                
                // Non-streaming mode uses regular message flow
                return await this.sendMessage(message, 120000); // Extend timeout to 120 seconds
            } else {
                // Log before sending
                console.log('📡 [MCPClient.sendChatMessage] Streaming mode kullanılıyor, sendMessageWithoutWaiting() çağrılacak');
                console.log('📧 [MCPClient.sendChatMessage] Payload:', JSON.stringify(message.payload));
                console.log('📧 [MCPClient.sendChatMessage] Message type:', message.type);
                
                // Streaming mode emits events instead of waiting for a complete response
                this.sendMessageWithoutWaiting(message);
                
                // Return the message ID so caller can match response events
                console.log('✅ [MCPClient.sendChatMessage] Mesaj gönderildi, messageId dönülüyor: ', messageId);
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
        // Add debug logging to show more details about the message being sent
        console.log('\n🔍 [MCPClient.sendMessageWithoutWaiting] DEBUG - Message object structure:');
        console.log('🔑 Message ID:', message.id);
        console.log('📝 Message Type:', message.type);
        console.log('📦 Payload:', JSON.stringify(message.payload, null, 2));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        if (!this.isConnected || !this.socket || this.socket.readyState !== WS_OPEN) {
            console.error('❌ [MCPClient.sendMessageWithoutWaiting] SmileAgent Server\'a bağlı değil veya soket hazır değil');
            console.log(`🔌 [MCPClient.sendMessageWithoutWaiting] Socket durumu: ${this.socket ? this.socket.readyState : 'Yok'}`);
            
            // Bağlantıyı yeniden kurma girişimi
            if (this.socket && this.socket.readyState !== WS_OPEN) {
                console.log('🔄 [MCPClient.sendMessageWithoutWaiting] Socket var ama açık değil, otomatik yeniden bağlanma tetiklenecek...');
                // Burada throw etmek yerine event emit edelim ve bir süre sonra yeniden bağlanmayı deneyelim
                this.emit('needReconnect');
                this.attemptReconnect();
            }
            
            throw new Error('Not connected to SmileAgent Server or socket not ready');
        }

        try {
            console.log('📤 [MCPClient.sendMessageWithoutWaiting] Mesaj gönderiliyor, ID:', message.id);
            
            // ÖNEMLİ: Mesaj tipini değiştirme, olduğu gibi gönder
            // sendChatMessage'da zaten doğru tipte ayarlandı
            const messageStr = JSON.stringify(message);
            console.log('📦 [MCPClient.sendMessageWithoutWaiting] Mesaj içeriği:', messageStr);
            
            // Add socket state logging before sending
            console.log('🔌 [MCPClient.sendMessageWithoutWaiting] Socket state before sending:', 
                        'readyState:', this.socket.readyState, 
                        'bufferedAmount:', this.socket.bufferedAmount);
            
            this.socket.send(messageStr);
            
            // Log successful send attempt
            console.log('✅ [MCPClient.sendMessageWithoutWaiting] Mesaj gönderme çağrısı başarılı');
            
            // Add event listener to confirm message was actually sent (will be triggered when the message is sent)
            if (typeof this.socket.once === 'function') {
                this.socket.once('message', (response) => {
                    console.log('🔄 [MCPClient.sendMessageWithoutWaiting] Server\'dan yanıt alındı:', 
                                typeof response === 'string' ? response : 'Binary data');
                });
            }
        } catch (error) {
            console.error('❌ [MCPClient.sendMessageWithoutWaiting] Mesaj gönderme hatası:', error);
            throw error;
        }
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
        const connected = this.isConnected && this.socket !== null && this.socket.readyState === WS_OPEN;
        console.log('🔌 [MCPClient.isConnectedToServer] WebSocket bağlantı durumu:', 
                   connected ? 'Bağlı' : 'Bağlı değil', 
                   '(socket:', this.socket ? 'Var' : 'Yok', 
                   'isConnected:', this.isConnected,
                   'readyState:', this.socket ? this.socket.readyState : 'N/A', ')');
        return connected;
    }

    /**
     * Sunucuya mesaj gönderir ve yanıtı bekler
     */
    private async sendMessage(message: McpMessage, timeoutMs: number = 120000): Promise<any> {
        if (!this.isConnected || !this.socket || this.socket.readyState !== WS_OPEN) {
            console.error('❌ [MCPClient.sendMessage] SmileAgent Server\'a bağlı değil veya soket hazır değil');
            console.log(`🔌 [MCPClient.sendMessage] Socket durumu: ${this.socket ? this.socket.readyState : 'Yok'}`);
            
            // Bağlantıyı yeniden kurma girişimi
            if (this.socket && this.socket.readyState !== WS_OPEN) {
                console.log('🔄 [MCPClient.sendMessage] Socket var ama açık değil, yeniden bağlanmaya çalışılıyor...');
                try {
                    await this.connect();
                    console.log('✅ [MCPClient.sendMessage] Yeniden bağlantı başarılı, mesaj gönderimine devam ediliyor');
                } catch (connectError) {
                    console.error('❌ [MCPClient.sendMessage] Yeniden bağlantı hatası:', connectError);
                    throw new Error('Not connected to SmileAgent Server and reconnection attempt failed');
                }
            } else {
                throw new Error('Not connected to SmileAgent Server');
            }
        }

        return new Promise((resolve, reject) => {
            try {
                // At this point we know this.socket is not null because we checked above
                // and would have thrown an error otherwise
                const socket = this.socket!; // Non-null assertion
                
                console.log('📤 [MCPClient.sendMessage] Mesaj gönderiliyor, ID:', message.id);
                
                // ÖNEMLİ: Mesaj tipini değiştirme, olduğu gibi gönder
                // sendChatMessage'da zaten doğru tipte ayarlandı
                const messageStr = JSON.stringify(message);
                console.log('📦 [MCPClient.sendMessage] Mesaj içeriği:', messageStr.substring(0, 200) + (messageStr.length > 200 ? '...' : ''));
                
                // Add socket state logging before sending
                console.log('🔌 [MCPClient.sendMessage] Socket state before sending:', 
                          'readyState:', socket.readyState, 
                          'bufferedAmount:', socket.bufferedAmount);
                
                socket.send(messageStr);
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