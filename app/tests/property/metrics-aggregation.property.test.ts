import * as fc from 'fast-check';
import { MetricsService } from '../../src/services/metrics.service';
import { IMetadataService, ILogger } from '../../src/services/interfaces';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { success } from '../../src/types';
import { RequestRecord } from '../../src/types/metrics';

/**
 * Property 2: Metrics aggregation correctly computes statistics
 *
 * For any non-empty sequence of HTTP request records (with arbitrary methods,
 * paths, status codes 100-599, and positive durations), flushing metrics SHALL
 * produce: requestCount equal to the sequence length, averageResponseTime equal
 * to the arithmetic mean of all durations (within floating-point tolerance),
 * and errorRate equal to (count of 5xx status codes / total count) * 100.
 *
 * **Validates: Requirements 9.1, 9.2, 9.3**
 */
describe('Property 2: Metrics aggregation correctly computes statistics', () => {
  const mockLogger: ILogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const mockCloudWatch = { send: jest.fn().mockResolvedValue({}) } as unknown as CloudWatchClient;
  const mockMetadata: IMetadataService = {
    getInstanceId: jest.fn().mockResolvedValue(success('i-test')),
    getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
  };
  const config = { metricsNamespace: 'Test', metricsIntervalMs: 60000, retryMaxAttempts: 3, retryBaseDelayMs: 100 };

  // Arbitrary for RequestRecord
  const requestRecordArb = fc.record({
    method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
    path: fc.string({ minLength: 1, maxLength: 50 }).map(s => '/' + s),
    statusCode: fc.integer({ min: 100, max: 599 }),
    durationMs: fc.float({ min: Math.fround(0.1), max: Math.fround(60000), noNaN: true }),
  });

  it('requestCount equals the number of recorded requests', () => {
    fc.assert(
      fc.property(fc.array(requestRecordArb, { minLength: 1, maxLength: 200 }), (records) => {
        const service = new MetricsService(mockCloudWatch, mockMetadata, mockLogger, config);

        for (const record of records) {
          service.recordRequest(record as RequestRecord);
        }

        const metrics = service.flushMetrics();
        expect(metrics.requestCount).toBe(records.length);
      }),
      { numRuns: 100 }
    );
  });

  it('averageResponseTime equals arithmetic mean of durations', () => {
    fc.assert(
      fc.property(fc.array(requestRecordArb, { minLength: 1, maxLength: 200 }), (records) => {
        const service = new MetricsService(mockCloudWatch, mockMetadata, mockLogger, config);

        for (const record of records) {
          service.recordRequest(record as RequestRecord);
        }

        const metrics = service.flushMetrics();
        const expectedMean = records.reduce((sum, r) => sum + r.durationMs, 0) / records.length;
        expect(metrics.averageResponseTime).toBeCloseTo(expectedMean, 5);
      }),
      { numRuns: 100 }
    );
  });

  it('errorRate equals (5xx count / total) * 100', () => {
    fc.assert(
      fc.property(fc.array(requestRecordArb, { minLength: 1, maxLength: 200 }), (records) => {
        const service = new MetricsService(mockCloudWatch, mockMetadata, mockLogger, config);

        for (const record of records) {
          service.recordRequest(record as RequestRecord);
        }

        const metrics = service.flushMetrics();
        const errorCount = records.filter(r => r.statusCode >= 500).length;
        const expectedRate = (errorCount / records.length) * 100;
        expect(metrics.errorRate).toBeCloseTo(expectedRate, 5);
      }),
      { numRuns: 100 }
    );
  });

  it('flushMetrics returns zeros when no requests recorded', () => {
    const service = new MetricsService(mockCloudWatch, mockMetadata, mockLogger, config);
    const metrics = service.flushMetrics();
    expect(metrics.requestCount).toBe(0);
    expect(metrics.averageResponseTime).toBe(0);
    expect(metrics.errorRate).toBe(0);
  });
});
