import * as vscode from 'vscode';
import { cosineSimilarity } from '../utils/vectorUtils';

/**
 * Interface for cache entry object structure
 */
interface CacheEntry {
    query: string;
    embedding: number[];
    response: string;
    timestamp: number;
    mode: 'chat' | 'agent' | 'ask' | 'completion';
}

/**
 * ResponseCache - Provides caching functionality for AI responses
 * 
 * This service improves response times by caching previous AI interactions
 * and returning cached responses for similar queries.
 */
export class ResponseCache {
    private static instance: ResponseCache;
    private cache: CacheEntry[] = [];
    private maxCacheSize: number = 50;
    private similarityThreshold: number = 0.92; // Minimum similarity score to consider as similar
    private adaptiveThreshold: boolean = true;
    private minSimilarityThreshold: number = 0.85;
    private hitCount: number = 0;
    private missCount: number = 0;
    private enabled: boolean = true;

    private constructor() {
        // Initialize settings from configuration
        this.updateFromConfig();
        
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('smile-ai.performance')) {
                this.updateFromConfig();
            }
        });
    }

    /**
     * Get singleton instance of ResponseCache
     */
    public static getInstance(): ResponseCache {
        if (!ResponseCache.instance) {
            ResponseCache.instance = new ResponseCache();
        }
        return ResponseCache.instance;
    }

    /**
     * Update settings from VS Code configuration
     */
    private updateFromConfig(): void {
        const config = vscode.workspace.getConfiguration('smile-ai');
        const performanceConfig = config.get<any>('performance', {});
        
        this.enabled = performanceConfig.cacheResponses !== false;
        this.maxCacheSize = performanceConfig.maxCacheSize || 50;
        this.adaptiveThreshold = performanceConfig.adaptiveThreshold !== false;
        
        if (typeof performanceConfig.similarityThreshold === 'number') {
            this.similarityThreshold = performanceConfig.similarityThreshold;
        }
        
        if (typeof performanceConfig.minSimilarityThreshold === 'number') {
            this.minSimilarityThreshold = performanceConfig.minSimilarityThreshold;
        }
        
        console.log(`Response cache ${this.enabled ? 'enabled' : 'disabled'} with max size ${this.maxCacheSize}, threshold ${this.similarityThreshold}`);
    }
    
    /**
     * Check if a similar query exists in cache and return its response
     * @param query User query
     * @param embedding Vector embedding of the query
     * @param mode Interaction mode (chat, agent, ask, completion)
     * @returns Cached response if available, null otherwise
     */
    public findSimilarResponse(_query: string, embedding: number[], mode: 'chat' | 'agent' | 'ask' | 'completion'): string | null {
        if (!this.enabled) {
            return null;
        }
        
        // Adaptively adjust the similarity threshold based on cache hit rate
        const effectiveThreshold = this.getEffectiveThreshold();
        
        // Find best match in cache
        let bestMatch: CacheEntry | null = null;
        let highestSimilarity = 0;
        
        for (const entry of this.cache) {
            // Only match with same mode
            if (entry.mode !== mode) {
                continue;
            }
            
            // Calculate similarity with cached query
            const similarity = cosineSimilarity(embedding, entry.embedding);
            
            if (similarity > effectiveThreshold && similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestMatch = entry;
            }
        }
        
        if (bestMatch) {
            console.log(`Cache hit for query with similarity ${highestSimilarity.toFixed(3)}, effective threshold: ${effectiveThreshold.toFixed(3)}`);
            this.hitCount++;
            return bestMatch.response;
        }
        
        // Cache miss
        this.missCount++;
        
        return null;
    }
    
    /**
     * Calculate effective threshold based on hit/miss ratio
     */
    private getEffectiveThreshold(): number {
        if (!this.adaptiveThreshold) {
            return this.similarityThreshold;
        }
        
        const totalRequests = this.hitCount + this.missCount;
        if (totalRequests < 10) {
            // Not enough data yet
            return this.similarityThreshold;
        }
        
        const hitRatio = this.hitCount / totalRequests;
        
        if (hitRatio < 0.1) {
            // Very low hit rate, reduce threshold to get more hits
            return Math.max(this.minSimilarityThreshold, this.similarityThreshold - 0.05);
        } else if (hitRatio > 0.5) {
            // High hit rate, can afford to be more strict
            return Math.min(0.95, this.similarityThreshold + 0.02);
        }
        
        // Otherwise use configured threshold
        return this.similarityThreshold;
    }
    
    /**
     * Add a new response to the cache
     * @param query User query
     * @param embedding Vector embedding of the query
     * @param response AI response
     * @param mode Interaction mode
     */
    public addResponse(query: string, embedding: number[], response: string, mode: 'chat' | 'agent' | 'ask' | 'completion'): void {
        if (!this.enabled) {
            return;
        }
        
        // Add to cache
        this.cache.push({
            query,
            embedding,
            response,
            timestamp: Date.now(),
            mode
        });
        
        // Trim cache if exceeds maximum size
        if (this.cache.length > this.maxCacheSize) {
            // Remove oldest entries
            this.cache.sort((a, b) => b.timestamp - a.timestamp);
            this.cache = this.cache.slice(0, this.maxCacheSize);
        }
        
        // Log cache stats periodically
        const totalRequests = this.hitCount + this.missCount;
        if (totalRequests % 10 === 0) {
            const hitRatio = (this.hitCount / totalRequests) * 100;
            console.log(`Response cache stats: ${this.hitCount} hits, ${this.missCount} misses (${hitRatio.toFixed(1)}% hit rate), ${this.cache.length} entries`);
        }
    }
    
    /**
     * Clear all cached responses
     */
    public clearCache(): void {
        this.cache = [];
        console.log('Response cache cleared');
    }
    
    /**
     * Enable or disable the cache
     */
    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }
    
    /**
     * Check if cache is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }
    
    /**
     * Get cache statistics
     */
    public getStats(): { hits: number; misses: number; size: number; hitRatio: number } {
        const total = this.hitCount + this.missCount;
        const hitRatio = total > 0 ? this.hitCount / total : 0;
        
        return {
            hits: this.hitCount,
            misses: this.missCount,
            size: this.cache.length,
            hitRatio
        };
    }
} 