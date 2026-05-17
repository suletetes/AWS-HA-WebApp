#!/bin/bash
# CloudPulse - Compute Validation Script
# Verifies launch template and ASG are correctly configured.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib/config.sh"
source "${SCRIPT_DIR}/../lib/common.sh"
load_env

PASS=0
FAIL=0

check() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ PASS: ${description} (${actual})"
    PASS=$((PASS + 1))
  else
    echo "  ✗ FAIL: ${description} (expected: ${expected}, got: ${actual})"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Compute Validation ==="

# Check Launch Template instance type
LT_INSTANCE_TYPE=$(aws ec2 describe-launch-template-versions --launch-template-id "$LAUNCH_TEMPLATE_ID" --versions '$Latest' --region "$AWS_REGION" --query 'LaunchTemplateVersions[0].LaunchTemplateData.InstanceType' --output text)
check "Launch Template instance type" "t3.micro" "$LT_INSTANCE_TYPE"

# Check ASG min/max/desired
ASG_MIN_ACTUAL=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG_NAME" --region "$AWS_REGION" --query 'AutoScalingGroups[0].MinSize' --output text)
check "ASG min capacity" "2" "$ASG_MIN_ACTUAL"

ASG_MAX_ACTUAL=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG_NAME" --region "$AWS_REGION" --query 'AutoScalingGroups[0].MaxSize' --output text)
check "ASG max capacity" "4" "$ASG_MAX_ACTUAL"

ASG_DESIRED_ACTUAL=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG_NAME" --region "$AWS_REGION" --query 'AutoScalingGroups[0].DesiredCapacity' --output text)
check "ASG desired capacity" "2" "$ASG_DESIRED_ACTUAL"

# Check health check type
HC_TYPE=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG_NAME" --region "$AWS_REGION" --query 'AutoScalingGroups[0].HealthCheckType' --output text)
check "ASG health check type" "ELB" "$HC_TYPE"

echo ""
echo "Compute Validation: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
