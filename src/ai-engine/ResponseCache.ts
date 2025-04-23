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
    private skipEmbeddingCheck: boolean = false;
    private queryHashMap: Map<string, string> = new Map();
    private cachePriority: Map<string, number> = new Map(); // Higher number = higher priority

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
        this.skipEmbeddingCheck = performanceConfig.skipEmbeddingCheck === true;
        
        if (typeof performanceConfig.similarityThreshold === 'number') {
            this.similarityThreshold = performanceConfig.similarityThreshold;
        }
        
        if (typeof performanceConfig.minSimilarityThreshold === 'number') {
            this.minSimilarityThreshold = performanceConfig.minSimilarityThreshold;
        }
        
        console.log(`Response cache ${this.enabled ? 'enabled' : 'disabled'} with max size ${this.maxCacheSize}, threshold ${this.similarityThreshold}`);
    }
    
    /**
     * Compute a simple hash of a string for quick-matching
     */
    private computeQueryHash(query: string): string {
        // Normalize the query and remove common tokens
        const normalizedQuery = query
            .toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Use a simple hash for string comparison to avoid computing embeddings
        // when queries are very similar
        return normalizedQuery.substring(0, 50);
    }
    
    /**
     * Check if a similar query exists in cache and return its response
     */
    public findSimilarResponse(query: string, embedding: number[], mode: 'chat' | 'agent' | 'ask' | 'completion'): string | null {
        if (!this.enabled) {
            return null;
        }
        
        // First try exact match with hash for very fast response
        const queryHash = this.computeQueryHash(query);
        const cachedResponseId = this.queryHashMap.get(queryHash);
        
        if (cachedResponseId) {
            const exactMatch = this.cache.find(entry => 
                entry.mode === mode && 
                entry.query === query
            );
            
            if (exactMatch) {
                console.log('Cache hit: Exact match found');
                // Increase the priority of this entry
                this.increaseCachePriority(exactMatch);
                this.hitCount++;
                return exactMatch.response;
            }
            
            // If not exact but hash matches, we still have a good candidate
            const hashMatch = this.cache.find(entry => entry.mode === mode && this.computeQueryHash(entry.query) === queryHash);
            if (hashMatch) {
                console.log('Cache hit: Hash match found');
                // Increase the priority of this entry
                this.increaseCachePriority(hashMatch);
                this.hitCount++;
                return hashMatch.response;
            }
        }
        
        // If we didn't get a hash hit and embedding check is disabled, return null
        if (this.skipEmbeddingCheck || !embedding) {
            this.missCount++;
            return null;
        }
        
        // Fall back to embedding similarity check
        const effectiveThreshold = this.getEffectiveThreshold();
        
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
            // Increase the priority of this entry
            this.increaseCachePriority(bestMatch);
            this.hitCount++;
            return bestMatch.response;
        }
        
        // Cache miss
        this.missCount++;
        return null;
    }
    
    private increaseCachePriority(entry: CacheEntry): void {
        // Use a combination of timestamp and access count to create a priority score
        const currentPriority = this.cachePriority.get(entry.query) || 0;
        this.cachePriority.set(entry.query, currentPriority + 1);
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
     */
    public addResponse(query: string, embedding: number[], response: string, mode: 'chat' | 'agent' | 'ask' | 'completion'): void {
        if (!this.enabled) {
            return;
        }
        
        // Store the hash mapping for quick lookup later
        const queryHash = this.computeQueryHash(query);
        this.queryHashMap.set(queryHash, query);
        
        // Check if this query already exists in the cache
        const existingIndex = this.cache.findIndex(entry => 
            entry.query === query && entry.mode === mode
        );
        
        if (existingIndex !== -1) {
            // Update existing entry
            this.cache[existingIndex] = {
                query,
                embedding,
                response,
                timestamp: Date.now(),
                mode
            };
            
            // Increase its priority
            this.increaseCachePriority(this.cache[existingIndex]);
            
            console.log(`Updated existing cache entry for query: ${query.substring(0, 30)}...`);
            return;
        }
        
        // Add new entry to cache
        this.cache.push({
            query,
            embedding,
            response,
            timestamp: Date.now(),
            mode
        });
        
        // Initialize priority
        this.cachePriority.set(query, 1);
        
        // Trim cache if exceeds maximum size
        if (this.cache.length > this.maxCacheSize) {
            // Sort by priority (higher priority items are kept)
            this.cache.sort((a, b) => {
                const priorityA = this.cachePriority.get(a.query) || 0;
                const priorityB = this.cachePriority.get(b.query) || 0;
                
                if (priorityA !== priorityB) {
                    return priorityB - priorityA; // Higher priority first
                }
                
                // If same priority, newer items are kept
                return b.timestamp - a.timestamp;
            });
            
            const removed = this.cache.splice(this.maxCacheSize);
            
            // Clean up hash map and priority map for removed entries
            removed.forEach(entry => {
                const hash = this.computeQueryHash(entry.query);
                if (this.queryHashMap.get(hash) === entry.query) {
                    this.queryHashMap.delete(hash);
                }
                this.cachePriority.delete(entry.query);
            });
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
        this.queryHashMap.clear();
        this.cachePriority.clear();
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