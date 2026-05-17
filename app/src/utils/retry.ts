// src/utils/retry.ts — Exponential backoff retry utility

import { Result, AppError, success, failure } from '../types/result';

export interface RetryOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs?: number;
}

const DEFAULT_MAX_DELAY_MS = 10000;

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * (baseDelayMs / 2);
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<Result<T, AppError>> {
  const { maxRetries, baseDelayMs, maxDelayMs = DEFAULT_MAX_DELAY_MS } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const value = await fn();
      return success(value);
    } catch (error: unknown) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
        await sleep(delay);
      }
    }
  }

  const message = lastError instanceof Error
    ? lastError.message
    : 'Operation failed after retries';

  return failure({
    code: 'AWS_SDK_ERROR',
    message: `Retry exhausted after ${maxRetries} attempts: ${message}`,
    cause: lastError,
  });
}
