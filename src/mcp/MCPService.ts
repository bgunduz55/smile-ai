import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MCPClient, AgentTaskType } from './MCPClient';
import { TaskType, TaskPriority } from '../agent/types';
import { AIResponse } from '../ai-engine/types';

/**
 * MCP Servisi yapılandırması
 */
export interface MCPServiceConfig {
    serverUrl: string;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
}

/**
 * MCP Servisi, SmileAgent Server ile iletişimi yöneten servis sınıfı
 */
export class MCPService {
    private client: MCPClient;
    private statusBarItem: vscode.StatusBarItem;
    private isInitialized = false;

    constructor(config: MCPServiceConfig) {
        this.client = new MCPClient({
            serverUrl: config.serverUrl,
            reconnectInterval: config.reconnectInterval || 5000,
            maxReconnectAttempts: config.maxReconnectAttempts || 5
        });

        // StatusBar öğesi oluştur
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = '$(sync~spin) Connecting to SmileAgent Server...';
        this.statusBarItem.tooltip = 'SmileAgent Server Connection Status';
        this.statusBarItem.command = 'smile-ai.reconnectServer';
        this.statusBarItem.show();

        // Event dinleyicilerini ayarla
        this.setupEventListeners();
    }

    /**
     * Servisi başlatır ve sunucuya bağlanır
     */
    public async initialize(): Promise<boolean> {
        try {
            console.log('🚀 [MCPService.initialize] Başlatılıyor...');
            console.log('🌐 [MCPService.initialize] Bağlanılacak server URL:', this.client['config'].serverUrl);
            
            this.statusBarItem.text = '$(sync~spin) SmileAgent Server Bağlanıyor...';
            this.statusBarItem.tooltip = 'SmileAgent Server\'a bağlanmaya çalışılıyor...';
            
            console.log('🔄 [MCPService.initialize] WebSocket bağlantısı kuruluyor...');
            await this.client.connect();
            
            // Bağlantı başarılı olduysa burada exception fırlatılmamış demektir
            this.isInitialized = true;
            this.statusBarItem.text = '$(rocket) SmileAgent Server Aktif';
            this.statusBarItem.tooltip = 'SmileAgent Server ile bağlantı aktif';
            
            // Konsola bağlantı durumunu yazdır
            console.log('\n✅ [MCPService.initialize] SmileAgent Server bağlantısı başarılı!');
            console.log(`⏰ Zaman: ${new Date().toLocaleTimeString()}`);
            console.log(`🔗 Server URL: ${this.client['config'].serverUrl}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            // Kullanıcıya bilgi göster
            vscode.window.showInformationMessage('✅ SmileAgent Server\'a bağlantı başarılı! AI görevleri artık sunucu üzerinden işleniyor.');
            
            // Bağlantı sonrası 3 saniye bekleyip test sorgusu gönder
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            try {
                console.log('🧪 [MCPService.initialize] Test sorgusu gönderiliyor...');
                // Basit test mesajı kullanarak ve 120 saniyelik zaman aşımıyla
                const testResult = await this.client.sendQuery("Test connection", { test: true, simple: true }, AgentTaskType.CODE_GENERATION);
                console.log('✅ [MCPService.initialize] Test sorgusu başarılı:', 
                          testResult ? 'Sonuç alındı' : 'Sonuç alınamadı');
            } catch (testError) {
                console.error('⚠️ [MCPService.initialize] Test sorgusu başarısız:', testError);
                // Test hatası varsa bile bağlantı başarılıysa devam edelim
            }
            
            return true;
        } catch (error) {
            this.statusBarItem.text = '$(error) SmileAgent Server Bağlantı Hatası';
            this.statusBarItem.tooltip = `Bağlantı hatası: ${error instanceof Error ? error.message : String(error)}`;
            
            // Konsola hata durumunu yazdır
            console.error('\n❌ [MCPService.initialize] SmileAgent Server bağlantı hatası:', error);
            console.log(`⏰ Zaman: ${new Date().toLocaleTimeString()}`);
            console.log(`🔗 Server URL: ${this.client['config'].serverUrl}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            // Kullanıcıya hata göster
            vscode.window.showErrorMessage(`❌ SmileAgent Server bağlantı hatası: ${error instanceof Error ? error.message : String(error)}`);
            
            return false;
        }
    }

    /**
     * Olay dinleyicilerini ayarlar
     */
    private setupEventListeners(): void {
        this.client.on('connected', () => {
            this.statusBarItem.text = '$(rocket) SmileAgent Server Aktif';
            this.statusBarItem.tooltip = 'SmileAgent Server ile bağlantı aktif';
            
            // Konsola bağlantı durumunu yazdır
            console.log('\n✅ SmileAgent Server bağlantısı kuruldu!');
            console.log(`⏰ Zaman: ${new Date().toLocaleTimeString()}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            // Kullanıcıya bilgi göster
            vscode.window.showInformationMessage('✅ SmileAgent Server bağlantısı yeniden kuruldu!');
        });

        this.client.on('disconnected', () => {
            this.statusBarItem.text = '$(circle-slash) SmileAgent Server Bağlantı Kesildi';
            this.statusBarItem.tooltip = 'SmileAgent Server ile bağlantı kesildi';
            
            // Konsola bağlantı kesildi durumunu yazdır
            console.log('\n🔌 SmileAgent Server bağlantısı kesildi!');
            console.log(`⏰ Zaman: ${new Date().toLocaleTimeString()}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            // Kullanıcıya bilgi göster
            vscode.window.showWarningMessage('⚠️ SmileAgent Server bağlantısı kesildi. Yerel AI kullanılıyor.');
        });

        this.client.on('error', (error) => {
            this.statusBarItem.text = '$(error) SmileAgent Server Hata';
            this.statusBarItem.tooltip = `Hata: ${error instanceof Error ? error.message : String(error)}`;
            
            // Konsola hata durumunu yazdır
            console.error('\n❌ SmileAgent Server bağlantı hatası:', error);
            console.log(`⏰ Zaman: ${new Date().toLocaleTimeString()}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            console.error('MCP Client error:', error);
        });

        this.client.on('reconnectFailed', () => {
            this.statusBarItem.text = '$(alert) SmileAgent Server Bağlantı Hatası';
            this.statusBarItem.tooltip = 'SmileAgent Server\'a yeniden bağlantı kurulamadı';
            
            // Konsola yeniden bağlantı hatası durumunu yazdır
            console.error('\n❌ SmileAgent Server\'a yeniden bağlantı başarısız!');
            console.log(`⏰ Zaman: ${new Date().toLocaleTimeString()}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            vscode.window.showErrorMessage('❌ SmileAgent Server\'a yeniden bağlantı kurulamadı. Sunucu durumunu kontrol edin.');
        });
    }

    /**
     * Servisi dispose eder
     */
    public dispose(): void {
        this.client.disconnect();
        this.statusBarItem.dispose();
    }

    /**
     * Bağlantı durumunu kontrol eder
     */
    public isConnected(): boolean {
        try {
            const connected = this.isInitialized && this.client.isConnectedToServer();
            console.log('🔌 [MCPService.isConnected] WebSocket bağlantı durumu:', connected ? 'Bağlı' : 'Bağlı değil',
                       '(isInitialized:', this.isInitialized, '&& client.isConnectedToServer:', this.client.isConnectedToServer(), ')');
            return connected;
        } catch (error) {
            console.error('❌ [MCPService.isConnected] Bağlantı durumu kontrolünde hata:', error);
            return false;
        }
    }

    /**
     * Kod analizi yapar ve sunucudan yanıt döndürür
     */
    public async analyzeCode(code: string, context: any = {}): Promise<any> {
        this.checkConnection();
        
        // Kod analizi isteğini SmileAgent Server'a gönder
        const analysisContext = {
            ...context,
            code
        };
        
        return this.client.sendQuery("Analyze this code", analysisContext, AgentTaskType.CODE_EXPLANATION);
    }

    /**
     * LLM'e sorgu gönderir ve yanıt döndürür
     */
    public async queryLLM(query: string, context: any = {}): Promise<any> {
        this.checkConnection();
        
        // Sorguyu SmileAgent Server'a gönder
        const queryContext = {
            ...context
        };
        
        return this.client.sendQuery(query, queryContext, AgentTaskType.CODE_GENERATION);
    }

    /**
     * SmileAgent Server üzerinde bir ajan görevi yürütür
     */
    public async executeAgentTask(task: string, context: any = {}): Promise<any> {
        this.checkConnection();
        
        // Görevi SmileAgent Server'a gönder
        const taskContext = {
            ...context
        };
        
        return this.client.sendQuery(task, taskContext, AgentTaskType.CODE_GENERATION);
    }

    /**
     * Komut çalıştırır
     */
    public async executeCommand(command: string, workingDirectory?: string): Promise<any> {
        this.checkConnection();
        return this.client.executeCommand(command, workingDirectory);
    }

    /**
     * Dosya okur
     */
    public async readFile(filePath: string): Promise<string> {
        this.checkConnection();
        return this.client.readFile(filePath);
    }

    /**
     * Dosyaya yazar
     */
    public async writeFile(filePath: string, content: string): Promise<boolean> {
        this.checkConnection();
        return this.client.writeFile(filePath, content);
    }

    /**
     * Bağlantı durumunu kontrol eder, bağlantı yoksa hata fırlatır
     */
    private checkConnection(): void {
        if (!this.isInitialized || !this.client.isConnectedToServer()) {
            console.error('❌ [MCPService.checkConnection] SmileAgent Server bağlantısı yok!');
            throw new Error('Not connected to SmileAgent Server. Please check server status and connection.');
        }
        console.log('✅ [MCPService.checkConnection] SmileAgent Server bağlantısı mevcut');
    }

    /**
     * Returns the MCPClient instance
     */
    public getClient(): MCPClient {
        if (!this.client) {
            throw new Error('MCPClient not initialized');
        }
        return this.client;
    }
} 