import { Request, Response, NextFunction } from 'express';
import { ILogger } from '../services/interfaces';

/**
 * Creates an Express error-handling middleware that:
 * - Logs the error with the correlation ID (if available)
 * - Returns HTTP 500 with a structured JSON error response
 * - Never exposes stack traces or internal details to the client
 */
export function createErrorHandlerMiddleware(logger: ILogger) {
  return (err: Error, req: Request, res: Response, _next: NextFunction): void => {
    const correlationId = req.correlationId || 'unknown';

    logger.error('Unhandled error', {
      correlationId,
      error: err.message,
      path: req.path,
      method: req.method,
    });

    res.status(500).json({
      error: 'Internal server error',
      correlationId,
    });
  };
}
