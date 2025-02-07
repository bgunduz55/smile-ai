import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { indexService } from '../../services/indexService';

suite('IndexService Test Suite', () => {
    const testWorkspaceDir = path.join(__dirname, '../../../testWorkspace');
    const testFile1Path = path.join(testWorkspaceDir, 'test1.js');
    const testFile2Path = path.join(testWorkspaceDir, 'test2.js');

    suiteSetup(async () => {
        // Test workspace'i oluştur
        if (!fs.existsSync(testWorkspaceDir)) {
            fs.mkdirSync(testWorkspaceDir, { recursive: true });
        }

        // Test dosyalarını oluştur
        fs.writeFileSync(testFile1Path, 'function add(a, b) { return a + b; }');
        fs.writeFileSync(testFile2Path, 'function multiply(x, y) { return x * y; }');

        // Test workspace'ini aç
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(testWorkspaceDir));
    });

    suiteTeardown(() => {
        // Test dosyalarını temizle
        if (fs.existsSync(testFile1Path)) {
            fs.unlinkSync(testFile1Path);
        }
        if (fs.existsSync(testFile2Path)) {
            fs.unlinkSync(testFile2Path);
        }
        if (fs.existsSync(testWorkspaceDir)) {
            fs.rmdirSync(testWorkspaceDir);
        }
    });

    test('Should initialize index service', () => {
        assert.ok(indexService, 'Index Service should exist');
    });

    test('Should index workspace files', async () => {
        if (!vscode.workspace.workspaceFolders) {
            assert.fail('No workspace folder is open');
            return;
        }

        await indexService.startIndexing(vscode.workspace.workspaceFolders[0]);
        
        // İndeksleme tamamlandıktan sonra dosyaları ara
        const results = await indexService.searchFiles('function');
        assert.ok(results.length >= 2, 'Should find at least 2 files');
        
        const fileNames = results.map(r => path.basename(r.filePath));
        assert.ok(fileNames.includes('test1.js'), 'Should find test1.js');
        assert.ok(fileNames.includes('test2.js'), 'Should find test2.js');
    });

    test('Should find relevant files', async () => {
        const results = await indexService.getRelevantFiles('add numbers');
        assert.ok(results.length > 0, 'Should find relevant files');
        assert.ok(
            results.some(r => r.content.includes('add')),
            'Should find file containing add function'
        );
    });

    test('Should handle file changes', async () => {
        // Yeni bir dosya oluştur
        const newFilePath = path.join(testWorkspaceDir, 'newFile.js');
        fs.writeFileSync(newFilePath, 'function subtract(a, b) { return a - b; }');

        // Biraz bekle (dosya izleme sisteminin tepki vermesi için)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Yeni dosyanın indexlendiğini kontrol et
        const results = await indexService.searchFiles('subtract');
        assert.ok(results.length > 0, 'Should find new file');
        assert.ok(
            results.some(r => r.content.includes('subtract')),
            'Should find subtract function in new file'
        );

        // Temizlik
        if (fs.existsSync(newFilePath)) {
            fs.unlinkSync(newFilePath);
        }
    });

    test('Should exclude ignored files', async () => {
        // node_modules klasörü oluştur
        const nodeModulesDir = path.join(testWorkspaceDir, 'node_modules');
        fs.mkdirSync(nodeModulesDir, { recursive: true });
        
        // node_modules içine test dosyası ekle
        const ignoredFilePath = path.join(nodeModulesDir, 'ignored.js');
        fs.writeFileSync(ignoredFilePath, 'function shouldNotBeIndexed() {}');

        // Biraz bekle
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Dosyanın indexlenmediğini kontrol et
        const results = await indexService.searchFiles('shouldNotBeIndexed');
        assert.strictEqual(results.length, 0, 'Should not find ignored files');

        // Temizlik
        if (fs.existsSync(ignoredFilePath)) {
            fs.unlinkSync(ignoredFilePath);
        }
        if (fs.existsSync(nodeModulesDir)) {
            fs.rmdirSync(nodeModulesDir);
        }
    });
}); 