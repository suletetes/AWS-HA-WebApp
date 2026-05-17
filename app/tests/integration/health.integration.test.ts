import request from 'supertest';
import { createApp } from '../../src/index';
import { createContainer } from '../../src/container';
import { AppConfig, CONFIG_DEFAULTS } from '../../src/config';
import { IMetadataService, IMetricsService } from '../../src/services/interfaces';
import { ILogger } from '../../src/utils/logger';
import { HealthService } from '../../src/services/health.service';
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

describe('GET /health - Integration', () => {
  it('returns 200 with {"status":"healthy"} when app is healthy', async () => {
    const mockMetadata: IMetadataService = {
      getInstanceId: jest.fn().mockResolvedValue(success('i-test')),
      getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
    };
    const container = createContainer(testConfig, {
      metadataService: mockMetadata,
      metricsService: mockMetricsService,
      logger: mockLogger,
    });
    const app = createApp(container);

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'healthy' });
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('returns 503 with {"status":"unhealthy"} when health service reports unhealthy', async () => {
    const mockMetadata: IMetadataService = {
      getInstanceId: jest.fn().mockResolvedValue(failure({ code: 'METADATA_UNAVAILABLE' as const, message: 'fail' })),
      getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
    };
    const container = createContainer(testConfig, {
      metadataService: mockMetadata,
      metricsService: mockMetricsService,
      logger: mockLogger,
    });
    // Set health service to unhealthy
    (container.healthService as HealthService).setReady(false);
    const app = createApp(container);

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unhealthy' });
  });
});
