import { TaskType } from './types';

interface PromptTemplate {
    requiresContext: boolean;
    maxInputLength: number;
    supportedLanguages: string[];
    template: string;
}

type PromptTemplates = {
    [K in TaskType]: PromptTemplate;
};

export const promptTemplates: PromptTemplates = {
    code_completion: {
        requiresContext: true,
        maxInputLength: 1000,
        supportedLanguages: ['typescript', 'javascript', 'python'],
        template: `Mevcut kod bağlamı:
{{context}}

Tamamlanacak kod:
{{input}}

Kısıtlamalar:
{{constraints}}

Lütfen kodu en iyi pratiklere uygun şekilde tamamlayın.`
    },

    code_analysis: {
        requiresContext: true,
        maxInputLength: 2000,
        supportedLanguages: ['typescript', 'javascript', 'python'],
        template: `Analiz edilecek kod:
{{context}}

Analiz talebi:
{{input}}

Kısıtlamalar:
{{constraints}}

Lütfen kodu analiz edin ve aşağıdaki başlıklara göre değerlendirin:
1. Kod kalitesi
2. Olası hatalar
3. İyileştirme önerileri
4. Güvenlik riskleri`
    },

    code_generation: {
        requiresContext: false,
        maxInputLength: 1000,
        supportedLanguages: ['typescript', 'javascript', 'python'],
        template: `Üretilecek kod için istek:
{{input}}

Kısıtlamalar:
{{constraints}}

Lütfen belirtilen gereksinimlere uygun kod üretin.`
    },

    documentation: {
        requiresContext: true,
        maxInputLength: 2000,
        supportedLanguages: ['typescript', 'javascript', 'python'],
        template: `Dokümantasyon oluşturulacak kod:
{{context}}

Dokümantasyon talebi:
{{input}}

Kısıtlamalar:
{{constraints}}

Lütfen aşağıdaki formatta dokümantasyon oluşturun:
1. Genel açıklama
2. Parametreler
3. Dönüş değeri
4. Örnekler
5. Notlar`
    },

    test_generation: {
        requiresContext: true,
        maxInputLength: 2000,
        supportedLanguages: ['typescript', 'javascript', 'python'],
        template: `Test yazılacak kod:
{{context}}

Test talebi:
{{input}}

Kısıtlamalar:
{{constraints}}

Lütfen aşağıdaki test senaryolarını içeren testler oluşturun:
1. Temel fonksiyonellik
2. Sınır durumları
3. Hata durumları
4. Edge cases`
    },

    refactoring: {
        requiresContext: true,
        maxInputLength: 2000,
        supportedLanguages: ['typescript', 'javascript', 'python'],
        template: `Yeniden düzenlenecek kod:
{{context}}

Refactoring talebi:
{{input}}

Kısıtlamalar:
{{constraints}}

Lütfen kodu aşağıdaki prensiplere uygun şekilde yeniden düzenleyin:
1. SOLID prensipleri
2. DRY prensibi
3. Kod okunabilirliği
4. Performans optimizasyonu`
    },

    bug_fix: {
        requiresContext: true,
        maxInputLength: 2000,
        supportedLanguages: ['typescript', 'javascript', 'python'],
        template: `Hata içeren kod:
{{context}}

Hata açıklaması:
{{input}}

Kısıtlamalar:
{{constraints}}

Lütfen hatayı analiz edin ve düzeltilmiş kodu aşağıdaki formatta sağlayın:
1. Hata analizi
2. Düzeltme açıklaması
3. Düzeltilmiş kod
4. Test önerisi`
    }
}; 