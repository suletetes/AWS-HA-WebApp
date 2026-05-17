import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  DescribeScalingActivitiesCommand,
} from '@aws-sdk/client-auto-scaling';
import { IInstanceService } from './interfaces';
import { ILogger } from '../utils/logger';
import { Result, AppError, success, failure } from '../types/result';
import { InstanceInfo, AsgCapacity, ScalingActivity } from '../types/instance';

export class InstanceService implements IInstanceService {
  private readonly ec2Client: EC2Client;
  private readonly autoScalingClient: AutoScalingClient;
  private readonly logger: ILogger;
  private readonly asgName: string;

  constructor(
    ec2Client: EC2Client,
    autoScalingClient: AutoScalingClient,
    logger: ILogger,
    config: { asgName: string }
  ) {
    this.ec2Client = ec2Client;
    this.autoScalingClient = autoScalingClient;
    this.logger = logger;
    this.asgName = config.asgName;
  }

  async getInstances(): Promise<Result<InstanceInfo[], AppError>> {
    try {
      // Get instance IDs and health statuses from the ASG
      const asgResponse = await this.autoScalingClient.send(
        new DescribeAutoScalingGroupsCommand({
          AutoScalingGroupNames: [this.asgName],
        })
      );

      const asgGroup = asgResponse.AutoScalingGroups?.[0];
      if (!asgGroup || !asgGroup.Instances || asgGroup.Instances.length === 0) {
        this.logger.info('No instances found in ASG', { asgName: this.asgName });
        return success([]);
      }

      const instanceIds = asgGroup.Instances.map((i) => i.InstanceId!);
      const healthStatusMap = new Map<string, string>();
      for (const instance of asgGroup.Instances) {
        healthStatusMap.set(instance.InstanceId!, instance.HealthStatus ?? 'Unknown');
      }

      // Get detailed instance info from EC2
      const ec2Response = await this.ec2Client.send(
        new DescribeInstancesCommand({
          InstanceIds: instanceIds,
        })
      );

      const instances: InstanceInfo[] = [];
      for (const reservation of ec2Response.Reservations ?? []) {
        for (const instance of reservation.Instances ?? []) {
          instances.push({
            instanceId: instance.InstanceId ?? 'unknown',
            state: instance.State?.Name ?? 'unknown',
            healthStatus: healthStatusMap.get(instance.InstanceId!) ?? 'Unknown',
            availabilityZone: instance.Placement?.AvailabilityZone ?? 'unknown',
          });
        }
      }

      this.logger.debug('Retrieved instance information', {
        count: instances.length,
        asgName: this.asgName,
      });

      return success(instances);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to describe instances', {
        asgName: this.asgName,
        error: message,
      });
      return failure({
        code: 'AWS_SDK_ERROR',
        message: `Failed to describe instances: ${message}`,
        cause: error,
      });
    }
  }

  async getCapacity(): Promise<Result<AsgCapacity, AppError>> {
    try {
      const response = await this.autoScalingClient.send(
        new DescribeAutoScalingGroupsCommand({
          AutoScalingGroupNames: [this.asgName],
        })
      );

      const asgGroup = response.AutoScalingGroups?.[0];
      if (!asgGroup) {
        return failure({
          code: 'AWS_SDK_ERROR',
          message: `ASG not found: ${this.asgName}`,
        });
      }

      const capacity: AsgCapacity = {
        min: asgGroup.MinSize ?? 0,
        max: asgGroup.MaxSize ?? 0,
        desired: asgGroup.DesiredCapacity ?? 0,
        actual: asgGroup.Instances?.length ?? 0,
      };

      this.logger.debug('Retrieved ASG capacity', {
        asgName: this.asgName,
        ...capacity,
      });

      return success(capacity);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to describe ASG capacity', {
        asgName: this.asgName,
        error: message,
      });
      return failure({
        code: 'AWS_SDK_ERROR',
        message: `Failed to describe ASG capacity: ${message}`,
        cause: error,
      });
    }
  }

  async getScalingActivities(limit: number): Promise<Result<ScalingActivity[], AppError>> {
    try {
      const response = await this.autoScalingClient.send(
        new DescribeScalingActivitiesCommand({
          AutoScalingGroupName: this.asgName,
          MaxRecords: limit,
        })
      );

      const activities: ScalingActivity[] = (response.Activities ?? []).map((activity) => ({
        timestamp: activity.StartTime?.toISOString() ?? new Date(0).toISOString(),
        description: activity.Description ?? '',
        statusCode: activity.StatusCode ?? 'Unknown',
      }));

      this.logger.debug('Retrieved scaling activities', {
        asgName: this.asgName,
        count: activities.length,
        limit,
      });

      return success(activities);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to describe scaling activities', {
        asgName: this.asgName,
        error: message,
      });
      return failure({
        code: 'AWS_SDK_ERROR',
        message: `Failed to describe scaling activities: ${message}`,
        cause: error,
      });
    }
  }
}
