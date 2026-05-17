/**
 * Instance and Auto Scaling Group types for the dashboard.
 */

/** EC2 instance information as displayed on the dashboard */
export interface InstanceInfo {
  readonly instanceId: string;
  readonly state: string;
  readonly healthStatus: string;
  readonly availabilityZone: string;
}

/** ASG capacity numbers */
export interface AsgCapacity {
  readonly min: number;
  readonly max: number;
  readonly desired: number;
  readonly actual: number;
}

/** A single ASG scaling activity event */
export interface ScalingActivity {
  readonly timestamp: string;
  readonly description: string;
  readonly statusCode: string;
}

/** Current instance runtime status */
export interface InstanceStatus {
  readonly instanceId: string;
  readonly uptime: number;
  readonly cpuUsage: number;
}
