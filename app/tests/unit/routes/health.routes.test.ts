import express from 'express';
import request from 'supertest';
import { createHealthRoutes } from '../../../src/routes/health.routes';
import { IHealthService } from '../../../src/services/interfaces';
import { HealthResponse, DeepHealthResponse } from '../../../src/types';

function createMockHealthService(overrides: Partial<IHealthService> = {}): IHealthService {
  return {
    getShallowHealth: jest.fn().mockReturnValue({ status: 'healthy' }),
    getDeepHealth: jest.fn().mockResolvedValue({ status: 'healthy', checks: [] }),
    ...overrides,
  };
}

function createApp(healthService: IHealthService) {
  const app = express();
  app.use(createHealthRoutes(healthService));
  return app;
}

describe('Health Routes', () => {
  describe('GET /health', () => {
    it('returns 200 with healthy status when service reports healthy', async () => {
      const healthService = createMockHealthService({
        getShallowHealth: jest.fn().mockReturnValue({ status: 'healthy' }),
      });
      const app = createApp(healthService);

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'healthy' });
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('returns 503 with unhealthy status when service reports unhealthy', async () => {
      const healthService = createMockHealthService({
        getShallowHealth: jest.fn().mockReturnValue({ status: 'unhealthy' }),
      });
      const app = createApp(healthService);

      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'unhealthy' });
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('returns 503 when getShallowHealth throws an error', async () => {
      const healthService = createMockHealthService({
        getShallowHealth: jest.fn().mockImplementation(() => {
          throw new Error('Unexpected failure');
        }),
      });
      const app = createApp(healthService);

      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'unhealthy' });
    });

    it('calls healthService.getShallowHealth exactly once', async () => {
      const getShallowHealth = jest.fn().mockReturnValue({ status: 'healthy' });
      const healthService = createMockHealthService({ getShallowHealth });
      const app = createApp(healthService);

      await request(app).get('/health');

      expect(getShallowHealth).toHaveBeenCalledTimes(1);
    });
  });
});
