import request from 'supertest';
import { createApp } from '../../src/index';
import { createContainer } from '../../src/container';
import { AppConfig, CONFIG_DEFAULTS } from '../../src/config';
import { IMetadataService, IInstanceService, IMetricsService } from '../../src/services/interfaces';
import { ILogger } from '../../src/utils/logger';
import { success, failure } from '../../src/types';

const testConfig: AppConfig = {
  ...CONFIG_DEFAULTS,
  asgName: 'test-asg',
  port: 3000,
  awsRegion: 'us-east-1',
};

const mockLogger: ILogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockMetricsService: IMetricsService = {
  recordRequest: jest.fn(),
  flushMetrics: jest.fn().mockReturnValue({ requestCount: 0, averageResponseTime: 0, errorRate: 0 }),
  publishMetrics: jest.fn().mockResolvedValue(success(undefined)),
  startPublishing: jest.fn(),
  stopPublishing: jest.fn(),
};

describe('API Endpoints - Integration', () => {
  describe('GET /api/status', () => {
    it('returns instance metadata JSON when metadata service succeeds', async () => {
      const mockMetadata: IMetadataService = {
        getInstanceId: jest.fn().mockResolvedValue(success('i-abc123')),
        getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
      };
      const container = createContainer(testConfig, {
        metadataService: mockMetadata,
        metricsService: mockMetricsService,
        logger: mockLogger,
      });
      const app = createApp(container);

      const res = await request(app).get('/api/status');
      expect(res.status).toBe(200);
      expect(res.body.instanceId).toBe('i-abc123');
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof res.body.cpuUsage).toBe('number');
    });

    it('returns 500 when metadata service fails', async () => {
      const mockMetadata: IMetadataService = {
        getInstanceId: jest.fn().mockResolvedValue(failure({ code: 'METADATA_UNAVAILABLE' as const, message: 'IMDS unreachable' })),
        getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
      };
      const container = createContainer(testConfig, {
        metadataService: mockMetadata,
        metricsService: mockMetricsService,
        logger: mockLogger,
      });
      const app = createApp(container);

      const res = await request(app).get('/api/status');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
      expect(res.body.error).toContain('IMDS');
    });
  });

  describe('GET /api/instances', () => {
    it('returns instances and capacity when service succeeds', async () => {
      const mockMetadata: IMetadataService = {
        getInstanceId: jest.fn().mockResolvedValue(success('i-test')),
        getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
      };
      const mockInstanceService: IInstanceService = {
        getInstances: jest.fn().mockResolvedValue(success([
          { instanceId: 'i-abc', state: 'running', healthStatus: 'Healthy', availabilityZone: 'us-east-1a' },
        ])),
        getCapacity: jest.fn().mockResolvedValue(success({ min: 2, max: 4, desired: 2, actual: 2 })),
        getScalingActivities: jest.fn().mockResolvedValue(success([])),
      };
      const container = createContainer(testConfig, {
        metadataService: mockMetadata,
        instanceService: mockInstanceService,
        metricsService: mockMetricsService,
        logger: mockLogger,
      });
      const app = createApp(container);

      const res = await request(app).get('/api/instances');
      expect(res.status).toBe(200);
      expect(res.body.instances).toHaveLength(1);
      expect(res.body.instances[0].instanceId).toBe('i-abc');
      expect(res.body.capacity).toEqual({ min: 2, max: 4, desired: 2, actual: 2 });
    });

    it('returns 500 when instance service fails', async () => {
      const mockMetadata: IMetadataService = {
        getInstanceId: jest.fn().mockResolvedValue(success('i-test')),
        getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
      };
      const mockInstanceService: IInstanceService = {
        getInstances: jest.fn().mockResolvedValue(failure({ code: 'AWS_SDK_ERROR' as const, message: 'Access Denied' })),
        getCapacity: jest.fn().mockResolvedValue(success({ min: 2, max: 4, desired: 2, actual: 2 })),
        getScalingActivities: jest.fn().mockResolvedValue(success([])),
      };
      const container = createContainer(testConfig, {
        metadataService: mockMetadata,
        instanceService: mockInstanceService,
        metricsService: mockMetricsService,
        logger: mockLogger,
      });
      const app = createApp(container);

      const res = await request(app).get('/api/instances');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Access Denied');
    });
  });
});
