import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { IMetadataService, IMetricsService, ILogger } from './interfaces';
import { RequestRecord, AggregatedMetrics, MetricsState, Result, AppError, success } from '../types';
import { withRetry } from '../utils/retry';

export interface MetricsServiceConfig {
  readonly metricsNamespace: string;
  readonly metricsIntervalMs: number;
  readonly retryMaxAttempts: number;
  readonly retryBaseDelayMs: number;
}

export class MetricsService implements IMetricsService {
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly metadataService: IMetadataService;
  private readonly logger: ILogger;
  private readonly config: MetricsServiceConfig;
  private state: MetricsState;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    cloudWatchClient: CloudWatchClient,
    metadataService: IMetadataService,
    logger: ILogger,
    config: MetricsServiceConfig
  ) {
    this.cloudWatchClient = cloudWatchClient;
    this.metadataService = metadataService;
    this.logger = logger;
    this.config = config;
    this.state = {
      requestCount: 0,
      totalResponseTimeMs: 0,
      errorCount: 0,
      intervalStartTime: Date.now(),
    };
  }

  recordRequest(record: RequestRecord): void {
    this.state.requestCount++;
    this.state.totalResponseTimeMs += record.durationMs;
    if (record.statusCode >= 500) {
      this.state.errorCount++;
    }
  }

  flushMetrics(): AggregatedMetrics {
    const { requestCount, totalResponseTimeMs, errorCount } = this.state;

    const averageResponseTime = requestCount > 0
      ? totalResponseTimeMs / requestCount
      : 0;

    const errorRate = requestCount > 0
      ? (errorCount / requestCount) * 100
      : 0;

    // Reset state
    this.state = {
      requestCount: 0,
      totalResponseTimeMs: 0,
      errorCount: 0,
      intervalStartTime: Date.now(),
    };

    return { requestCount, averageResponseTime, errorRate };
  }

  async publishMetrics(): Promise<Result<void, AppError>> {
    const metrics = this.flushMetrics();

    // Get instance ID, fallback to 'unknown' on failure
    let instanceId = 'unknown';
    const instanceIdResult = await this.metadataService.getInstanceId();
    if (instanceIdResult.kind === 'success') {
      instanceId = instanceIdResult.value;
    } else {
      this.logger.warn('Failed to get instance ID for metrics, using "unknown"', {
        error: instanceIdResult.error.message,
      });
    }

    const command = new PutMetricDataCommand({
      Namespace: this.config.metricsNamespace,
      MetricData: [
        {
          MetricName: 'RequestCount',
          Value: metrics.requestCount,
          Unit: 'Count',
          Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
        },
        {
          MetricName: 'AverageResponseTime',
          Value: metrics.averageResponseTime,
          Unit: 'Milliseconds',
          Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
        },
        {
          MetricName: 'ErrorRate',
          Value: metrics.errorRate,
          Unit: 'Percent',
          Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
        },
      ],
    });

    const result = await withRetry(
      () => this.cloudWatchClient.send(command),
      {
        maxRetries: this.config.retryMaxAttempts,
        baseDelayMs: this.config.retryBaseDelayMs,
      }
    );

    if (result.kind === 'success') {
      this.logger.debug('Metrics published successfully', {
        instanceId,
        requestCount: metrics.requestCount,
        averageResponseTime: metrics.averageResponseTime,
        errorRate: metrics.errorRate,
      });
      return success(undefined);
    }

    this.logger.error('Failed to publish metrics to CloudWatch', {
      error: result.error.message,
      instanceId,
    });
    return result as Result<void, AppError>;
  }

  startPublishing(): void {
    if (this.intervalId !== null) {
      return;
    }
    this.intervalId = setInterval(() => {
      this.publishMetrics().catch((err) => {
        this.logger.error('Unexpected error in metrics publishing interval', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.config.metricsIntervalMs);
  }

  stopPublishing(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
