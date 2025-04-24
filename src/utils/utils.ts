/**
 * Utility functions for SmileAgent
 */

/**
 * Returns a Promise that resolves after the specified delay
 * @param ms Delay in milliseconds
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
} 