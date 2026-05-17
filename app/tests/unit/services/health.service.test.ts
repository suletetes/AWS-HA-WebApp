import { HealthService, HealthServiceConfig } from '../../../src/services/health.service';
import { IMetadataService, ILogger } from '../../../src/services/interfaces';
import { Result, AppError, success, failure } from '../../../src/types';

describe('HealthService', () => {
  let mockMetadataService: jest.Mocked<IMetadataService>;
  let mockLogger: jest.Mocked<ILogger>;
  let config: HealthServiceConfig;

  beforeEach(() => {
    mockMetadataService = {
      getInstanceId: jest.fn(),
      getAvailabilityZone: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    config = { healthCheckTimeoutMs: 5000 };
  });

  describe('getShallowHealth', () => {
    it('returns healthy when isReady is true (default)', () => {
      const service = new HealthService(mockMetadataService, mockLogger, config);

      const result = service.getShallowHealth();

      expect(result).toEqual({ status: 'healthy' });
    });

    it('returns unhealthy when isReady is set to false', () => {
      const service = new HealthService(mockMetadataService, mockLogger, config);
      service.setReady(false);

      const result = service.getShallowHealth();

      expect(result).toEqual({ status: 'unhealthy' });
    });

    it('returns healthy again after setReady(true)', () => {
      const service = new HealthService(mockMetadataService, mockLogger, config);
      service.setReady(false);
      service.setReady(true);

      const result = service.getShallowHealth();

      expect(result).toEqual({ status: 'healthy' });
    });
  });

  describe('getDeepHealth', () => {
    it('returns healthy when metadata service check succeeds', async () => {
      mockMetadataService.getInstanceId.mockResolvedValue(success('i-1234567890abcdef0'));
      const service = new HealthService(mockMetadataService, mockLogger, config);

      const result = await service.getDeepHealth();

      expect(result.status).toBe('healthy');
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].name).toBe('metadata');
      expect(result.checks[0].status).toBe('healthy');
      expect(result.checks[0].latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy when metadata service check fails', async () => {
      const error: AppError = { code: 'METADATA_UNAVAILABLE', message: 'Service unreachable' };
      mockMetadataService.getInstanceId.mockResolvedValue(failure(error));
      const service = new HealthService(mockMetadataService, mockLogger, config);

      const result = await service.getDeepHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].name).toBe('metadata');
      expect(result.checks[0].status).toBe('unhealthy');
    });

    it('returns unhealthy with timeout latency when check exceeds timeout', async () => {
      const shortConfig: HealthServiceConfig = { healthCheckTimeoutMs: 50 };
      mockMetadataService.getInstanceId.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(success('i-123')), 200))
      );
      const service = new HealthService(mockMetadataService, mockLogger, shortConfig);

      const result = await service.getDeepHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.checks[0].status).toBe('unhealthy');
      expect(result.checks[0].latencyMs).toBe(50);
    });

    it('returns unhealthy when check throws an unexpected error', async () => {
      mockMetadataService.getInstanceId.mockRejectedValue(new Error('Unexpected crash'));
      const service = new HealthService(mockMetadataService, mockLogger, config);

      const result = await service.getDeepHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.checks[0].status).toBe('unhealthy');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('logs a warning when a check times out', async () => {
      const shortConfig: HealthServiceConfig = { healthCheckTimeoutMs: 50 };
      mockMetadataService.getInstanceId.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(success('i-123')), 200))
      );
      const service = new HealthService(mockMetadataService, mockLogger, shortConfig);

      await service.getDeepHealth();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Health check timed out',
        expect.objectContaining({ name: 'metadata', timeoutMs: 50 })
      );
    });

    it('logs a warning when a check returns failure', async () => {
      const error: AppError = { code: 'METADATA_UNAVAILABLE', message: 'Cannot reach IMDS' };
      mockMetadataService.getInstanceId.mockResolvedValue(failure(error));
      const service = new HealthService(mockMetadataService, mockLogger, config);

      await service.getDeepHealth();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Health check failed',
        expect.objectContaining({ name: 'metadata' })
      );
    });
  });
});
