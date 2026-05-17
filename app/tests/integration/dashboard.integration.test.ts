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

describe('Dashboard - Integration', () => {
  it('GET / returns HTML with instance data', async () => {
    const mockMetadata: IMetadataService = {
      getInstanceId: jest.fn().mockResolvedValue(success('i-dashboard')),
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

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('i-abc');
    expect(res.text).toContain('Healthy');
  });

  it('GET / renders error indicators on partial API failure', async () => {
    const mockMetadata: IMetadataService = {
      getInstanceId: jest.fn().mockResolvedValue(success('i-dashboard')),
      getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
    };
    const mockInstanceService: IInstanceService = {
      getInstances: jest.fn().mockResolvedValue(failure({ code: 'AWS_SDK_ERROR' as const, message: 'Timeout' })),
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

    const res = await request(app).get('/');
    expect(res.status).toBe(200); // Still returns 200 with error indicators
    expect(res.text).toContain('error'); // Error indicator present
  });

  it('GET / includes auto-refresh meta tag', async () => {
    const mockMetadata: IMetadataService = {
      getInstanceId: jest.fn().mockResolvedValue(success('i-test')),
      getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
    };
    const mockInstanceService: IInstanceService = {
      getInstances: jest.fn().mockResolvedValue(success([])),
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

    const res = await request(app).get('/');
    expect(res.text).toContain('http-equiv="refresh"');
  });
});
