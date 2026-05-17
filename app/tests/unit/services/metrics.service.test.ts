import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { MetricsService, MetricsServiceConfig } from '../../../src/services/metrics.service';
import { IMetadataService } from '../../../src/services/interfaces';
import { ILogger } from '../../../src/utils/logger';
import { success, failure } from '../../../src/types/result';

describe('MetricsService', () => {
  let mockCloudWatch: jest.Mocked<CloudWatchClient>;
  let mockMetadataService: jest.Mocked<IMetadataService>;
  let mockLogger: jest.Mocked<ILogger>;
  let config: MetricsServiceConfig;
  let service: MetricsService;

  beforeEach(() => {
    mockCloudWatch = {
      send: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<CloudWatchClient>;

    mockMetadataService = {
      getInstanceId: jest.fn().mockResolvedValue(success('i-1234567890abcdef0')),
      getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    config = {
      metricsNamespace: 'TestNamespace',
      metricsIntervalMs: 60000,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 100,
    };

    service = new MetricsService(mockCloudWatch, mockMetadataService, mockLogger, config);
  });

  afterEach(() => {
    service.stopPublishing();
  });

  describe('recordRequest', () => {
    it('increments request count', () => {
      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 50 });
      service.recordRequest({ method: 'POST', path: '/api', statusCode: 201, durationMs: 100 });

      const metrics = service.flushMetrics();
      expect(metrics.requestCount).toBe(2);
    });

    it('accumulates total response time', () => {
      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 50 });
      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 150 });

      const metrics = service.flushMetrics();
      expect(metrics.averageResponseTime).toBe(100);
    });

    it('increments error count for 5xx status codes', () => {
      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 10 });
      service.recordRequest({ method: 'GET', path: '/', statusCode: 500, durationMs: 10 });
      service.recordRequest({ method: 'GET', path: '/', statusCode: 503, durationMs: 10 });

      const metrics = service.flushMetrics();
      expect(metrics.errorRate).toBeCloseTo((2 / 3) * 100);
    });

    it('does not count 4xx as errors', () => {
      service.recordRequest({ method: 'GET', path: '/', statusCode: 404, durationMs: 10 });
      service.recordRequest({ method: 'GET', path: '/', statusCode: 499, durationMs: 10 });

      const metrics = service.flushMetrics();
      expect(metrics.errorRate).toBe(0);
    });
  });

  describe('flushMetrics', () => {
    it('returns zeros when no requests recorded', () => {
      const metrics = service.flushMetrics();
      expect(metrics.requestCount).toBe(0);
      expect(metrics.averageResponseTime).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('resets state after flush', () => {
      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 100 });
      service.flushMetrics();

      const metrics = service.flushMetrics();
      expect(metrics.requestCount).toBe(0);
      expect(metrics.averageResponseTime).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('computes correct average response time', () => {
      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 100 });
      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 200 });
      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 300 });

      const metrics = service.flushMetrics();
      expect(metrics.averageResponseTime).toBe(200);
    });
  });

  describe('publishMetrics', () => {
    it('publishes metrics to CloudWatch with correct namespace and dimensions', async () => {
      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 100 });

      const result = await service.publishMetrics();

      expect(result.kind).toBe('success');
      expect(mockCloudWatch.send).toHaveBeenCalled();

      const call = (mockCloudWatch.send as jest.Mock).mock.calls[0][0];
      expect(call).toBeInstanceOf(PutMetricDataCommand);
      expect(call.input.Namespace).toBe('TestNamespace');
      expect(call.input.MetricData).toHaveLength(3);
      expect(call.input.MetricData[0].Dimensions[0]).toEqual({
        Name: 'InstanceId',
        Value: 'i-1234567890abcdef0',
      });
    });

    it('uses "unknown" instance ID when metadata service fails', async () => {
      mockMetadataService.getInstanceId.mockResolvedValue(
        failure({ code: 'METADATA_UNAVAILABLE', message: 'Cannot reach IMDS' })
      );

      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 50 });
      const result = await service.publishMetrics();

      expect(result.kind).toBe('success');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to get instance ID for metrics, using "unknown"',
        expect.objectContaining({ error: 'Cannot reach IMDS' })
      );

      const call = (mockCloudWatch.send as jest.Mock).mock.calls[0][0];
      expect(call.input.MetricData[0].Dimensions[0].Value).toBe('unknown');
    });

    it('returns failure when CloudWatch publish fails after retries', async () => {
      mockCloudWatch.send = jest.fn().mockRejectedValue(new Error('CloudWatch unavailable'));

      service.recordRequest({ method: 'GET', path: '/', statusCode: 200, durationMs: 50 });
      const result = await service.publishMetrics();

      expect(result.kind).toBe('failure');
      if (result.kind === 'failure') {
        expect(result.error.code).toBe('AWS_SDK_ERROR');
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to publish metrics to CloudWatch',
        expect.any(Object)
      );
    });
  });

  describe('startPublishing / stopPublishing', () => {
    it('starts and stops interval without error', () => {
      jest.useFakeTimers();

      service.startPublishing();
      // Should not throw
      service.stopPublishing();

      jest.useRealTimers();
    });

    it('does not create multiple intervals on repeated start calls', () => {
      jest.useFakeTimers();

      service.startPublishing();
      service.startPublishing(); // second call should be no-op

      service.stopPublishing();
      jest.useRealTimers();
    });
  });
});
