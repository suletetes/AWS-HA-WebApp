import { withRetry, RetryOptions } from '../../../src/utils/retry';
import { isSuccess, isFailure } from '../../../src/types/result';

describe('withRetry', () => {
  // Use very short delays to keep tests fast
  const defaultOptions: RetryOptions = {
    maxRetries: 3,
    baseDelayMs: 1,
    maxDelayMs: 10,
  };

  it('returns success on first attempt when fn succeeds', async () => {
    const fn = jest.fn().mockResolvedValue('hello');

    const result = await withRetry(fn, defaultOptions);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value).toBe('hello');
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and returns success when fn eventually succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, defaultOptions);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value).toBe('recovered');
    }
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns failure after exhausting all retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('persistent failure'));

    const result = await withRetry(fn, defaultOptions);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe('AWS_SDK_ERROR');
      expect(result.error.message).toContain('Retry exhausted after 3 attempts');
      expect(result.error.message).toContain('persistent failure');
      expect(result.error.cause).toBeInstanceOf(Error);
    }
    // 1 initial + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('uses default maxDelayMs of 10000 when not specified', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const options: RetryOptions = { maxRetries: 1, baseDelayMs: 1 };

    const result = await withRetry(fn, options);

    expect(isFailure(result)).toBe(true);
    // 1 initial + 1 retry = 2 total calls
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('handles non-Error thrown values', async () => {
    const fn = jest.fn().mockRejectedValue('string error');
    const options: RetryOptions = { maxRetries: 0, baseDelayMs: 1 };

    const result = await withRetry(fn, options);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe('AWS_SDK_ERROR');
      expect(result.error.message).toContain('Operation failed after retries');
      expect(result.error.cause).toBe('string error');
    }
  });

  it('does not retry when maxRetries is 0', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('no retry'));
    const options: RetryOptions = { maxRetries: 0, baseDelayMs: 1 };

    const result = await withRetry(fn, options);

    expect(isFailure(result)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caps delay at maxDelayMs', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    // With baseDelayMs=100 and maxDelayMs=50, delay should be capped
    const options: RetryOptions = { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 50 };

    const start = Date.now();
    await withRetry(fn, options);
    const elapsed = Date.now() - start;

    // Delay should be at most maxDelayMs + some tolerance
    expect(elapsed).toBeLessThan(200);
  });
});
