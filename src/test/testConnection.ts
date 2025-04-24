import { MCPClient } from '../mcp/MCPClient';

async function testConnection() {
    console.log("SmileAgent Server bağlantı testi başlıyor...");
    
    const client = new MCPClient({
        serverUrl: 'ws://localhost:3010',
        reconnectInterval: 5000,
        maxReconnectAttempts: 3
    });
    
    client.on('connected', () => {
        console.log("Bağlantı başarılı!");
        
        // Sunucuya bir sorgu gönder
        client.sendQuery("Merhaba, bu bir test mesajıdır.")
            .then(response => {
                console.log("Sunucudan yanıt alındı:", response);
                // Bağlantıyı kapat
                client.disconnect();
                console.log("Bağlantı kapatıldı.");
            })
            .catch(error => {
                console.error("Sorgu hatası:", error);
                client.disconnect();
            });
    });
    
    client.on('error', (error) => {
        console.error("Bağlantı hatası:", error);
    });
    
    client.on('disconnected', () => {
        console.log("Bağlantı kesildi.");
    });
    
    // Bağlantıyı başlat
    try {
        await client.connect();
    } catch (error) {
        console.error("Bağlantı başlatılamadı:", error);
    }
}

testConnection(); 