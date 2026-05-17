import {
  HealthResponse,
  DeepHealthResponse,
  DependencyCheck,
  Result,
  AppError,
  isSuccess,
} from '../types';
import { IHealthService, IMetadataService, ILogger } from './interfaces';

export interface HealthServiceConfig {
  readonly healthCheckTimeoutMs: number;
}

export class HealthService implements IHealthService {
  private isReady: boolean = true;

  constructor(
    private readonly metadataService: IMetadataService,
    private readonly logger: ILogger,
    private readonly config: HealthServiceConfig
  ) {}

  /**
   * Updates the readiness state of the application.
   */
  setReady(ready: boolean): void {
    this.isReady = ready;
  }

  /**
   * Returns immediate shallow health for ALB health checks.
   * Synchronous and fast — no async calls.
   */
  getShallowHealth(): HealthResponse {
    return { status: this.isReady ? 'healthy' : 'unhealthy' };
  }

  /**
   * Runs dependency checks in parallel with a timeout and returns detailed health status.
   */
  async getDeepHealth(): Promise<DeepHealthResponse> {
    const checks = await Promise.all([
      this.checkWithTimeout('metadata', () => this.metadataService.getInstanceId()),
    ]);

    const overallStatus = checks.every((check) => check.status === 'healthy')
      ? 'healthy'
      : 'unhealthy';

    return { status: overallStatus, checks };
  }

  /**
   * Races a dependency check function against a timeout.
   * Returns a DependencyCheck with name, status, and latencyMs.
   */
  private async checkWithTimeout<T>(
    name: string,
    fn: () => Promise<Result<T, AppError>>
  ): Promise<DependencyCheck> {
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        fn(),
        this.createTimeout(),
      ]);

      const latencyMs = Date.now() - startTime;

      if (result === null) {
        // Timeout occurred
        this.logger.warn('Health check timed out', { name, timeoutMs: this.config.healthCheckTimeoutMs });
        return { name, status: 'unhealthy', latencyMs: this.config.healthCheckTimeoutMs };
      }

      const status = isSuccess(result) ? 'healthy' : 'unhealthy';

      if (!isSuccess(result)) {
        this.logger.warn('Health check failed', { name, error: result.error });
      }

      return { name, status, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.error('Health check threw unexpected error', { name, error });
      return { name, status: 'unhealthy', latencyMs };
    }
  }

  /**
   * Creates a timeout promise that resolves to null after the configured timeout.
   */
  private createTimeout(): Promise<null> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(null), this.config.healthCheckTimeoutMs);
    });
  }
}
