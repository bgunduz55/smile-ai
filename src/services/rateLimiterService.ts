import { SettingsService } from './settingsService';

export class RateLimiterService {
    private static instance: RateLimiterService;
    private requestCount: number = 0;
    private tokenCount: number = 0;
    private lastResetTime: number = Date.now();

    private constructor(private readonly settingsService: SettingsService) {}

    public static getInstance(settingsService: SettingsService): RateLimiterService {
        if (!RateLimiterService.instance) {
            RateLimiterService.instance = new RateLimiterService(settingsService);
        }
        return RateLimiterService.instance;
    }

    public async checkRateLimit(length: number): Promise<void> {
        const settings = this.settingsService.getSettings();
        const { enabled, maxRequestsPerMinute, maxTokensPerMinute, timeWindow } = settings.rateLimits;

        if (!enabled) {
            return;
        }

        const now = Date.now();
        if (now - this.lastResetTime >= timeWindow) {
            this.resetCounters();
        }

        if (this.requestCount >= maxRequestsPerMinute) {
            throw new Error('Rate limit exceeded: Too many requests per minute');
        }

        const estimatedTokens = Math.ceil(length / 4); // Rough estimate: 4 characters per token
        if (this.tokenCount + estimatedTokens > maxTokensPerMinute) {
            throw new Error('Rate limit exceeded: Too many tokens per minute');
        }

        this.requestCount++;
        this.tokenCount += estimatedTokens;
    }

    public async incrementCounters(length: number): Promise<void> {
        const settings = this.settingsService.getSettings();
        const { enabled } = settings.rateLimits;

        if (!enabled) {
            return;
        }

        const estimatedTokens = Math.ceil(length / 4);
        this.tokenCount += estimatedTokens;
    }

    private resetCounters(): void {
        this.requestCount = 0;
        this.tokenCount = 0;
        this.lastResetTime = Date.now();
    }

    public getRateLimitInfo(): string {
        const settings = this.settingsService.getSettings();
        const { enabled, maxRequestsPerMinute, maxTokensPerMinute } = settings.rateLimits;

        if (!enabled) {
            return 'Rate limiting is disabled';
        }

        return `Requests: ${this.requestCount}/${maxRequestsPerMinute}, Tokens: ${this.tokenCount}/${maxTokensPerMinute}`;
    }

    public isEnabled(): boolean {
        const settings = this.settingsService.getSettings();
        return settings.rateLimits.enabled;
    }

    public getMaxRequestsPerMinute(): number {
        const settings = this.settingsService.getSettings();
        return settings.rateLimits.maxRequestsPerMinute;
    }

    public getMaxTokensPerMinute(): number {
        const settings = this.settingsService.getSettings();
        return settings.rateLimits.maxTokensPerMinute;
    }
} 