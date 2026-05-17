/**
 * Service interfaces for dependency injection.
 * All route handlers and controllers depend on these interfaces,
 * enabling testability through mock implementations.
 */

import {
  Result,
  AppError,
  HealthResponse,
  DeepHealthResponse,
  RequestRecord,
  AggregatedMetrics,
  InstanceInfo,
  AsgCapacity,
  ScalingActivity,
} from '../types';
import { ILogger } from '../utils/logger';

export { ILogger } from '../utils/logger';

export interface IHealthService {
  getShallowHealth(): HealthResponse;
  getDeepHealth(): Promise<DeepHealthResponse>;
}

export interface IMetricsService {
  recordRequest(record: RequestRecord): void;
  flushMetrics(): AggregatedMetrics;
  publishMetrics(): Promise<Result<void, AppError>>;
  startPublishing(): void;
  stopPublishing(): void;
}

export interface IInstanceService {
  getInstances(): Promise<Result<InstanceInfo[], AppError>>;
  getCapacity(): Promise<Result<AsgCapacity, AppError>>;
  getScalingActivities(limit: number): Promise<Result<ScalingActivity[], AppError>>;
}

export interface IMetadataService {
  getInstanceId(): Promise<Result<string, AppError>>;
  getAvailabilityZone(): Promise<Result<string, AppError>>;
}
