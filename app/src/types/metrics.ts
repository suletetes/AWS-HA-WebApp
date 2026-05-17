/**
 * Metrics types for request tracking and CloudWatch publishing.
 */

/** A single recorded HTTP request with timing and status */
export interface RequestRecord {
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

/** Computed metrics for a publishing interval */
export interface AggregatedMetrics {
  readonly requestCount: number;
  readonly averageResponseTime: number;
  readonly errorRate: number;
}

/** Mutable accumulator state for the current metrics interval */
export interface MetricsState {
  requestCount: number;
  totalResponseTimeMs: number;
  errorCount: number;
  intervalStartTime: number;
}
