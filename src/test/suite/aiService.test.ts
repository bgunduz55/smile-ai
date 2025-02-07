import * as assert from 'assert';
import * as vscode from 'vscode';
import { aiService } from '../../services/aiService';

suite('AIService Test Suite', () => {
    test('AI Service should be initialized', () => {
        assert.ok(aiService, 'AI Service should exist');
    });

    test('Should switch providers', async () => {
        // Yapılandırmayı geçici olarak değiştir
        await vscode.workspace.getConfiguration('smile-ai').update('provider', 'local', vscode.ConfigurationTarget.Global);
        assert.strictEqual(
            vscode.workspace.getConfiguration('smile-ai').get('provider'),
            'local',
            'Provider should be local'
        );

        await vscode.workspace.getConfiguration('smile-ai').update('provider', 'openai', vscode.ConfigurationTarget.Global);
        assert.strictEqual(
            vscode.workspace.getConfiguration('smile-ai').get('provider'),
            'openai',
            'Provider should be openai'
        );
    });

    test('Should generate response', async () => {
        // Test için local provider'ı kullan
        await vscode.workspace.getConfiguration('smile-ai').update('provider', 'local', vscode.ConfigurationTarget.Global);
        
        const response = await aiService.generateResponse('Hello, how are you?');
        assert.ok(response, 'Response should not be empty');
        assert.ok(typeof response === 'string', 'Response should be a string');
    });

    test('Should generate code', async () => {
        const context = JSON.stringify({
            fileContent: 'console.log("Hello World");',
            selection: '',
            language: 'javascript',
            filePath: 'test.js'
        });

        const response = await aiService.generateCode('Add a function that adds two numbers', context);
        assert.ok(response, 'Response should not be empty');
        assert.ok(typeof response === 'string', 'Response should be a string');
        assert.ok(response.includes('function'), 'Response should contain a function');
    });

    test('Should handle errors gracefully', async () => {
        // Geçersiz yapılandırma ile hata durumunu test et
        await vscode.workspace.getConfiguration('smile-ai').update('provider', 'openai', vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('smile-ai.openai').update('apiKey', '', vscode.ConfigurationTarget.Global);

        try {
            await aiService.generateResponse('This should fail');
            assert.fail('Should have thrown an error');
        } catch (error) {
            assert.ok(error instanceof Error, 'Should throw an Error instance');
            assert.ok(error.message.includes('API'), 'Error should mention API configuration');
        }
    });
}); 