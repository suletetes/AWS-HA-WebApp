#!/bin/bash
# CloudPulse - ALB Validation Script
# Verifies ALB, target group, and listener are correctly configured.

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

echo "=== ALB Validation ==="

# Check ALB scheme
ALB_SCHEME=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --region "$AWS_REGION" --query 'LoadBalancers[0].Scheme' --output text)
check "ALB scheme" "internet-facing" "$ALB_SCHEME"

# Check ALB state
ALB_STATE=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --region "$AWS_REGION" --query 'LoadBalancers[0].State.Code' --output text)
check "ALB state" "active" "$ALB_STATE"

# Check target group health check path
TG_HC_PATH=$(aws elbv2 describe-target-groups --target-group-arns "$TG_ARN" --region "$AWS_REGION" --query 'TargetGroups[0].HealthCheckPath' --output text)
check "Target group health check path" "/health" "$TG_HC_PATH"

# Check target group port
TG_PORT=$(aws elbv2 describe-target-groups --target-group-arns "$TG_ARN" --region "$AWS_REGION" --query 'TargetGroups[0].Port' --output text)
check "Target group port" "3000" "$TG_PORT"

# Check listener port
LISTENER_PORT=$(aws elbv2 describe-listeners --listener-arns "$LISTENER_ARN" --region "$AWS_REGION" --query 'Listeners[0].Port' --output text)
check "Listener port" "80" "$LISTENER_PORT"

echo ""
echo "ALB Validation: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
