/**
 * Barrel export for all application types.
 */

export {
  ErrorCode,
  AppError,
  Success,
  Failure,
  Result,
  success,
  failure,
  isSuccess,
  isFailure,
} from './result';

export {
  HealthStatus,
  HealthResponse,
  DependencyCheck,
  DeepHealthResponse,
} from './health';

export {
  RequestRecord,
  AggregatedMetrics,
  MetricsState,
} from './metrics';

export {
  InstanceInfo,
  AsgCapacity,
  ScalingActivity,
  InstanceStatus,
} from './instance';
