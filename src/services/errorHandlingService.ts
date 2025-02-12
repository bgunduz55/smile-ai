import * as vscode from 'vscode';
import { SettingsService } from './settingsService';
import { ErrorHandlingSettings } from '../models/settings';

interface APIErrorLike {
    statusCode?: number;
}

export class APIError extends Error {
    constructor(
        message: string,
        public readonly statusCode?: number,
        public readonly provider?: string,
        public readonly retryable: boolean = true
    ) {
        super(message);
        this.name = 'APIError';
    }
}

export class ErrorHandlingService {
    private static instance: ErrorHandlingService;
    private readonly settingsService: SettingsService;
    private settings: ErrorHandlingSettings;

    constructor(settingsService: SettingsService) {
        this.settingsService = settingsService;
        this.settings = settingsService.loadSettings().errorHandling;
    }

    public static getInstance(settingsService: SettingsService): ErrorHandlingService {
        if (!ErrorHandlingService.instance) {
            ErrorHandlingService.instance = new ErrorHandlingService(settingsService);
        }
        return ErrorHandlingService.instance;
    }

    public async handleError(error: unknown): Promise<void> {
        const settings = this.settingsService.getSettings();
        const { retryAttempts, retryDelay } = settings.errorHandling;

        if (error instanceof Error) {
            console.error('Error:', error.message);
            console.error('Stack:', error.stack);
        } else {
            console.error('Unknown error:', error);
        }

        if (this.isRetryableError(error)) {
            for (let attempt = 1; attempt <= retryAttempts; attempt++) {
                try {
                    await this.delay(retryDelay * attempt);
                    return;
                } catch (retryError) {
                    if (attempt === retryAttempts) {
                        throw retryError;
                    }
                }
            }
        }

        throw error;
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof Error) {
            // Network errors
            if (error.message.includes('ECONNRESET') || 
                error.message.includes('ETIMEDOUT') ||
                error.message.includes('ECONNREFUSED')) {
                return true;
            }

            // Rate limiting errors
            if (error.message.includes('rate limit') ||
                error.message.includes('too many requests')) {
                return true;
            }

            // Temporary service unavailable
            if (error.message.includes('503') ||
                error.message.includes('service unavailable')) {
                return true;
            }

            // Check for API errors with status codes
            const apiError = error as { statusCode?: number };
            const statusCode = apiError.statusCode ?? 0;
            return statusCode === 429 || statusCode >= 500;
        }

        return false;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async showErrorMessage(message: string): Promise<void> {
        const result = await vscode.window.showErrorMessage(
            message,
            'Retry',
            'Cancel'
        );

        if (result === 'Retry') {
            // Implement retry logic
        }
    }

    public async handleApiError(error: any): Promise<void> {
        if (error.response) {
            const status = error.response.status;
            const message = this.getErrorMessage(status);
            await this.showErrorMessage(message);
        } else if (error.request) {
            await this.showErrorMessage('No response received from the server');
        } else {
            await this.showErrorMessage(error.message || 'An error occurred while making the request');
        }
    }

    private getErrorMessage(status: number): string {
        switch (status) {
            case 400:
                return 'Bad Request: The request was invalid';
            case 401:
                return 'Unauthorized: Please check your API key';
            case 403:
                return 'Forbidden: You do not have permission to access this resource';
            case 404:
                return 'Not Found: The requested resource was not found';
            case 429:
                return 'Too Many Requests: Please try again later';
            case 500:
                return 'Internal Server Error: Something went wrong on the server';
            default:
                return `HTTP Error ${status}: An unexpected error occurred`;
        }
    }

    public getRetryAttempts(): number {
        return this.settings.retryAttempts;
    }

    public getRetryDelay(): number {
        return this.settings.retryDelay;
    }

    public getTimeout(): number {
        return this.settings.timeout;
    }

    public async withRetry<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        delayMs: number = 1000,
        context?: string
    ): Promise<T> {
        let lastError: unknown;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (attempt === maxRetries) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
            }
        }

        if (context) {
            await this.handleError(lastError);
        } else {
            await this.handleError(lastError);
        }
        throw lastError;
    }

    public createAPIError(error: any, provider: string): APIError {
        if (error instanceof APIError) {
            return error;
        }

        let message = 'Unknown error occurred';
        let statusCode: number | undefined;
        let retryable = true;

        if (error.response) {
            statusCode = error.response.status;
            message = error.response.data?.error || error.response.data?.message || error.message;
            
            // Client errors (except rate limiting) are not retryable
            if (statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
                retryable = false;
            }
        } else if (error.request) {
            message = 'No response received from server';
            retryable = true;
        } else {
            message = error.message || message;
        }

        return new APIError(message, statusCode, provider, retryable);
    }
} 