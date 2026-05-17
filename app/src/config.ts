import * as dotenv from 'dotenv';
import { Result, AppError, success, failure } from './types/result';

export interface AppConfig {
  readonly port: number;
  readonly awsRegion: string;
  readonly asgName: string;
  readonly metricsNamespace: string;
  readonly metricsIntervalMs: number;
  readonly dashboardRefreshMs: number;
  readonly logFilePath: string;
  readonly logMaxSize: string;
  readonly logMaxFiles: number;
  readonly healthCheckTimeoutMs: number;
  readonly retryMaxAttempts: number;
  readonly retryBaseDelayMs: number;
}

export const CONFIG_DEFAULTS = {
  port: 3000,
  awsRegion: 'us-east-1',
  metricsNamespace: 'CloudPulse',
  metricsIntervalMs: 60_000,
  dashboardRefreshMs: 30_000,
  logFilePath: '/var/log/cloudpulse/app.log',
  logMaxSize: '50m',
  logMaxFiles: 5,
  healthCheckTimeoutMs: 5_000,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 1_000,
} as const;

export function loadConfig(): Result<AppConfig, AppError> {
  dotenv.config();

  const asgName = process.env.ASG_NAME;

  if (!asgName) {
    return failure({
      code: 'CONFIG_INVALID',
      message: 'Missing required environment variable: ASG_NAME',
    });
  }

  const config: AppConfig = {
    port: parseNumericEnv('PORT', CONFIG_DEFAULTS.port),
    awsRegion: process.env.AWS_REGION || CONFIG_DEFAULTS.awsRegion,
    asgName,
    metricsNamespace: process.env.METRICS_NAMESPACE || CONFIG_DEFAULTS.metricsNamespace,
    metricsIntervalMs: parseNumericEnv('METRICS_INTERVAL_MS', CONFIG_DEFAULTS.metricsIntervalMs),
    dashboardRefreshMs: parseNumericEnv('DASHBOARD_REFRESH_MS', CONFIG_DEFAULTS.dashboardRefreshMs),
    logFilePath: process.env.LOG_FILE_PATH || CONFIG_DEFAULTS.logFilePath,
    logMaxSize: process.env.LOG_MAX_SIZE || CONFIG_DEFAULTS.logMaxSize,
    logMaxFiles: parseNumericEnv('LOG_MAX_FILES', CONFIG_DEFAULTS.logMaxFiles),
    healthCheckTimeoutMs: parseNumericEnv('HEALTH_CHECK_TIMEOUT_MS', CONFIG_DEFAULTS.healthCheckTimeoutMs),
    retryMaxAttempts: parseNumericEnv('RETRY_MAX_ATTEMPTS', CONFIG_DEFAULTS.retryMaxAttempts),
    retryBaseDelayMs: parseNumericEnv('RETRY_BASE_DELAY_MS', CONFIG_DEFAULTS.retryBaseDelayMs),
  };

  return success(config);
}

function parseNumericEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}
