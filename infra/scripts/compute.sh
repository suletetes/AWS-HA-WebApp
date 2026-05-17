#!/bin/bash
# CloudPulse Infrastructure - Compute Provisioning (Launch Template + ASG + Scaling Policies)
# Creates the Launch Template, Auto Scaling Group, and scaling policies for the application.
#
# This script creates:
# 1. Retrieves the latest Amazon Linux 2023 AMI ID
# 2. A Launch Template with instance configuration (t3.micro, gp3 8GB, no public IP)
# 3. An Auto Scaling Group (min 2, max 4, desired 2) across 2 AZs
# 4. A scale-out policy (+1 instance, 300s cooldown)
# 5. A scale-in policy (-1 instance, 300s cooldown)
#
# NOTE: t3.micro is free-tier eligible (750 hrs/month for 12 months).
# Running 2 instances = 1440 hrs/month, exceeds free tier by ~690 hrs.
# Consider stopping instances when not in use to stay within free tier limits.
#
# Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 15.1, 15.2, 15.3

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib/config.sh"
source "${SCRIPT_DIR}/../lib/common.sh"

# Load previously created resources (VPC, subnets, security groups, IAM, ALB target group)
load_env

log_step "Provisioning compute resources for CloudPulse..."

# ============================================================
# Step 1: Get the latest Amazon Linux 2023 AMI ID
# We query for the most recent AL2023 x86_64 AMI owned by Amazon.
# This ensures we always use a patched, up-to-date base image.
# ============================================================
log_info "Fetching latest Amazon Linux 2023 AMI..."

AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text --region "$AWS_REGION")

if [[ -z "$AMI_ID" || "$AMI_ID" == "None" ]]; then
  log_error "Failed to retrieve Amazon Linux 2023 AMI ID"
  exit 1
fi

log_info "Using AMI: ${AMI_ID}"
save_resource "AMI_ID" "$AMI_ID"

# ============================================================
# Step 2: Create Launch Template
# The launch template defines the instance configuration:
# - AMI: Amazon Linux 2023 (latest)
# - Instance type: t3.micro (free-tier eligible)
# - IAM Instance Profile: grants CloudWatch, EC2, ASG permissions
# - Security Group: App SG (allows port 3000 from ALB only)
# - Network: No public IP (instances are in private subnets)
# - Storage: gp3 root volume, 8GB (free-tier eligible)
# - User-data: bootstrap script that installs Node.js and starts the app
# ============================================================
log_info "Creating Launch Template: ${PROJECT_NAME}-lt"

# Encode the user-data bootstrap script in base64
# The bootstrap script installs Node.js, deploys the app, and starts the service
USER_DATA_FILE="${SCRIPT_DIR}/../user-data/bootstrap.sh"
if [[ ! -f "$USER_DATA_FILE" ]]; then
  log_error "User-data script not found: ${USER_DATA_FILE}"
  exit 1
fi

USER_DATA_BASE64=$(base64 -w 0 "$USER_DATA_FILE" 2>/dev/null || base64 -i "$USER_DATA_FILE" 2>/dev/null)

# Build the launch template JSON configuration
# - NetworkInterfaces: attach the App SG and disable public IP assignment
# - BlockDeviceMappings: configure gp3 root volume at 8GB
# - IamInstanceProfile: attach the instance profile for AWS API access
LAUNCH_TEMPLATE_DATA=$(cat <<EOF
{
  "ImageId": "${AMI_ID}",
  "InstanceType": "${INSTANCE_TYPE}",
  "IamInstanceProfile": {
    "Name": "${INSTANCE_PROFILE_NAME}"
  },
  "NetworkInterfaces": [
    {
      "DeviceIndex": 0,
      "AssociatePublicIpAddress": false,
      "Groups": ["${APP_SG_ID}"]
    }
  ],
  "BlockDeviceMappings": [
    {
      "DeviceName": "/dev/xvda",
      "Ebs": {
        "VolumeSize": ${EBS_VOLUME_SIZE},
        "VolumeType": "${EBS_VOLUME_TYPE}",
        "DeleteOnTermination": true
      }
    }
  ],
  "UserData": "${USER_DATA_BASE64}",
  "TagSpecifications": [
    {
      "ResourceType": "instance",
      "Tags": [
        {
          "Key": "Name",
          "Value": "${PROJECT_NAME}-instance"
        },
        {
          "Key": "Project",
          "Value": "${PROJECT_NAME}"
        }
      ]
    }
  ]
}
EOF
)

LAUNCH_TEMPLATE_ID=$(aws ec2 create-launch-template \
  --launch-template-name "${PROJECT_NAME}-lt" \
  --version-description "Initial version - AL2023, t3.micro, gp3 8GB" \
  --launch-template-data "$LAUNCH_TEMPLATE_DATA" \
  --tag-specifications "ResourceType=launch-template,Tags=[{Key=Name,Value=${PROJECT_NAME}-lt},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --query 'LaunchTemplate.LaunchTemplateId' \
  --output text)

if [[ -z "$LAUNCH_TEMPLATE_ID" || "$LAUNCH_TEMPLATE_ID" == "None" ]]; then
  log_error "Failed to create Launch Template"
  exit 1
fi

log_info "Launch Template created: ${LAUNCH_TEMPLATE_ID}"
save_resource "LAUNCH_TEMPLATE_ID" "$LAUNCH_TEMPLATE_ID"

# ============================================================
# Step 3: Create Auto Scaling Group
# The ASG manages the fleet of EC2 instances:
# - Min: 2 instances (ensures high availability)
# - Max: 4 instances (caps costs during scale-out)
# - Desired: 2 instances (starting capacity)
# - Spread across 2 AZs via private subnets for fault tolerance
# - Registered with ALB target group for load balancing
# - ELB health check: instances failing ALB health checks are replaced
# - Grace period: 300s allows app to fully start before health checks begin
# ============================================================
log_info "Creating Auto Scaling Group: ${PROJECT_NAME}-asg"

ASG_NAME="${PROJECT_NAME}-asg"

aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name "$ASG_NAME" \
  --launch-template "LaunchTemplateId=${LAUNCH_TEMPLATE_ID},Version=\$Latest" \
  --min-size "$ASG_MIN" \
  --max-size "$ASG_MAX" \
  --desired-capacity "$ASG_DESIRED" \
  --vpc-zone-identifier "${PRIVATE_SUBNET_1_ID},${PRIVATE_SUBNET_2_ID}" \
  --target-group-arns "$TG_ARN" \
  --health-check-type ELB \
  --health-check-grace-period "$HEALTH_CHECK_GRACE_PERIOD" \
  --tags "Key=Name,Value=${PROJECT_NAME}-asg,PropagateAtLaunch=true" \
         "Key=Project,Value=${PROJECT_NAME},PropagateAtLaunch=true" \
  --region "$AWS_REGION"

check_result "Auto Scaling Group created" $?

log_info "ASG '${ASG_NAME}' created with min=${ASG_MIN}, max=${ASG_MAX}, desired=${ASG_DESIRED}"
save_resource "ASG_NAME" "$ASG_NAME"

# ============================================================
# Step 4: Create Scale-Out Policy
# Adds 1 instance when triggered by the high-CPU CloudWatch alarm.
# - Adjustment type: ChangeInCapacity (adds/removes a fixed number)
# - Scaling adjustment: +1 (add one instance)
# - Cooldown: 300s (prevents rapid successive scale-out events)
# ============================================================
log_info "Creating scale-out policy..."

SCALE_OUT_POLICY_ARN=$(aws autoscaling put-scaling-policy \
  --auto-scaling-group-name "$ASG_NAME" \
  --policy-name "${PROJECT_NAME}-scale-out" \
  --policy-type SimpleScaling \
  --adjustment-type ChangeInCapacity \
  --scaling-adjustment 1 \
  --cooldown "$SCALE_COOLDOWN" \
  --region "$AWS_REGION" \
  --query 'PolicyARN' \
  --output text)

if [[ -z "$SCALE_OUT_POLICY_ARN" || "$SCALE_OUT_POLICY_ARN" == "None" ]]; then
  log_error "Failed to create scale-out policy"
  exit 1
fi

log_info "Scale-out policy created: ${SCALE_OUT_POLICY_ARN}"
save_resource "SCALE_OUT_POLICY_ARN" "$SCALE_OUT_POLICY_ARN"

# ============================================================
# Step 5: Create Scale-In Policy
# Removes 1 instance when triggered by the low-CPU CloudWatch alarm.
# - Adjustment type: ChangeInCapacity (adds/removes a fixed number)
# - Scaling adjustment: -1 (remove one instance)
# - Cooldown: 300s (prevents rapid successive scale-in events)
# ============================================================
log_info "Creating scale-in policy..."

SCALE_IN_POLICY_ARN=$(aws autoscaling put-scaling-policy \
  --auto-scaling-group-name "$ASG_NAME" \
  --policy-name "${PROJECT_NAME}-scale-in" \
  --policy-type SimpleScaling \
  --adjustment-type ChangeInCapacity \
  --scaling-adjustment -1 \
  --cooldown "$SCALE_COOLDOWN" \
  --region "$AWS_REGION" \
  --query 'PolicyARN' \
  --output text)

if [[ -z "$SCALE_IN_POLICY_ARN" || "$SCALE_IN_POLICY_ARN" == "None" ]]; then
  log_error "Failed to create scale-in policy"
  exit 1
fi

log_info "Scale-in policy created: ${SCALE_IN_POLICY_ARN}"
save_resource "SCALE_IN_POLICY_ARN" "$SCALE_IN_POLICY_ARN"

# ============================================================
# Summary
# ============================================================
log_step "Compute provisioning complete!"
log_info "  AMI ID:              ${AMI_ID}"
log_info "  Launch Template ID:  ${LAUNCH_TEMPLATE_ID}"
log_info "  ASG Name:            ${ASG_NAME}"
log_info "  Scale-Out Policy:    ${SCALE_OUT_POLICY_ARN}"
log_info "  Scale-In Policy:     ${SCALE_IN_POLICY_ARN}"
log_info ""
log_warn "COST NOTE: t3.micro is free-tier eligible (750 hrs/month for 12 months)."
log_warn "Running 2 instances = 1440 hrs/month, exceeds free tier by ~690 hrs."
log_warn "Consider stopping instances when not actively using the environment."
