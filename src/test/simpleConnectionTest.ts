import * as WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

// Test için basit bir fonksiyon
async function testConnection() {
    console.log("SmileAgent Server bağlantı testi başlıyor...");
    
    const socket = new (WebSocket as any)('ws://localhost:3010');
    
    socket.on('open', () => {
        console.log("Bağlantı başarılı!");
        
        // Basit bir sorgu mesajı gönder
        const message = {
            id: uuidv4(),
            type: 'query',
            payload: {
                query: "Merhaba, bu bir test mesajıdır.",
                context: {},
                taskType: 'CODE_ANALYSIS'
            }
        };
        
        socket.send(JSON.stringify(message));
        console.log("Mesaj gönderildi:", message);
    });
    
    socket.on('message', (data: Buffer) => {
        const response = JSON.parse(data.toString());
        console.log("Sunucudan yanıt alındı:", response);
        
        // Bağlantıyı kapat
        setTimeout(() => {
            socket.close();
            console.log("Bağlantı kapatıldı.");
        }, 1000);
    });
    
    socket.on('error', (error: Error) => {
        console.error("Bağlantı hatası:", error);
    });
    
    socket.on('close', () => {
        console.log("Bağlantı kesildi.");
    });
}

// Testi çalıştır
testConnection(); 