import express from 'express';
import path from 'path';
import { loadConfig } from './config';
import { isFailure } from './types/result';
import { createContainer, Container } from './container';
import { createRequestLoggerMiddleware } from './middleware/request-logger';
import { createRequestMetricsMiddleware } from './middleware/request-metrics';
import { createErrorHandlerMiddleware } from './middleware/error-handler';
import { createHealthRoutes } from './routes/health.routes';
import { createApiRouter } from './routes/api.routes';
import { createDashboardRouter } from './routes/dashboard.routes';

/**
 * Creates an Express application with all middleware and routes wired up.
 * Useful for integration testing without starting the HTTP server.
 */
export function createApp(container: Container): express.Application {
  const app = express();

  // Configure EJS view engine
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Register middleware (order matters)
  app.use(createRequestLoggerMiddleware(container.logger));
  app.use(createRequestMetricsMiddleware(container.metricsService));

  // Register routes
  app.use(createHealthRoutes(container.healthService));
  app.use(createApiRouter(container.instanceService, container.metadataService, container.logger));
  app.use(createDashboardRouter(container.instanceService, container.metadataService, container.logger, { dashboardRefreshMs: container.config.dashboardRefreshMs }));

  // Error handler (must be last)
  app.use(createErrorHandlerMiddleware(container.logger));

  return app;
}

async function main(): Promise<void> {
  // Load and validate configuration
  const configResult = loadConfig();
  if (isFailure(configResult)) {
    console.error(`Configuration error: ${configResult.error.message}`);
    process.exit(1);
  }
  const config = configResult.value;

  // Create DI container
  const container = createContainer(config);
  const { logger, metricsService } = container;

  logger.info('Starting CloudPulse Dashboard', { port: config.port, asgName: config.asgName });

  // Create Express app
  const app = createApp(container);

  // Start metrics publishing
  metricsService.startPublishing();
  logger.info('Metrics publishing started', { intervalMs: config.metricsIntervalMs });

  // Start HTTP server
  const server = app.listen(config.port, () => {
    logger.info(`CloudPulse Dashboard listening on port ${config.port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    metricsService.stopPublishing();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only run main when this file is executed directly (not imported for testing)
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
