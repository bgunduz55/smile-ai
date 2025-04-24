import * as vscode from 'vscode';
import { Task, TaskResult } from '../agent/types';
import { MCPService } from './MCPService';
import { AIResponse, AIRequest, AIMessage } from '../ai-engine/types';
import { AIProvider } from './interfaces';

/**
 * MCPAgentAdapter, SmileAgent Server ile agent görevlerini entegre eder.
 * Sunucu kullanılabilir olduğunda, tüm agent görevleri SmileAgent Server'a yönlendirilir.
 */
export class MCPAgentAdapter implements AIProvider {
    private mcpService: MCPService;

    constructor(mcpService: MCPService) {
        this.mcpService = mcpService;
        console.log('🔧 [MCPAgentAdapter] MCPAgentAdapter oluşturuldu, bağlantı durumu:', this.isConnected() ? 'Bağlı' : 'Bağlı değil');
    }

    /**
     * LLM'e istek gönderir ve yanıt alır
     */
    public async sendRequest(request: AIRequest): Promise<AIResponse> {
        try {
            console.log('📤 [MCPAgentAdapter.sendRequest] İstek alındı, MCP üzerinden işleniyor...');
            
            // Bağlantı durumunu kontrol et
            if (!this.isConnected()) {
                console.error('❌ [MCPAgentAdapter.sendRequest] SmileAgent Server\'a bağlantı yok!');
                throw new Error('Not connected to SmileAgent Server');
            }
            
            // İsteği MCP formatına dönüştür
            const query = request.messages.find(m => m.role === 'user')?.content || '';
            const systemPrompt = request.systemPrompt || request.messages.find(m => m.role === 'system')?.content || '';
            
            console.log('📤 [MCPAgentAdapter.sendRequest] Sorgu MCP\'ye gönderiliyor:', query.substring(0, 30) + '...');
            
            // Sorguyu MCP üzerinden gönder
            const result = await this.mcpService.queryLLM(query, {
                ...request.context,
                systemPrompt
            });
            
            console.log('📥 [MCPAgentAdapter.sendRequest] MCP\'den yanıt alındı:', 
                       result ? (result.success ? 'Başarılı' : 'Başarısız') : 'Undefined');
            
            return result;
        } catch (error) {
            console.error('❌ [MCPAgentAdapter.sendRequest] MCP üzerinden istek gönderirken hata:', error);
            return {
                message: `Error: ${error instanceof Error ? error.message : String(error)}`,
                success: false
            };
        }
    }
    
    /**
     * Sohbet mesajlarına yanıt verir
     */
    public async chat(messages: AIMessage[], systemPrompt?: string, options?: any): Promise<AIResponse> {
        try {
            console.log('💬 [MCPAgentAdapter.chat] Chat isteği alındı, mesaj sayısı:', messages.length);
            
            // Bağlantı durumunu kontrol et
            if (!this.isConnected()) {
                console.error('❌ [MCPAgentAdapter.chat] SmileAgent Server\'a bağlantı yok!');
                throw new Error('Not connected to SmileAgent Server');
            }
            
            // Son kullanıcı mesajını bul
            const userMessage = [...messages].reverse().find(m => m.role === 'user');
            if (!userMessage) {
                console.error('❌ [MCPAgentAdapter.chat] Kullanıcı mesajı bulunamadı');
                throw new Error('No user message found');
            }
            
            console.log('📤 [MCPAgentAdapter.chat] Kullanıcı mesajı MCP\'ye gönderiliyor:', 
                       userMessage.content.substring(0, 30) + '...');
                       
            // Streaming istendi mi kontrol et
            if (options && options.stream && typeof options.onChunk === 'function') {
                console.log('🌊 [MCPAgentAdapter.chat] Streaming istendi, elle streaming simülasyonu yapılıyor');
                
                // Streaming kullanılan bir yanıt oluşturmak için sorguyu gönder
                const resultPromise = this.mcpService.queryLLM(userMessage.content, {
                    messages,
                    systemPrompt,
                    ...options,
                    stream: false // MCP henüz streaming desteklemediği için false
                });
                
                // Arka planda işlemi başlat ve sonucu al
                resultPromise.then(result => {
                    if (result && result.message) {
                        console.log('📥 [MCPAgentAdapter.chat] Yanıt alındı, streaming simülasyonu başlatılıyor');
                        
                        // Yanıtı parçalara böl ve onChunk ile gönder
                        const message = result.message;
                        const chunkSize = 10; // Her seferinde gönderilecek karakter sayısı
                        let currentPosition = 0;
                        
                        // Manuel olarak streaming simülasyonu yap
                        const sendNextChunk = () => {
                            if (currentPosition < message.length) {
                                const endPosition = Math.min(currentPosition + chunkSize, message.length);
                                const chunk = message.substring(currentPosition, endPosition);
                                options.onChunk(chunk);
                                currentPosition = endPosition;
                                
                                // Bir sonraki parçayı göndermek için zamanlayıcı ayarla
                                setTimeout(sendNextChunk, 10);
                            }
                        };
                        
                        // İlk parçayı gönder
                        sendNextChunk();
                    } else {
                        console.error('❌ [MCPAgentAdapter.chat] Yanıt alınamadı veya boş');
                        options.onChunk("Sunucudan yanıt alınamadı.");
                    }
                }).catch(error => {
                    console.error('❌ [MCPAgentAdapter.chat] Streaming sırasında hata:', error);
                    options.onChunk(`Hata: ${error.message || 'Bilinmeyen bir hata oluştu'}`);
                });
                
                // Simüle edilmiş bir yanıt dön
                return {
                    message: "Streaming yanıt gönderiliyor...",
                    success: true
                };
            }
            
            // Normal istek (streaming olmadan)
            const result = await this.mcpService.queryLLM(userMessage.content, {
                messages,
                systemPrompt,
                ...options
            });
            
            console.log('📥 [MCPAgentAdapter.chat] MCP\'den yanıt alındı:', 
                       result ? (result.success ? 'Başarılı' : 'Başarısız') : 'Undefined');
            
            return result;
        } catch (error) {
            console.error('❌ [MCPAgentAdapter.chat] MCP üzerinden chat isteği gönderirken hata:', error);
            return {
                message: `Error: ${error instanceof Error ? error.message : String(error)}`,
                success: false
            };
        }
    }

    /**
     * Verilen görevi SmileAgent Server'a gönderir
     */
    public async executeTask(task: Task): Promise<TaskResult> {
        try {
            // MCP bağlantısı kontrol et
            if (!this.mcpService.isConnected()) {
                return {
                    success: false,
                    error: 'Not connected to SmileAgent Server',
                };
            }

            // Görevi server'a gönder ve yanıtı bekle
            const result = await this.mcpService.executeAgentTask(
                task.description,
                this.createTaskContext(task)
            );

            // Başarılı sonucu döndür
            return {
                success: true,
                data: result,
                aiResponse: this.convertToAIResponse(result),
            };
        } catch (error) {
            console.error('Error executing task via MCP:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * MCP için görev bağlamı oluşturur
     */
    private createTaskContext(task: Task): any {
        // Aktif editör ve dosya bilgilerini ekle
        const editor = vscode.window.activeTextEditor;
        const fileContext = editor ? {
            filePath: editor.document.uri.fsPath,
            language: editor.document.languageId,
            selection: editor.selection ? {
                startLine: editor.selection.start.line,
                startChar: editor.selection.start.character,
                endLine: editor.selection.end.line,
                endChar: editor.selection.end.character,
            } : undefined,
            selectedText: editor.selection ? editor.document.getText(editor.selection) : undefined,
            fileContent: editor.document.getText(),
        } : {};

        // Görev meta verilerini ekle
        return {
            ...fileContext,
            ...task.metadata,
            taskId: task.id,
            taskType: task.type,
            priority: task.priority,
        };
    }

    /**
     * Server yanıtını AIResponse formatına çevirir
     */
    private convertToAIResponse(result: any): AIResponse {
        return {
            message: result.explanation || result.response || '',
            success: true,
            codeChanges: result.codeChanges || [],
            workspaceEdit: result.workspaceEdit,
            usage: result.usage,
        };
    }

    /**
     * Kod analizi yaparak SmileAgent Server'dan sonuç alır
     */
    public async analyzeCode(code: string, language: string): Promise<any> {
        try {
            return await this.mcpService.analyzeCode(code, language);
        } catch (error) {
            console.error('Error analyzing code via MCP:', error);
            throw error;
        }
    }

    /**
     * LLM'e sorgu göndererek SmileAgent Server'dan yanıt alır
     */
    public async queryLLM(prompt: string, context: any = {}): Promise<AIResponse> {
        try {
            console.log('🔍 [MCPAgentAdapter.queryLLM] Sorgu alındı, MCP\'ye yönlendiriliyor...');
            
            // Bağlantı durumunu kontrol et
            if (!this.isConnected()) {
                console.error('❌ [MCPAgentAdapter.queryLLM] SmileAgent Server\'a bağlantı yok!');
                throw new Error('Not connected to SmileAgent Server');
            }
            
            console.log('📤 [MCPAgentAdapter.queryLLM] MCP\'ye gönderiliyor:', prompt.substring(0, 30) + '...');
            
            const result = await this.mcpService.queryLLM(prompt, context);
            
            console.log('📥 [MCPAgentAdapter.queryLLM] MCP\'den yanıt alındı:', 
                       result ? (result.success ? 'Başarılı' : 'Başarısız') : 'Undefined');
            
            if (result && result.message) {
                console.log('📋 [MCPAgentAdapter.queryLLM] Yanıt önizlemesi:', 
                           result.message.substring(0, 30) + '...');
            }
            
            return result;
        } catch (error) {
            console.error('❌ [MCPAgentAdapter.queryLLM] MCP üzerinden sorgu gönderirken hata:', error);
            return {
                message: `Error querying LLM via MCP: ${error instanceof Error ? error.message : String(error)}`,
                success: false
            };
        }
    }

    /**
     * Bağlantı durumunu kontrol eder
     */
    public isConnected(): boolean {
        const connected = this.mcpService.isConnected();
        console.log('🔌 [MCPAgentAdapter.isConnected] SmileAgent Server bağlantı durumu:', connected ? 'Bağlı' : 'Bağlı değil');
        return connected;
    }
} 