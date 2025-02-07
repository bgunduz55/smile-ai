import * as path from 'path';
import * as Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
    // Test dosyalarını bul
    const testsRoot = path.resolve(__dirname, '..');
    const files = await glob('**/**.test.js', { cwd: testsRoot });

    // Mocha test suite'ini oluştur
    const mocha = new (Mocha as any)({
        ui: 'tdd',
        color: true,
        timeout: 10000 // AI çağrıları için yeterli süre
    });

    // Test dosyalarını yükle
    files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

    try {
        // Test suite'ini çalıştır
        await new Promise<void>((resolve, reject) => {
            mocha.run((failures: number) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        });
    } catch (err) {
        console.error(err);
        throw err;
    }
} 