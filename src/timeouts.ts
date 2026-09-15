import { UsageError } from './errors/index.js';

export const DEFAULT_TIMEOUT_POLICY = {
  connectionMs: 5_000,
  navigationMs: 5_000,
  composerMs: 5_000,
  confirmationMs: 2_000,
} as const;

export interface TimeoutPolicy {
  connectionMs: number;
  navigationMs: number;
  composerMs: number;
  confirmationMs: number;
}

export function createTimeoutPolicy(timeoutMs?: number): TimeoutPolicy {
  if (timeoutMs === undefined) {
    return { ...DEFAULT_TIMEOUT_POLICY };
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new UsageError('Timeout must be a positive integer in milliseconds.');
  }
  return {
    connectionMs: timeoutMs,
    navigationMs: timeoutMs,
    composerMs: timeoutMs,
    confirmationMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_POLICY.confirmationMs),
  };
}
