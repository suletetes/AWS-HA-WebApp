import { Router, Request, Response } from 'express';
import { IHealthService } from '../services/interfaces';

/**
 * Creates health check routes.
 * GET /health — shallow health check for ALB with 5-second timeout guard.
 */
export function createHealthRoutes(healthService: IHealthService): Router {
  const router = Router();

  router.get('/health', (req: Request, res: Response) => {
    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({ status: 'unhealthy' });
      }
    }, 5000);

    try {
      const health = healthService.getShallowHealth();
      clearTimeout(timeoutId);
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      clearTimeout(timeoutId);
      res.status(503).json({ status: 'unhealthy' });
    }
  });

  return router;
}
