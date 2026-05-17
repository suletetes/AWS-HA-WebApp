#!/bin/bash
# CloudPulse Infrastructure - IAM Role and Instance Profile
# Creates the IAM role, policy, and instance profile for EC2 instances.
#
# This script creates:
# 1. An IAM role with ec2.amazonaws.com trust policy
# 2. An inline policy granting least-privilege permissions
# 3. Attaches AmazonSSMManagedInstanceCore managed policy for SSM access
# 4. An instance profile associated with the role
#
# Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib/config.sh"
source "${SCRIPT_DIR}/../lib/common.sh"

log_step "Creating IAM resources for CloudPulse..."

# ============================================================
# Step 1: Create the IAM role with EC2 trust policy
# This allows EC2 instances to assume this role
# ============================================================
log_info "Creating IAM role: ${ROLE_NAME}"

TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}'

aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document "$TRUST_POLICY" \
  --description "CloudPulse EC2 instance role - allows instances to publish metrics and query ASG state" \
  --tags Key=Project,Value="$PROJECT_NAME" \
  --region "$AWS_REGION" \
  --output text --query 'Role.Arn'

ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
save_resource "ROLE_ARN" "$ROLE_ARN"
save_resource "ROLE_NAME" "$ROLE_NAME"

# ============================================================
# Step 2: Create inline policy with least-privilege permissions
# - cloudwatch:PutMetricData — publish custom metrics
# - ec2:DescribeInstances — query peer instance status
# - autoscaling:DescribeAutoScalingGroups — read ASG state
# - autoscaling:DescribeScalingActivities — read scaling events
# ============================================================
log_info "Attaching inline policy: ${POLICY_NAME}"

POLICY_DOCUMENT='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudWatchMetrics",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EC2Describe",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AutoScalingDescribe",
      "Effect": "Allow",
      "Action": [
        "autoscaling:DescribeAutoScalingGroups",
        "autoscaling:DescribeScalingActivities"
      ],
      "Resource": "*"
    }
  ]
}'

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOCUMENT"

check_result "Inline policy attached" $?

# ============================================================
# Step 3: Attach AmazonSSMManagedInstanceCore managed policy
# This enables SSM Session Manager for shell access without SSH keys
# ============================================================
log_info "Attaching AmazonSSMManagedInstanceCore managed policy"

aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"

check_result "SSM managed policy attached" $?

# ============================================================
# Step 4: Create instance profile and associate the role
# The instance profile is what gets attached to EC2 instances
# ============================================================
log_info "Creating instance profile: ${INSTANCE_PROFILE_NAME}"

aws iam create-instance-profile \
  --instance-profile-name "$INSTANCE_PROFILE_NAME" \
  --tags Key=Project,Value="$PROJECT_NAME"

save_resource "INSTANCE_PROFILE_NAME" "$INSTANCE_PROFILE_NAME"

# Associate the role with the instance profile
log_info "Adding role to instance profile"

aws iam add-role-to-instance-profile \
  --instance-profile-name "$INSTANCE_PROFILE_NAME" \
  --role-name "$ROLE_NAME"

# Wait for instance profile to propagate (IAM is eventually consistent)
log_info "Waiting 10 seconds for IAM propagation..."
sleep 10

INSTANCE_PROFILE_ARN=$(aws iam get-instance-profile \
  --instance-profile-name "$INSTANCE_PROFILE_NAME" \
  --query 'InstanceProfile.Arn' --output text)

save_resource "INSTANCE_PROFILE_ARN" "$INSTANCE_PROFILE_ARN"

log_info "IAM setup complete!"
log_info "  Role ARN: ${ROLE_ARN}"
log_info "  Instance Profile ARN: ${INSTANCE_PROFILE_ARN}"
