import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ILogger } from '../utils/logger';

/**
 * Extend Express Request type to include correlationId.
 */
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Creates an Express middleware that:
 * - Generates a UUID v4 correlation ID for each request
 * - Attaches the correlation ID to the request object
 * - Sets the X-Correlation-ID response header
 * - Logs request details (method, path, status, duration, correlationId) on response finish
 * - Uses info for 2xx/3xx, warn for 4xx, error for 5xx
 */
export function createRequestLoggerMiddleware(logger: ILogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = uuidv4();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    const startTime = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const { method } = req;
      const path = req.originalUrl || req.url;
      const { statusCode } = res;

      const logMeta: Record<string, unknown> = {
        method,
        path,
        statusCode,
        durationMs,
        correlationId,
      };

      const message = `${method} ${path} ${statusCode} ${durationMs}ms`;

      if (statusCode >= 500) {
        logger.error(message, logMeta);
      } else if (statusCode >= 400) {
        logger.warn(message, logMeta);
      } else {
        logger.info(message, logMeta);
      }
    });

    next();
  };
}
