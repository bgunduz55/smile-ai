import { v4 as uuidv4 } from 'uuid';
import { Message, MessageEntity } from '../../domain/entities/Message';
import { ChatSession } from '../../domain/entities/ChatSession';
import { AIModelConfig } from '../../domain/interfaces/IAIService';
import { ModelProvider } from '../../models/settings';
import { AIServiceFactory } from '../../services/llm/aiServiceFactory';
import { SettingsService } from '../../services/settingsService';
import { RateLimiterService } from '../../services/rateLimiterService';
import { ErrorHandlingService } from '../../services/errorHandlingService';
import { VSCodeChatRepository } from '../../infrastructure/repositories/VSCodeChatRepository';
import { LLMService } from '../../services/llm/llmService';

export class ChatService {
    private static instance: ChatService;
    private currentSession: ChatSession | null = null;
    private llmService: LLMService | null = null;

    constructor(
        private readonly chatRepository: VSCodeChatRepository,
        private readonly aiServiceFactory: AIServiceFactory,
        private readonly settingsService: SettingsService,
        private readonly rateLimiterService: RateLimiterService,
        private readonly errorHandlingService: ErrorHandlingService
    ) {
        this.initialize();
    }

    public static getInstance(
        chatRepository: VSCodeChatRepository,
        aiServiceFactory: AIServiceFactory,
        settingsService: SettingsService,
        rateLimiterService: RateLimiterService,
        errorHandlingService: ErrorHandlingService
    ): ChatService {
        if (!ChatService.instance) {
            ChatService.instance = new ChatService(
                chatRepository,
                aiServiceFactory,
                settingsService,
                rateLimiterService,
                errorHandlingService
            );
        }
        return ChatService.instance;
    }

    private async initialize(): Promise<void> {
        try {
            this.llmService = await this.aiServiceFactory.getDefaultService();
            await this.loadOrCreateSession();
        } catch (error) {
            await this.errorHandlingService.handleError(error);
        }
    }

    private async loadOrCreateSession(): Promise<void> {
        const existingSession = await this.chatRepository.getCurrentSession();
        if (existingSession) {
            this.currentSession = existingSession;
        } else {
            const config = await this.getDefaultConfig();
            this.currentSession = new ChatSession('New Session', config);
            await this.chatRepository.saveSession(this.currentSession);
        }
    }

    private async getDefaultConfig(): Promise<AIModelConfig> {
        const settings = this.settingsService.loadSettings();
        const provider = settings.defaultProvider;
        const modelSettings = settings.models[provider];

        return {
            model: modelSettings.model,
            provider: provider,
            temperature: modelSettings.temperature,
            maxTokens: modelSettings.maxTokens,
            topP: modelSettings.topP || 1,
            frequencyPenalty: modelSettings.frequencyPenalty || 0,
            presencePenalty: modelSettings.presencePenalty || 0
        };
    }

    public async createSession(name: string, config?: AIModelConfig): Promise<ChatSession> {
        const sessionConfig = config || await this.getDefaultConfig();
        const session = new ChatSession(name, sessionConfig);
        await this.chatRepository.saveSession(session);
        this.currentSession = session;
        return session;
    }

    public async loadSession(id: string): Promise<ChatSession | null> {
        const session = await this.chatRepository.getSessionById(id);
        if (session) {
            this.currentSession = session;
        }
        return session;
    }

    public async sendMessage(content: string): Promise<Message> {
        if (!this.currentSession || !this.llmService) {
            throw new Error('Chat service not properly initialized');
        }

        try {
            await this.rateLimiterService.checkRateLimit(content.length);

            const userMessage = new MessageEntity('user', content);
            this.currentSession.addMessage(userMessage);

            const response = await this.llmService.generateResponse(content);
            const assistantMessage = new MessageEntity('assistant', response);
            this.currentSession.addMessage(assistantMessage);

            await this.chatRepository.saveSession(this.currentSession);
            await this.rateLimiterService.incrementCounters(response.length);

            return assistantMessage;
        } catch (error) {
            await this.errorHandlingService.handleError(error);
            throw error;
        }
    }

    public async streamMessage(content: string, onUpdate: (content: string) => void): Promise<void> {
        if (!this.currentSession || !this.llmService) {
            throw new Error('Chat service not properly initialized');
        }

        try {
            await this.rateLimiterService.checkRateLimit(content.length);

            const userMessage = new MessageEntity('user', content);
            this.currentSession.addMessage(userMessage);

            let fullResponse = '';
            await this.llmService.streamResponse<void>(content, (chunk: string) => {
                fullResponse += chunk;
                onUpdate(fullResponse);
            });

            const assistantMessage = new MessageEntity('assistant', fullResponse);
            this.currentSession.addMessage(assistantMessage);

            await this.chatRepository.saveSession(this.currentSession);
            await this.rateLimiterService.incrementCounters(fullResponse.length);
        } catch (error) {
            await this.errorHandlingService.handleError(error);
            throw error;
        }
    }

    public async editMessage(sessionId: string, messageId: string, content: string): Promise<void> {
        const session = await this.loadSession(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        session.editMessage(messageId, content);
        await this.chatRepository.updateMessage(sessionId, messageId, content);
    }

    public async deleteMessage(sessionId: string, messageId: string): Promise<void> {
        const session = await this.loadSession(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        session.deleteMessage(messageId);
        await this.chatRepository.deleteMessage(sessionId, messageId);
    }

    public async updateSessionSettings(sessionId: string, settings: Partial<AIModelConfig>): Promise<void> {
        const session = await this.loadSession(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        if (settings.provider) {
            const isAvailable = await this.aiServiceFactory.validateProvider(settings.provider);
            if (!isAvailable) {
                throw new Error(`Provider ${settings.provider} is not available`);
            }
        }

        session.updateSettings(settings);
        await this.chatRepository.updateSession(session);
    }

    public getCurrentSession(): ChatSession | null {
        return this.currentSession;
    }

    public async getSessions(): Promise<ChatSession[]> {
        return this.chatRepository.getSessions();
    }

    public async switchProvider(provider: ModelProvider): Promise<void> {
        try {
            this.llmService = await this.aiServiceFactory.createService(provider);
        } catch (error) {
            await this.errorHandlingService.handleError(error);
            throw error;
        }
    }

    public async getAvailableProviders(): Promise<ModelProvider[]> {
        return this.aiServiceFactory.getAvailableProviders();
    }

    public getCurrentProvider(): ModelProvider | null {
        return this.aiServiceFactory.getCurrentProvider();
    }

    public getCurrentService(): LLMService | null {
        return this.llmService;
    }

    public async clearSession(): Promise<void> {
        const config = await this.getDefaultConfig();
        this.currentSession = new ChatSession('New Session', config);
        await this.chatRepository.saveSession(this.currentSession);
    }

    public async getSessionHistory(): Promise<Message[]> {
        if (!this.currentSession) {
            throw new Error('No active chat session');
        }
        return this.currentSession.getMessages();
    }

    public async getRules(): Promise<string[]> {
        const settings = this.settingsService.loadSettings();
        return settings.rules?.enabledRules || [];
    }

    public async addRule(rule: string): Promise<void> {
        const settings = this.settingsService.loadSettings();
        const enabledRules = settings.rules?.enabledRules || [];
        if (!enabledRules.includes(rule)) {
            enabledRules.push(rule);
            await this.settingsService.updateSettings({
                rules: {
                    ...settings.rules,
                    enabledRules
                }
            });
        }
    }

    public async removeRule(rule: string): Promise<void> {
        const settings = this.settingsService.loadSettings();
        const enabledRules = settings.rules?.enabledRules || [];
        const index = enabledRules.indexOf(rule);
        if (index !== -1) {
            enabledRules.splice(index, 1);
            await this.settingsService.updateSettings({
                rules: {
                    ...settings.rules,
                    enabledRules
                }
            });
        }
    }

    public async getSuggestions(text: string): Promise<string[]> {
        if (!this.llmService) {
            throw new Error('Chat service not properly initialized');
        }

        try {
            const response = await this.llmService.generateResponse(
                `Generate code suggestions for: ${text}`
            );
            return response.split('\n').filter(line => line.trim().length > 0);
        } catch (error) {
            await this.errorHandlingService.handleError(error);
            throw error;
        }
    }

    public async applySuggestion(suggestion: string): Promise<void> {
        if (!this.llmService) {
            throw new Error('Chat service not properly initialized');
        }

        try {
            const response = await this.llmService.generateResponse(
                `Apply the following code suggestion: ${suggestion}`
            );
            // TODO: Implement suggestion application logic
            console.log('Suggestion applied:', response);
        } catch (error) {
            await this.errorHandlingService.handleError(error);
            throw error;
        }
    }
} 