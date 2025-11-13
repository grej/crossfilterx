/**
 * @fileoverview Centralized debug logging utility for CrossfilterX.
 * Provides consistent logging with conditional execution based on debug flags.
 */

/**
 * Simple logger that only outputs when debug mode is enabled.
 * Debug mode is activated via:
 * - globalThis.__CFX_DEBUG = true
 * - process.env.CFX_DEBUG = 'true'
 */
export class Logger {
  private readonly enabled: boolean;
  private readonly prefix: string;

  constructor(prefix: string, forceEnable = false) {
    this.prefix = prefix;
    this.enabled = forceEnable || this.isDebugMode();
  }

  /**
   * Log a message if debug mode is enabled.
   * Arguments are passed directly to console.log after the prefix.
   */
  log(...args: unknown[]): void {
    if (this.enabled) {
      console.log(`[${this.prefix}]`, ...args);
    }
  }

  /**
   * Check if debug mode is enabled via global flags.
   */
  private isDebugMode(): boolean {
    return Boolean(
      (globalThis as any).__CFX_DEBUG ||
      (typeof process !== 'undefined' && process?.env?.CFX_DEBUG)
    );
  }
}

/**
 * Create a logger instance with a given prefix.
 * Convenience function for common use case.
 */
export function createLogger(prefix: string, forceEnable = false): Logger {
  return new Logger(prefix, forceEnable);
}
