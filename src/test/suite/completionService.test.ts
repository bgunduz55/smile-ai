import * as assert from 'assert';
import * as vscode from 'vscode';
import { CompletionService } from '../../services/completionService';
import { CompletionContext } from '../../types';

suite('CompletionService Test Suite', () => {
    let completionService: CompletionService;
    let disposable: vscode.Disposable;

    setup(() => {
        completionService = new CompletionService();
    });

    teardown(() => {
        if (disposable) {
            disposable.dispose();
        }
    });

    test('Should initialize completion service', () => {
        assert.ok(completionService, 'Completion Service should exist');
    });

    test('Should register completion provider', async () => {
        disposable = completionService.registerCompletionProvider();
        assert.ok(disposable, 'Should return a disposable');
    });

    test('Should toggle completion', () => {
        // Başlangıçta kapalı olmalı
        assert.strictEqual(completionService.isEnabled(), false);

        // Aç
        completionService.toggleCompletion();
        assert.strictEqual(completionService.isEnabled(), true);

        // Kapat
        completionService.toggleCompletion();
        assert.strictEqual(completionService.isEnabled(), false);
    });

    test('Should generate completion items', async () => {
        const context: CompletionContext = {
            document: {
                getText: () => 'function test() { cons }',
                getWordRangeAtPosition: () => new vscode.Range(0, 19, 0, 23),
                lineAt: () => ({ text: 'function test() { cons }' }),
                languageId: 'typescript'
            } as any,
            position: new vscode.Position(0, 23),
            token: new vscode.CancellationTokenSource().token,
            context: {
                triggerKind: vscode.CompletionTriggerKind.Invoke,
                triggerCharacter: undefined
            }
        };

        const items = await completionService.generateCompletionItems(context);
        assert.ok(Array.isArray(items), 'Should return an array of completion items');
        assert.ok(items.length > 0, 'Should return at least one completion item');
        
        // console.log önerisi olmalı
        const consoleItem = items.find(item => 
            item.label === 'console.log' && 
            item.kind === vscode.CompletionItemKind.Method
        );
        assert.ok(consoleItem, 'Should include console.log suggestion');
    });

    test('Should respect trigger characters', async () => {
        const context: CompletionContext = {
            document: {
                getText: () => 'const obj = {}; obj.',
                getWordRangeAtPosition: () => new vscode.Range(0, 17, 0, 17),
                lineAt: () => ({ text: 'const obj = {}; obj.' }),
                languageId: 'typescript'
            } as any,
            position: new vscode.Position(0, 17),
            token: new vscode.CancellationTokenSource().token,
            context: {
                triggerKind: vscode.CompletionTriggerKind.TriggerCharacter,
                triggerCharacter: '.'
            }
        };

        const items = await completionService.generateCompletionItems(context);
        assert.ok(items.length > 0, 'Should provide suggestions after trigger character');
    });

    test('Should handle minimum word length', async () => {
        const context: CompletionContext = {
            document: {
                getText: () => 'function test() { a }',
                getWordRangeAtPosition: () => new vscode.Range(0, 19, 0, 20),
                lineAt: () => ({ text: 'function test() { a }' }),
                languageId: 'typescript'
            } as any,
            position: new vscode.Position(0, 20),
            token: new vscode.CancellationTokenSource().token,
            context: {
                triggerKind: vscode.CompletionTriggerKind.Invoke,
                triggerCharacter: undefined
            }
        };

        const items = await completionService.generateCompletionItems(context);
        assert.strictEqual(items.length, 0, 'Should not provide suggestions for single character');
    });

    test('Should handle cancellation', async () => {
        const cancellationTokenSource = new vscode.CancellationTokenSource();
        const context: CompletionContext = {
            document: {
                getText: () => 'function test() { console.l }',
                getWordRangeAtPosition: () => new vscode.Range(0, 27, 0, 28),
                lineAt: () => ({ text: 'function test() { console.l }' }),
                languageId: 'typescript'
            } as any,
            position: new vscode.Position(0, 28),
            token: cancellationTokenSource.token,
            context: {
                triggerKind: vscode.CompletionTriggerKind.Invoke,
                triggerCharacter: undefined
            }
        };

        // İstek gönderilmeden önce iptal et
        cancellationTokenSource.cancel();

        const items = await completionService.generateCompletionItems(context);
        assert.strictEqual(items.length, 0, 'Should return empty array when cancelled');
    });
}); 