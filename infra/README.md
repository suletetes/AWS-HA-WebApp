# CloudPulse Infrastructure

AWS CLI shell scripts that provision the complete infrastructure stack. No Terraform, no CloudFormation. Every API call is visible and commented for learning purposes.

## Quick Start

```bash
# Deploy everything (takes about 5 minutes)
bash deploy.sh

# Tear down everything (stops all charges)
bash teardown.sh

# Validate deployed resources match expected config
bash validate.sh
```

## Prerequisites

- AWS CLI v2 configured with credentials (`aws configure`)
- Bash shell (Git Bash on Windows, native on Mac/Linux)
- IAM user with admin permissions (or at minimum: EC2, VPC, ELB, AutoScaling, CloudWatch, IAM, S3)

Verify your setup:

```bash
aws sts get-caller-identity
```

## What Gets Created

The deploy script creates these resources in order:

| Script | Resources | Cost |
|--------|-----------|------|
| `iam.sh` | IAM role, policy, instance profile | Free |
| `vpc.sh` | VPC, 4 subnets, IGW, 2 NAT Gateways, route tables, NACLs | NAT GWs: ~$2.16/day |
| `alb.sh` | ALB, target group, listener, 2 security groups | ALB: ~$0.55/day |
| `compute.sh` | Launch template, ASG (2 instances), scaling policies | EC2: ~$0.50/day |
| `monitoring.sh` | 2 CloudWatch alarms | Free (first 10) |

Total running cost: roughly $3-4/day. Tear down when not using.

## Script Structure

```
infra/
  deploy.sh             Runs all scripts in order
  teardown.sh           Deletes everything in reverse order
  validate.sh           Verifies resource state after deploy

  scripts/
    iam.sh              IAM role + instance profile
    vpc.sh              VPC networking (subnets, IGW, NAT, routes, NACLs)
    alb.sh              Load balancer + security groups
    compute.sh          Launch template + ASG + scaling policies
    monitoring.sh       CloudWatch alarms

  lib/
    config.sh           Shared variables (region, CIDRs, instance type, thresholds)
    common.sh           Utility functions (logging, wait, error handling)

  user-data/
    bootstrap.sh        EC2 first-boot script (installs Node.js, deploys app)

  tests/
    validate-vpc.sh     Checks VPC, subnets, IGW, NAT state
    validate-security.sh  Checks security group rules
    validate-compute.sh   Checks ASG config, launch template
    validate-alb.sh       Checks ALB, target group, listener

  env/
    resources.env       Generated resource IDs (not committed to git)
```

## Configuration

All configurable values live in `lib/config.sh`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PROJECT_NAME` | cloudpulse | Prefix for all resource names |
| `AWS_REGION` | us-east-1 | Target region |
| `VPC_CIDR` | 10.0.0.0/16 | VPC address space |
| `INSTANCE_TYPE` | t3.micro | EC2 instance size |
| `ASG_MIN` | 2 | Minimum instances |
| `ASG_MAX` | 4 | Maximum instances |
| `ASG_DESIRED` | 2 | Starting instance count |
| `CPU_HIGH_THRESHOLD` | 70 | Scale-out CPU percentage |
| `CPU_LOW_THRESHOLD` | 30 | Scale-in CPU percentage |
| `DEPLOY_BUCKET` | auto-generated | S3 bucket for app code |

Override any value with environment variables:

```bash
AWS_REGION=eu-west-1 bash deploy.sh
```

## How Deployment Works

1. `config.sh` resolves your AWS account ID dynamically
2. `iam.sh` creates the role and instance profile
3. `vpc.sh` builds the network (this takes 2-3 minutes for NAT Gateways)
4. `alb.sh` creates the load balancer and security groups
5. `compute.sh` creates the launch template and ASG (instances start booting)
6. `monitoring.sh` creates CloudWatch alarms linked to scaling policies

Each script writes resource IDs to `env/resources.env`. Subsequent scripts source this file to reference previously created resources.

## How Teardown Works

Resources are deleted in reverse dependency order. The script:

- Force-deletes the ASG (terminates all instances)
- Waits for instances to terminate before deleting the launch template
- Deletes the ALB and waits for it to fully release network interfaces
- Removes security group cross-references before deleting them
- Waits for NAT Gateways to delete before releasing Elastic IPs
- Deletes subnets, route tables, IGW, NACLs, then the VPC
- Removes IAM resources last

If any deletion fails, it logs the failure and continues with the rest.

## Windows Notes

Git Bash on Windows converts paths starting with `/` to Windows paths. The deploy script sets `MSYS_NO_PATHCONV=1` to prevent this. If you run individual scripts manually, prefix with:

```bash
export MSYS_NO_PATHCONV=1
bash scripts/vpc.sh
```

## Validation

After deploying, run the validation suite to confirm everything matches the expected configuration:

```bash
bash validate.sh
```

It checks VPC CIDR, DNS settings, subnet count, IGW attachment, NAT Gateway state, security group rules, ASG capacity, health check type, ALB scheme, target group settings, and listener port.
