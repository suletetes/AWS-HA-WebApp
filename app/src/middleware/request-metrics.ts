import { Request, Response, NextFunction } from 'express';
import { IMetricsService } from '../services/interfaces';

/**
 * Factory function that creates Express middleware for recording request metrics.
 * The middleware captures request timing and status, then reports to the metrics service.
 *
 * @param metricsService - The metrics service to record request data to
 * @returns Express middleware function
 */
export function createRequestMetricsMiddleware(metricsService: IMetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      metricsService.recordRequest({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    next();
  };
}
