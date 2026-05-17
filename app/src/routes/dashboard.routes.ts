import { Router, Request, Response } from 'express';
import * as os from 'os';
import { IInstanceService, IMetadataService, ILogger } from '../services/interfaces';
import { InstanceInfo, AsgCapacity, ScalingActivity } from '../types';

/**
 * View model passed to the dashboard EJS template.
 * Supports graceful degradation — each section can independently
 * show data or an error message.
 */
export interface DashboardViewModel {
  instances: InstanceInfo[];
  capacity: AsgCapacity | null;
  scalingActivities: ScalingActivity[];
  currentInstance: { instanceId: string; uptime: number; cpuUsage: number } | null;
  errors: {
    instances: string | null;
    capacity: string | null;
    activities: string | null;
    currentInstance: string | null;
  };
  refreshInterval: number;
}

/**
 * Returns the current CPU usage as a percentage (0–100, one decimal place).
 */
function getCpuUsage(): number {
  const cpus = os.cpus();
  const total = cpus.reduce((acc, cpu) => {
    const times = cpu.times;
    return acc + times.user + times.nice + times.sys + times.idle + times.irq;
  }, 0);
  const idle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
  return Math.round(((total - idle) / total) * 1000) / 10;
}

/**
 * Creates the dashboard router.
 * GET / gathers data from all services in parallel and renders the
 * dashboard EJS template. Partial failures are handled gracefully —
 * the page always renders with error indicators in affected sections.
 */
export function createDashboardRouter(
  instanceService: IInstanceService,
  metadataService: IMetadataService,
  logger: ILogger,
  config: { dashboardRefreshMs: number }
): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const [instancesResult, capacityResult, activitiesResult, instanceIdResult] =
      await Promise.allSettled([
        instanceService.getInstances(),
        instanceService.getCapacity(),
        instanceService.getScalingActivities(10),
        metadataService.getInstanceId(),
      ]);

    const viewModel: DashboardViewModel = {
      instances: [],
      capacity: null,
      scalingActivities: [],
      currentInstance: null,
      errors: {
        instances: null,
        capacity: null,
        activities: null,
        currentInstance: null,
      },
      refreshInterval: config.dashboardRefreshMs,
    };

    // Process instances result
    if (instancesResult.status === 'fulfilled') {
      const result = instancesResult.value;
      if (result.kind === 'success') {
        viewModel.instances = result.value;
      } else {
        viewModel.errors.instances = result.error.message;
        logger.error('Dashboard: failed to load instances', { error: result.error.message });
      }
    } else {
      viewModel.errors.instances = instancesResult.reason?.message ?? 'Unknown error';
      logger.error('Dashboard: instances call rejected', { error: instancesResult.reason });
    }

    // Process capacity result
    if (capacityResult.status === 'fulfilled') {
      const result = capacityResult.value;
      if (result.kind === 'success') {
        viewModel.capacity = result.value;
      } else {
        viewModel.errors.capacity = result.error.message;
        logger.error('Dashboard: failed to load capacity', { error: result.error.message });
      }
    } else {
      viewModel.errors.capacity = capacityResult.reason?.message ?? 'Unknown error';
      logger.error('Dashboard: capacity call rejected', { error: capacityResult.reason });
    }

    // Process scaling activities result
    if (activitiesResult.status === 'fulfilled') {
      const result = activitiesResult.value;
      if (result.kind === 'success') {
        viewModel.scalingActivities = result.value;
      } else {
        viewModel.errors.activities = result.error.message;
        logger.error('Dashboard: failed to load scaling activities', { error: result.error.message });
      }
    } else {
      viewModel.errors.activities = activitiesResult.reason?.message ?? 'Unknown error';
      logger.error('Dashboard: activities call rejected', { error: activitiesResult.reason });
    }

    // Process current instance result
    if (instanceIdResult.status === 'fulfilled') {
      const result = instanceIdResult.value;
      if (result.kind === 'success') {
        viewModel.currentInstance = {
          instanceId: result.value,
          uptime: Math.floor(process.uptime()),
          cpuUsage: getCpuUsage(),
        };
      } else {
        viewModel.errors.currentInstance = result.error.message;
        logger.error('Dashboard: failed to load current instance', { error: result.error.message });
      }
    } else {
      viewModel.errors.currentInstance = instanceIdResult.reason?.message ?? 'Unknown error';
      logger.error('Dashboard: current instance call rejected', { error: instanceIdResult.reason });
    }

    // Always return 200 — graceful degradation
    res.status(200).render('dashboard', viewModel);
  });

  return router;
}
