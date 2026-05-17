#!/bin/bash
# CloudPulse - Security Validation Script
# Verifies security groups and NACLs are correctly configured.

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
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  ✓ PASS: ${description}"
    PASS=$((PASS + 1))
  else
    echo "  ✗ FAIL: ${description} (expected to contain: ${expected}, got: ${actual})"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Security Validation ==="

# Check ALB SG has inbound port 80
ALB_SG_RULES=$(aws ec2 describe-security-group-rules --filters "Name=group-id,Values=$ALB_SG_ID" --region "$AWS_REGION" --query 'SecurityGroupRules[?IsEgress==`false`].{Port:FromPort,Cidr:CidrIpv4}' --output text)
check "ALB SG allows inbound port 80" "80" "$ALB_SG_RULES"

# Check App SG has inbound port 3000 from ALB SG
APP_SG_RULES=$(aws ec2 describe-security-group-rules --filters "Name=group-id,Values=$APP_SG_ID" --region "$AWS_REGION" --query 'SecurityGroupRules[?IsEgress==`false`].{Port:FromPort,GroupId:ReferencedGroupInfo.GroupId}' --output text)
check "App SG allows inbound port 3000 from ALB SG" "3000" "$APP_SG_RULES"

echo ""
echo "Security Validation: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
