import { MCPService } from '../mcp/MCPService';

/**
 * Bu fonksiyon MCP servisi bağlantı durumunu kontrol eder
 */
async function checkMCPStatus() {
    console.log("MCP bağlantı durumu kontrol ediliyor...");
    
    const mcpService = new MCPService({
        serverUrl: 'ws://localhost:3010',
        reconnectInterval: 5000,
        maxReconnectAttempts: 3
    });
    
    // Event dinleyicilerini ayarla
    mcpService['client'].on('connected', () => {
        console.log("✅ SmileAgent Server'a bağlantı başarılı!");
    });
    
    mcpService['client'].on('error', (error) => {
        console.error("❌ Bağlantı hatası:", error);
    });
    
    mcpService['client'].on('disconnected', () => {
        console.log("🔌 Bağlantı kesildi.");
    });
    
    // Bağlantıyı başlat
    try {
        const result = await mcpService.initialize();
        console.log("Bağlantı sonucu:", result);
        
        if (mcpService.isConnected()) {
            console.log("✅ MCP servis bağlantısı aktif.");
            
            // Bağlantıyı test etmek için basit bir sorgu
            try {
                const response = await mcpService.queryLLM("Merhaba, bu bir test mesajıdır.");
                console.log("📩 Server'dan yanıt:", response);
            } catch (error) {
                console.error("❌ Sorgu hatası:", error);
            }
        } else {
            console.log("❌ MCP servis bağlantısı kurulamadı.");
        }
    } catch (error) {
        console.error("❌ MCP servis başlatma hatası:", error);
    }
    
    // 10 saniye sonra bağlantıyı kapat
    setTimeout(() => {
        console.log("🔌 Bağlantı kapatılıyor...");
        mcpService.dispose();
        console.log("👋 Test tamamlandı.");
    }, 10000);
}

// Testi çalıştır
checkMCPStatus(); 