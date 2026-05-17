#!/bin/bash
# CloudPulse Infrastructure - CloudWatch Monitoring Alarms
# Creates CloudWatch alarms for Auto Scaling Group CPU-based scaling.
#
# This script creates:
# 1. A high-CPU alarm that triggers the scale-out policy when CPU > 70%
# 2. A low-CPU alarm that triggers the scale-in policy when CPU < 30%
#
# Cost note: The first 10 CloudWatch alarms per account are free under the
# AWS Free Tier. This script creates only 2 alarms, so they incur no cost.
#
# Requirements: 10.1, 10.2, 10.3, 10.4

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib/config.sh"
source "${SCRIPT_DIR}/../lib/common.sh"

# Load previously created resource IDs (ASG name, scaling policy ARNs)
load_env

log_step "Creating CloudWatch monitoring alarms for CloudPulse..."

# ============================================================
# Step 1: Create High-CPU Alarm
#
# CPUUtilization measures the percentage of allocated EC2 compute units
# that are currently in use on the instances in the Auto Scaling Group.
# It is a built-in metric under the AWS/EC2 namespace — no agent needed.
#
# Evaluation periods: The alarm evaluates the metric over consecutive
# periods. Here we use 2 periods of 60 seconds each, meaning the average
# CPU must exceed 70% for 2 consecutive minutes before the alarm fires.
# This prevents brief spikes from triggering unnecessary scale-out events.
#
# Alarm actions: When the alarm transitions to ALARM state, it invokes
# the scale-out policy ARN. The ASG then executes that policy, which
# adds 1 instance to the group (subject to the max capacity limit).
# ============================================================
log_info "Creating high-CPU alarm: ${PROJECT_NAME}-high-cpu"

aws cloudwatch put-metric-alarm \
  --alarm-name "${PROJECT_NAME}-high-cpu" \
  --alarm-description "Scale out when CPU > 70% for 2 minutes" \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --statistic Average \
  --period 60 \
  --evaluation-periods 2 \
  --threshold 70 \
  --comparison-operator GreaterThanThreshold \
  --dimensions "Name=AutoScalingGroupName,Value=${ASG_NAME}" \
  --alarm-actions "${SCALE_OUT_POLICY_ARN}" \
  --region "$AWS_REGION"

check_result "High-CPU alarm created" $?

# ============================================================
# Step 2: Create Low-CPU Alarm
#
# This alarm monitors the same CPUUtilization metric but fires when
# average usage drops below 30% for 2 consecutive 60-second periods.
# This indicates the group is over-provisioned and can safely scale in.
#
# The alarm action triggers the scale-in policy, which removes 1 instance
# from the ASG (subject to the min capacity limit). The cooldown period
# on the policy prevents rapid successive scale-in events.
# ============================================================
log_info "Creating low-CPU alarm: ${PROJECT_NAME}-low-cpu"

aws cloudwatch put-metric-alarm \
  --alarm-name "${PROJECT_NAME}-low-cpu" \
  --alarm-description "Scale in when CPU < 30% for 2 minutes" \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --statistic Average \
  --period 60 \
  --evaluation-periods 2 \
  --threshold 30 \
  --comparison-operator LessThanThreshold \
  --dimensions "Name=AutoScalingGroupName,Value=${ASG_NAME}" \
  --alarm-actions "${SCALE_IN_POLICY_ARN}" \
  --region "$AWS_REGION"

check_result "Low-CPU alarm created" $?

# ============================================================
# Step 3: Save alarm names to environment file
# These are needed by teardown.sh to delete the alarms later.
# ============================================================
save_resource "HIGH_CPU_ALARM_NAME" "${PROJECT_NAME}-high-cpu"
save_resource "LOW_CPU_ALARM_NAME" "${PROJECT_NAME}-low-cpu"

log_info "Monitoring setup complete!"
log_info "  High-CPU alarm: ${PROJECT_NAME}-high-cpu (triggers scale-out at >70%)"
log_info "  Low-CPU alarm:  ${PROJECT_NAME}-low-cpu (triggers scale-in at <30%)"
log_info "  Note: First 10 CloudWatch alarms are free — no additional cost."
