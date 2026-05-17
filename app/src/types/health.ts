/**
 * Health check types for shallow (ALB) and deep (dashboard) health endpoints.
 */

/** Binary health status */
export type HealthStatus = 'healthy' | 'unhealthy';

/** Shallow health response returned by GET /health */
export interface HealthResponse {
  readonly status: HealthStatus;
}

/** Individual dependency check result with latency */
export interface DependencyCheck {
  readonly name: string;
  readonly status: HealthStatus;
  readonly latencyMs: number;
}

/** Deep health response with per-dependency breakdown */
export interface DeepHealthResponse {
  readonly status: HealthStatus;
  readonly checks: readonly DependencyCheck[];
}
