#!/bin/bash
# CloudPulse - VPC Validation Script
# Verifies VPC resources are correctly provisioned.

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

echo "=== VPC Validation ==="

# Check VPC CIDR
VPC_CIDR_ACTUAL=$(aws ec2 describe-vpcs --vpc-ids "$VPC_ID" --region "$AWS_REGION" --query 'Vpcs[0].CidrBlock' --output text)
check "VPC CIDR block" "10.0.0.0/16" "$VPC_CIDR_ACTUAL"

# Check DNS support
DNS_SUPPORT=$(aws ec2 describe-vpc-attribute --vpc-id "$VPC_ID" --attribute enableDnsSupport --region "$AWS_REGION" --query 'EnableDnsSupport.Value' --output text)
check "DNS support enabled" "True" "$DNS_SUPPORT"

# Check DNS hostnames
DNS_HOSTNAMES=$(aws ec2 describe-vpc-attribute --vpc-id "$VPC_ID" --attribute enableDnsHostnames --region "$AWS_REGION" --query 'EnableDnsHostnames.Value' --output text)
check "DNS hostnames enabled" "True" "$DNS_HOSTNAMES"

# Check subnet count
SUBNET_COUNT=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --region "$AWS_REGION" --query 'Subnets | length(@)' --output text)
check "Total subnet count" "4" "$SUBNET_COUNT"

# Check IGW attachment
IGW_STATE=$(aws ec2 describe-internet-gateways --internet-gateway-ids "$IGW_ID" --region "$AWS_REGION" --query 'InternetGateways[0].Attachments[0].State' --output text)
check "IGW attached to VPC" "available" "$IGW_STATE"

# Check NAT Gateway states
NAT_1_STATE=$(aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_GW_1_ID" --region "$AWS_REGION" --query 'NatGateways[0].State' --output text)
check "NAT Gateway 1 state" "available" "$NAT_1_STATE"

NAT_2_STATE=$(aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_GW_2_ID" --region "$AWS_REGION" --query 'NatGateways[0].State' --output text)
check "NAT Gateway 2 state" "available" "$NAT_2_STATE"

echo ""
echo "VPC Validation: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
