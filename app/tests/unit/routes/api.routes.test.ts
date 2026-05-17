import express from 'express';
import request from 'supertest';
import { createApiRouter } from '../../../src/routes/api.routes';
import { IInstanceService, IMetadataService, ILogger } from '../../../src/services/interfaces';
import { success, failure, AppError } from '../../../src/types/result';
import { InstanceInfo, AsgCapacity } from '../../../src/types/instance';

function createMockLogger(): ILogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function createMockMetadataService(overrides?: Partial<IMetadataService>): IMetadataService {
  return {
    getInstanceId: jest.fn().mockResolvedValue(success('i-0abc123def456')),
    getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
    ...overrides,
  };
}

function createMockInstanceService(overrides?: Partial<IInstanceService>): IInstanceService {
  return {
    getInstances: jest.fn().mockResolvedValue(success([])),
    getCapacity: jest.fn().mockResolvedValue(
      success({ min: 2, max: 4, desired: 2, actual: 2 })
    ),
    getScalingActivities: jest.fn().mockResolvedValue(success([])),
    ...overrides,
  };
}

function createApp(
  instanceService: IInstanceService,
  metadataService: IMetadataService,
  logger: ILogger
) {
  const app = express();
  app.use(createApiRouter(instanceService, metadataService, logger));
  return app;
}

describe('API Routes', () => {
  describe('GET /api/status', () => {
    it('returns 200 with instance status on success', async () => {
      const logger = createMockLogger();
      const metadataService = createMockMetadataService();
      const instanceService = createMockInstanceService();
      const app = createApp(instanceService, metadataService, logger);

      const res = await request(app).get('/api/status');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('instanceId', 'i-0abc123def456');
      expect(res.body).toHaveProperty('uptime');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
      expect(res.body).toHaveProperty('cpuUsage');
      expect(typeof res.body.cpuUsage).toBe('number');
    });

    it('returns 500 with error when metadata service fails', async () => {
      const logger = createMockLogger();
      const metadataService = createMockMetadataService({
        getInstanceId: jest.fn().mockResolvedValue(
          failure({
            code: 'METADATA_UNAVAILABLE',
            message: 'Failed to retrieve instance metadata',
          } as AppError)
        ),
      });
      const instanceService = createMockInstanceService();
      const app = createApp(instanceService, metadataService, logger);

      const res = await request(app).get('/api/status');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('Failed to retrieve instance metadata');
    });
  });

  describe('GET /api/instances', () => {
    it('returns 200 with instances and capacity on success', async () => {
      const instances: InstanceInfo[] = [
        {
          instanceId: 'i-001',
          state: 'running',
          healthStatus: 'Healthy',
          availabilityZone: 'us-east-1a',
        },
        {
          instanceId: 'i-002',
          state: 'running',
          healthStatus: 'Healthy',
          availabilityZone: 'us-east-1b',
        },
      ];
      const capacity: AsgCapacity = { min: 2, max: 4, desired: 2, actual: 2 };

      const logger = createMockLogger();
      const metadataService = createMockMetadataService();
      const instanceService = createMockInstanceService({
        getInstances: jest.fn().mockResolvedValue(success(instances)),
        getCapacity: jest.fn().mockResolvedValue(success(capacity)),
      });
      const app = createApp(instanceService, metadataService, logger);

      const res = await request(app).get('/api/instances');

      expect(res.status).toBe(200);
      expect(res.body.instances).toEqual(instances);
      expect(res.body.capacity).toEqual(capacity);
    });

    it('returns 500 when instances call fails', async () => {
      const logger = createMockLogger();
      const metadataService = createMockMetadataService();
      const instanceService = createMockInstanceService({
        getInstances: jest.fn().mockResolvedValue(
          failure({
            code: 'AWS_SDK_ERROR',
            message: 'AccessDenied',
          } as AppError)
        ),
      });
      const app = createApp(instanceService, metadataService, logger);

      const res = await request(app).get('/api/instances');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Failed to describe instances');
      expect(res.body.error).toContain('AccessDenied');
    });

    it('returns instances with capacity as null when capacity fails', async () => {
      const instances: InstanceInfo[] = [
        {
          instanceId: 'i-001',
          state: 'running',
          healthStatus: 'Healthy',
          availabilityZone: 'us-east-1a',
        },
      ];

      const logger = createMockLogger();
      const metadataService = createMockMetadataService();
      const instanceService = createMockInstanceService({
        getInstances: jest.fn().mockResolvedValue(success(instances)),
        getCapacity: jest.fn().mockResolvedValue(
          failure({
            code: 'AWS_SDK_ERROR',
            message: 'ASG not found',
          } as AppError)
        ),
      });
      const app = createApp(instanceService, metadataService, logger);

      const res = await request(app).get('/api/instances');

      expect(res.status).toBe(200);
      expect(res.body.instances).toEqual(instances);
      expect(res.body.capacity).toBeNull();
    });
  });
});
