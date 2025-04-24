import { AIResponse, AIRequest, AIMessage } from '../ai-engine/types';
import { Task, TaskResult } from '../agent/types';

/**
 * AIProvider arayüzü, AIEngine ve MCPAgentAdapter için ortak metotları tanımlar
 */
export interface AIProvider {
    /**
     * LLM'e istek gönderir ve yanıt alır
     */
    sendRequest(request: AIRequest): Promise<AIResponse>;
    
    /**
     * Sohbet mesajlarına yanıt verir
     */
    chat(messages: AIMessage[], systemPrompt?: string, options?: any): Promise<AIResponse>;
    
    /**
     * Kod analizi yapar
     */
    analyzeCode(code: string, language: string, filePath?: string): Promise<any>;
    
    /**
     * Agent görevini yürütür
     */
    executeTask?(task: Task): Promise<TaskResult>;
    
    /**
     * LLM'e sorgu gönderir
     */
    queryLLM(prompt: string, context?: any): Promise<AIResponse>;
    
    /**
     * Bağlantı durumunu kontrol eder
     */
    isConnected?(): boolean;
} 