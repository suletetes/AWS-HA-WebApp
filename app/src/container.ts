import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { EC2Client } from '@aws-sdk/client-ec2';
import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';
import { AppConfig } from './config';
import { ILogger, createLogger } from './utils/logger';
import { IHealthService, IMetricsService, IInstanceService, IMetadataService } from './services/interfaces';
import { HealthService } from './services/health.service';
import { MetricsService } from './services/metrics.service';
import { InstanceService } from './services/instance.service';
import { MetadataService } from './services/metadata.service';

export interface Container {
  readonly config: AppConfig;
  readonly logger: ILogger;
  readonly cloudWatchClient: CloudWatchClient;
  readonly ec2Client: EC2Client;
  readonly autoScalingClient: AutoScalingClient;
  readonly metadataService: IMetadataService;
  readonly metricsService: IMetricsService;
  readonly instanceService: IInstanceService;
  readonly healthService: IHealthService;
}

export interface ContainerOverrides {
  logger?: ILogger;
  cloudWatchClient?: CloudWatchClient;
  ec2Client?: EC2Client;
  autoScalingClient?: AutoScalingClient;
  metadataService?: IMetadataService;
  metricsService?: IMetricsService;
  instanceService?: IInstanceService;
  healthService?: IHealthService;
}

export function createContainer(config: AppConfig, overrides?: ContainerOverrides): Container {
  const logger = overrides?.logger ?? createLogger({
    logFilePath: config.logFilePath,
    logMaxSize: config.logMaxSize,
    logMaxFiles: config.logMaxFiles,
  });

  const cloudWatchClient = overrides?.cloudWatchClient ?? new CloudWatchClient({ region: config.awsRegion });
  const ec2Client = overrides?.ec2Client ?? new EC2Client({ region: config.awsRegion });
  const autoScalingClient = overrides?.autoScalingClient ?? new AutoScalingClient({ region: config.awsRegion });

  const metadataService = overrides?.metadataService ?? new MetadataService(logger);

  const metricsService = overrides?.metricsService ?? new MetricsService(
    cloudWatchClient,
    metadataService,
    logger,
    {
      metricsNamespace: config.metricsNamespace,
      metricsIntervalMs: config.metricsIntervalMs,
      retryMaxAttempts: config.retryMaxAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
    }
  );

  const instanceService = overrides?.instanceService ?? new InstanceService(
    ec2Client,
    autoScalingClient,
    logger,
    { asgName: config.asgName }
  );

  const healthService = overrides?.healthService ?? new HealthService(
    metadataService,
    logger,
    { healthCheckTimeoutMs: config.healthCheckTimeoutMs }
  );

  return {
    config,
    logger,
    cloudWatchClient,
    ec2Client,
    autoScalingClient,
    metadataService,
    metricsService,
    instanceService,
    healthService,
  };
}
