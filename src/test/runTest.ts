import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // Test klasörünün yolu
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // VSCode'u başlat ve testleri çalıştır
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                '--disable-extensions', // Diğer eklentileri devre dışı bırak
                '--disable-gpu' // GPU kullanımını devre dışı bırak
            ]
        });
    } catch (err) {
        console.error('Test çalıştırılırken hata oluştu:', err);
        process.exit(1);
    }
}

main(); 