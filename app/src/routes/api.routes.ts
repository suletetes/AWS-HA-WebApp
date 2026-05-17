import { Router, Request, Response } from 'express';
import * as os from 'os';
import { IMetadataService, IInstanceService, ILogger } from '../services/interfaces';
import { isSuccess, isFailure } from '../types/result';

/**
 * Creates an Express Router for API endpoints.
 *
 * GET /api/status — returns instance ID, uptime (seconds), and CPU usage (%)
 * GET /api/instances — returns ASG instances and capacity information
 */
export function createApiRouter(
  instanceService: IInstanceService,
  metadataService: IMetadataService,
  logger: ILogger
): Router {
  const router = Router();

  router.get('/api/status', async (_req: Request, res: Response) => {
    const instanceIdResult = await metadataService.getInstanceId();

    if (isFailure(instanceIdResult)) {
      logger.error('Failed to get instance ID for status endpoint', {
        error: instanceIdResult.error.message,
      });
      return res.status(500).json({ error: instanceIdResult.error.message });
    }

    const cpus = os.cpus();
    const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
    const totalTick = cpus.reduce(
      (acc, cpu) => acc + Object.values(cpu.times).reduce((a, b) => a + b, 0),
      0
    );
    const cpuUsage = Math.round((1 - totalIdle / totalTick) * 1000) / 10;

    res.json({
      instanceId: instanceIdResult.value,
      uptime: Math.floor(process.uptime()),
      cpuUsage,
    });
  });

  router.get('/api/instances', async (_req: Request, res: Response) => {
    const [instancesResult, capacityResult] = await Promise.all([
      instanceService.getInstances(),
      instanceService.getCapacity(),
    ]);

    if (isFailure(instancesResult)) {
      logger.error('Failed to get instances', {
        error: instancesResult.error.message,
      });
      return res.status(500).json({
        error: `Failed to describe instances: ${instancesResult.error.message}`,
      });
    }

    const capacity = isSuccess(capacityResult) ? capacityResult.value : null;

    if (isFailure(capacityResult)) {
      logger.warn('Failed to get capacity, returning null', {
        error: capacityResult.error.message,
      });
    }

    res.json({
      instances: instancesResult.value,
      capacity,
    });
  });

  return router;
}
