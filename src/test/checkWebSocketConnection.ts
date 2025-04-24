import * as WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

/**
 * WebSocket bağlantısını doğrudan test eden fonksiyon
 */
function testWebSocketConnection() {
    console.log("⏱️ Test başlatılıyor...");
    
    // WebSocket bağlantısı oluştur
    const ws = new (WebSocket as any)('ws://localhost:3010');
    
    // Bağlantı açıldığında
    ws.on('open', () => {
        console.log("✅ WebSocket bağlantısı kuruldu!");
        
        // Test mesajı gönder
        const message = {
            id: uuidv4(),
            type: 'query',
            payload: {
                query: "Bu bir test mesajıdır",
                context: {},
                taskType: 'CODE_ANALYSIS'
            }
        };
        
        console.log("📤 Mesaj gönderiliyor:", JSON.stringify(message, null, 2));
        ws.send(JSON.stringify(message));
    });
    
    // Mesaj alındığında
    ws.on('message', (data: Buffer) => {
        try {
            const response = JSON.parse(data.toString());
            console.log("📥 Mesaj alındı:", JSON.stringify(response, null, 2));
            
            // Sunucudan yanıt alındı, bağlantıyı kapat
            setTimeout(() => {
                ws.close();
                console.log("👋 Test tamamlandı, bağlantı kapatıldı");
                process.exit(0);
            }, 1000);
        } catch (error) {
            console.error("❌ Mesaj işleme hatası:", error);
        }
    });
    
    // Hata durumunda
    ws.on('error', (error: Error) => {
        console.error("❌ WebSocket bağlantı hatası:", error);
    });
    
    // Bağlantı kapandığında
    ws.on('close', () => {
        console.log("🔌 WebSocket bağlantısı kapandı");
    });
    
    // 10 saniye sonra timeout
    setTimeout(() => {
        console.log("⏱️ Zaman aşımı! Bağlantı kapatılıyor...");
        ws.close();
        process.exit(1);
    }, 10000);
}

// Testi başlat
testWebSocketConnection(); 