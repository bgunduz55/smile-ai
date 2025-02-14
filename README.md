# Smile AI - Local AI Powered Coding Assistant

<!-- ![Smile AI Logo](resources/smile-ai-logo.png) -->

## 🎯 Vision

Smile AI, VSCode için geliştirilmiş, tamamen yerel AI modelleri kullanarak çalışan güçlü bir kod asistanıdır. Cursor benzeri kapsamlı özelliklere sahip olan bu asistan, internet bağlantısı gerektirmeden çalışabilir ve yerel AI modelleri (Ollama, LM Studio vb.) kullanarak geliştiricilere coding assistant desteği sağlar.

## 🌟 Temel Özellikler

### 🤖 Local AI Entegrasyonu
- Ollama ve LM Studio gibi yerel AI modelleri ile entegrasyon
- Özelleştirilebilir model seçimi ve yapılandırması
- Düşük kaynak tüketimi için optimize edilmiş AI kullanımı

### 💡 Akıllı Kod Asistanı
- Kod önerileri ve tamamlama
- Kod açıklama ve dokümantasyon oluşturma
- Bug tespiti ve çözüm önerileri
- Kod refactoring önerileri
- Test senaryoları oluşturma

### 🔄 Agent Yetenekleri
- Karmaşık görevleri alt görevlere bölme
- Çoklu dosya düzenleme ve yönetimi
- Akıllı bağlam anlama ve sürdürme
- Değişiklik önerilerini preview olarak gösterme
- Adım adım kod değişikliklerini uygulama

### 🛠️ Geliştirici Deneyimi
- Sezgisel kullanıcı arayüzü
- Özelleştirilebilir klavye kısayolları
- Detaylı değişiklik önizlemeleri
- Gerçek zamanlı kod analizi
- Çoklu dil desteği

## 🔧 Teknik Mimari

### AI Motor Katmanı
- Local LLM entegrasyonu (Ollama, LM Studio)
- Model yönetimi ve optimizasyonu
- Bağlam yönetimi ve hafıza optimizasyonu

### Agent Sistemi
- Görev planlama ve yönetimi
- Alt görev oluşturma ve izleme
- Dosya sistemi entegrasyonu
- Kod analiz motoru

### VSCode Entegrasyonu
- Extension API entegrasyonu
- Editör servisleri
- Dil servisleri
- Diagnostik servisleri

### Kullanıcı Arayüzü
- Komut paleti entegrasyonu
- Webview panelleri
- Durum çubuğu bildirimleri
- Kod lens ve dekorasyon desteği

## 🚀 Başlangıç

```bash
# Extension'ı yükleyin
code --install-extension smile-ai

# Local AI modelini hazırlayın (Ollama örneği)
ollama pull codellama

# Extension ayarlarından AI model tercihlerinizi yapılandırın
```

## 🤝 Katkıda Bulunma

Projeye katkıda bulunmak için lütfen [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını inceleyin.

## 📄 Lisans

Bu proje [MIT](LICENSE) lisansı altında lisanslanmıştır.
