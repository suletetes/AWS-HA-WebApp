import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  DescribeScalingActivitiesCommand,
} from '@aws-sdk/client-auto-scaling';
import { InstanceService } from '../../../src/services/instance.service';
import { ILogger } from '../../../src/utils/logger';
import { isSuccess, isFailure } from '../../../src/types/result';

const mockLogger: ILogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function createMockEc2Client(sendFn: jest.Mock): EC2Client {
  const client = { send: sendFn } as unknown as EC2Client;
  return client;
}

function createMockAutoScalingClient(sendFn: jest.Mock): AutoScalingClient {
  const client = { send: sendFn } as unknown as AutoScalingClient;
  return client;
}

describe('InstanceService', () => {
  const config = { asgName: 'test-asg' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getInstances', () => {
    it('should return instance info when ASG has instances', async () => {
      const asgSend = jest.fn().mockResolvedValue({
        AutoScalingGroups: [
          {
            Instances: [
              { InstanceId: 'i-abc123', HealthStatus: 'Healthy' },
              { InstanceId: 'i-def456', HealthStatus: 'Unhealthy' },
            ],
          },
        ],
      });

      const ec2Send = jest.fn().mockResolvedValue({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: 'i-abc123',
                State: { Name: 'running' },
                Placement: { AvailabilityZone: 'us-east-1a' },
              },
              {
                InstanceId: 'i-def456',
                State: { Name: 'running' },
                Placement: { AvailabilityZone: 'us-east-1b' },
              },
            ],
          },
        ],
      });

      const service = new InstanceService(
        createMockEc2Client(ec2Send),
        createMockAutoScalingClient(asgSend),
        mockLogger,
        config
      );

      const result = await service.getInstances();

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]).toEqual({
          instanceId: 'i-abc123',
          state: 'running',
          healthStatus: 'Healthy',
          availabilityZone: 'us-east-1a',
        });
        expect(result.value[1]).toEqual({
          instanceId: 'i-def456',
          state: 'running',
          healthStatus: 'Unhealthy',
          availabilityZone: 'us-east-1b',
        });
      }
    });

    it('should return empty array when ASG has no instances', async () => {
      const asgSend = jest.fn().mockResolvedValue({
        AutoScalingGroups: [
          {
            Instances: [],
          },
        ],
      });

      const ec2Send = jest.fn();

      const service = new InstanceService(
        createMockEc2Client(ec2Send),
        createMockAutoScalingClient(asgSend),
        mockLogger,
        config
      );

      const result = await service.getInstances();

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.value).toEqual([]);
      }
      expect(ec2Send).not.toHaveBeenCalled();
    });

    it('should return failure on AWS SDK error', async () => {
      const asgSend = jest.fn().mockRejectedValue(new Error('Access Denied'));
      const ec2Send = jest.fn();

      const service = new InstanceService(
        createMockEc2Client(ec2Send),
        createMockAutoScalingClient(asgSend),
        mockLogger,
        config
      );

      const result = await service.getInstances();

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe('AWS_SDK_ERROR');
        expect(result.error.message).toContain('Failed to describe instances');
        expect(result.error.message).toContain('Access Denied');
      }
    });
  });

  describe('getCapacity', () => {
    it('should return ASG capacity', async () => {
      const asgSend = jest.fn().mockResolvedValue({
        AutoScalingGroups: [
          {
            MinSize: 2,
            MaxSize: 4,
            DesiredCapacity: 2,
            Instances: [
              { InstanceId: 'i-abc123' },
              { InstanceId: 'i-def456' },
            ],
          },
        ],
      });

      const service = new InstanceService(
        createMockEc2Client(jest.fn()),
        createMockAutoScalingClient(asgSend),
        mockLogger,
        config
      );

      const result = await service.getCapacity();

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.value).toEqual({
          min: 2,
          max: 4,
          desired: 2,
          actual: 2,
        });
      }
    });

    it('should return failure when ASG not found', async () => {
      const asgSend = jest.fn().mockResolvedValue({
        AutoScalingGroups: [],
      });

      const service = new InstanceService(
        createMockEc2Client(jest.fn()),
        createMockAutoScalingClient(asgSend),
        mockLogger,
        config
      );

      const result = await service.getCapacity();

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe('AWS_SDK_ERROR');
        expect(result.error.message).toContain('ASG not found');
      }
    });

    it('should return failure on AWS SDK error', async () => {
      const asgSend = jest.fn().mockRejectedValue(new Error('Throttling'));

      const service = new InstanceService(
        createMockEc2Client(jest.fn()),
        createMockAutoScalingClient(asgSend),
        mockLogger,
        config
      );

      const result = await service.getCapacity();

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe('AWS_SDK_ERROR');
        expect(result.error.message).toContain('Failed to describe ASG capacity');
        expect(result.error.message).toContain('Throttling');
      }
    });
  });

  describe('getScalingActivities', () => {
    it('should return scaling activities with correct limit', async () => {
      const startTime = new Date('2024-01-15T10:00:00Z');
      const asgSend = jest.fn().mockResolvedValue({
        Activities: [
          {
            StartTime: startTime,
            Description: 'Launching a new EC2 instance: i-abc123',
            StatusCode: 'Successful',
          },
          {
            StartTime: new Date('2024-01-15T09:00:00Z'),
            Description: 'Terminating EC2 instance: i-old789',
            StatusCode: 'Successful',
          },
        ],
      });

      const service = new InstanceService(
        createMockEc2Client(jest.fn()),
        createMockAutoScalingClient(asgSend),
        mockLogger,
        config
      );

      const result = await service.getScalingActivities(10);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]).toEqual({
          timestamp: '2024-01-15T10:00:00.000Z',
          description: 'Launching a new EC2 instance: i-abc123',
          statusCode: 'Successful',
        });
        expect(result.value[1]).toEqual({
          timestamp: '2024-01-15T09:00:00.000Z',
          description: 'Terminating EC2 instance: i-old789',
          statusCode: 'Successful',
        });
      }

      // Verify MaxRecords was passed
      expect(asgSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MaxRecords: 10,
          }),
        })
      );
    });

    it('should return empty array when no activities', async () => {
      const asgSend = jest.fn().mockResolvedValue({
        Activities: [],
      });

      const service = new InstanceService(
        createMockEc2Client(jest.fn()),
        createMockAutoScalingClient(asgSend),
        mockLogger,
        config
      );

      const result = await service.getScalingActivities(10);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return failure on AWS SDK error', async () => {
      const asgSend = jest.fn().mockRejectedValue(new Error('Service Unavailable'));

      const service = new InstanceService(
        createMockEc2Client(jest.fn()),
        createMockAutoScalingClient(asgSend),
        mockLogger,
        config
      );

      const result = await service.getScalingActivities(5);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe('AWS_SDK_ERROR');
        expect(result.error.message).toContain('Failed to describe scaling activities');
        expect(result.error.message).toContain('Service Unavailable');
      }
    });
  });
});
