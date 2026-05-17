#!/bin/bash
# CloudPulse Infrastructure - Teardown Script
# Deletes all resources in reverse dependency order to avoid orphaned resources.
# Logs both successes and failures. Continues deleting even if individual deletions fail.
#
# Deletion order (reverse of creation):
# 1. CloudWatch Alarms
# 2. Auto Scaling Group (wait for instances to terminate)
# 3. Launch Template
# 4. ALB Listener
# 5. ALB (wait for deletion)
# 6. Target Group
# 7. Security Groups (ALB SG, App SG)
# 8. NAT Gateways (wait for deletion)
# 9. Elastic IPs
# 10. Subnets
# 11. Route Tables
# 12. Internet Gateway (detach + delete)
# 13. Network ACL
# 14. VPC
# 15. IAM (instance profile, role, policy)
#
# Requirements: 13.1, 13.2, 13.3, 13.4, 13.5

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/common.sh"

# Load resource IDs from the environment file
load_env

log_step "=========================================="
log_step "  CloudPulse Infrastructure Teardown"
log_step "=========================================="
log_warn "This will DELETE all CloudPulse resources!"
echo ""

# Helper: delete a resource with logging
delete_resource() {
  local description="$1"
  local command="$2"
  
  log_info "Deleting: ${description}..."
  if eval "$command" 2>/dev/null; then
    log_info "  ✓ Deleted: ${description}"
  else
    log_error "  ✗ Failed to delete: ${description}"
  fi
}

# ============================================================
# Step 1: Delete CloudWatch Alarms
# ============================================================
log_step "Step 1: Deleting CloudWatch Alarms..."

if [[ -n "${HIGH_CPU_ALARM_NAME:-}" ]]; then
  delete_resource "High-CPU alarm" \
    "aws cloudwatch delete-alarms --alarm-names '${HIGH_CPU_ALARM_NAME}' --region '${AWS_REGION}'"
fi

if [[ -n "${LOW_CPU_ALARM_NAME:-}" ]]; then
  delete_resource "Low-CPU alarm" \
    "aws cloudwatch delete-alarms --alarm-names '${LOW_CPU_ALARM_NAME}' --region '${AWS_REGION}'"
fi

# ============================================================
# Step 2: Delete Auto Scaling Group (force delete instances)
# ============================================================
log_step "Step 2: Deleting Auto Scaling Group..."

if [[ -n "${ASG_NAME:-}" ]]; then
  delete_resource "ASG ${ASG_NAME}" \
    "aws autoscaling delete-auto-scaling-group --auto-scaling-group-name '${ASG_NAME}' --force-delete --region '${AWS_REGION}'"
  
  # Wait for ASG instances to terminate (max 300s)
  log_info "Waiting for ASG instances to terminate (up to 300s)..."
  WAIT_COUNT=0
  while [[ $WAIT_COUNT -lt 300 ]]; do
    INSTANCE_COUNT=$(aws autoscaling describe-auto-scaling-groups \
      --auto-scaling-group-names "${ASG_NAME}" \
      --region "${AWS_REGION}" \
      --query 'AutoScalingGroups[0].Instances | length(@)' \
      --output text 2>/dev/null || echo "0")
    
    if [[ "$INSTANCE_COUNT" == "0" || "$INSTANCE_COUNT" == "None" || -z "$INSTANCE_COUNT" ]]; then
      log_info "  ASG instances terminated."
      break
    fi
    
    sleep 10
    WAIT_COUNT=$((WAIT_COUNT + 10))
  done
fi

# ============================================================
# Step 3: Delete Launch Template
# ============================================================
log_step "Step 3: Deleting Launch Template..."

if [[ -n "${LAUNCH_TEMPLATE_ID:-}" ]]; then
  delete_resource "Launch Template ${LAUNCH_TEMPLATE_ID}" \
    "aws ec2 delete-launch-template --launch-template-id '${LAUNCH_TEMPLATE_ID}' --region '${AWS_REGION}'"
fi

# ============================================================
# Step 4: Delete ALB Listener
# ============================================================
log_step "Step 4: Deleting ALB Listener..."

if [[ -n "${LISTENER_ARN:-}" ]]; then
  delete_resource "ALB Listener" \
    "aws elbv2 delete-listener --listener-arn '${LISTENER_ARN}' --region '${AWS_REGION}'"
fi

# ============================================================
# Step 5: Delete ALB (wait for deletion)
# ============================================================
log_step "Step 5: Deleting Application Load Balancer..."

if [[ -n "${ALB_ARN:-}" ]]; then
  delete_resource "ALB" \
    "aws elbv2 delete-load-balancer --load-balancer-arn '${ALB_ARN}' --region '${AWS_REGION}'"
  
  # Wait for ALB to be fully deleted before removing target group
  log_info "Waiting for ALB deletion (up to 300s)..."
  aws elbv2 wait load-balancers-deleted --load-balancer-arns "${ALB_ARN}" --region "${AWS_REGION}" 2>/dev/null || true
fi

# ============================================================
# Step 6: Delete Target Group
# ============================================================
log_step "Step 6: Deleting Target Group..."

if [[ -n "${TG_ARN:-}" ]]; then
  delete_resource "Target Group" \
    "aws elbv2 delete-target-group --target-group-arn '${TG_ARN}' --region '${AWS_REGION}'"
fi

# ============================================================
# Step 7: Delete Security Groups
# ============================================================
log_step "Step 7: Deleting Security Groups..."

if [[ -n "${ALB_SG_ID:-}" ]]; then
  delete_resource "ALB Security Group ${ALB_SG_ID}" \
    "aws ec2 delete-security-group --group-id '${ALB_SG_ID}' --region '${AWS_REGION}'"
fi

if [[ -n "${APP_SG_ID:-}" ]]; then
  delete_resource "App Security Group ${APP_SG_ID}" \
    "aws ec2 delete-security-group --group-id '${APP_SG_ID}' --region '${AWS_REGION}'"
fi

# ============================================================
# Step 8: Delete NAT Gateways (wait for deletion)
# ============================================================
log_step "Step 8: Deleting NAT Gateways..."

if [[ -n "${NAT_GW_1_ID:-}" ]]; then
  delete_resource "NAT Gateway 1 ${NAT_GW_1_ID}" \
    "aws ec2 delete-nat-gateway --nat-gateway-id '${NAT_GW_1_ID}' --region '${AWS_REGION}'"
fi

if [[ -n "${NAT_GW_2_ID:-}" ]]; then
  delete_resource "NAT Gateway 2 ${NAT_GW_2_ID}" \
    "aws ec2 delete-nat-gateway --nat-gateway-id '${NAT_GW_2_ID}' --region '${AWS_REGION}'"
fi

# Wait for NAT Gateways to be deleted before releasing EIPs
if [[ -n "${NAT_GW_1_ID:-}" || -n "${NAT_GW_2_ID:-}" ]]; then
  log_info "Waiting for NAT Gateways to be deleted (up to 300s)..."
  sleep 30  # NAT GW deletion takes ~30-60s
  
  for nat_id in "${NAT_GW_1_ID:-}" "${NAT_GW_2_ID:-}"; do
    if [[ -n "$nat_id" ]]; then
      WAIT_COUNT=0
      while [[ $WAIT_COUNT -lt 270 ]]; do
        STATE=$(aws ec2 describe-nat-gateways --nat-gateway-ids "$nat_id" --region "${AWS_REGION}" \
          --query 'NatGateways[0].State' --output text 2>/dev/null || echo "deleted")
        if [[ "$STATE" == "deleted" || "$STATE" == "None" ]]; then
          break
        fi
        sleep 10
        WAIT_COUNT=$((WAIT_COUNT + 10))
      done
    fi
  done
  log_info "NAT Gateways deleted."
fi

# ============================================================
# Step 9: Release Elastic IPs
# ============================================================
log_step "Step 9: Releasing Elastic IPs..."

if [[ -n "${EIP_1_ALLOC_ID:-}" ]]; then
  delete_resource "Elastic IP 1 ${EIP_1_ALLOC_ID}" \
    "aws ec2 release-address --allocation-id '${EIP_1_ALLOC_ID}' --region '${AWS_REGION}'"
fi

if [[ -n "${EIP_2_ALLOC_ID:-}" ]]; then
  delete_resource "Elastic IP 2 ${EIP_2_ALLOC_ID}" \
    "aws ec2 release-address --allocation-id '${EIP_2_ALLOC_ID}' --region '${AWS_REGION}'"
fi

# ============================================================
# Step 10: Delete Subnets
# ============================================================
log_step "Step 10: Deleting Subnets..."

for subnet_id in "${PUBLIC_SUBNET_1_ID:-}" "${PUBLIC_SUBNET_2_ID:-}" "${PRIVATE_SUBNET_1_ID:-}" "${PRIVATE_SUBNET_2_ID:-}"; do
  if [[ -n "$subnet_id" ]]; then
    delete_resource "Subnet ${subnet_id}" \
      "aws ec2 delete-subnet --subnet-id '${subnet_id}' --region '${AWS_REGION}'"
  fi
done

# ============================================================
# Step 11: Delete Route Tables (non-main only)
# ============================================================
log_step "Step 11: Deleting Route Tables..."

for rt_id in "${PUBLIC_RT_ID:-}" "${PRIVATE_RT_1_ID:-}" "${PRIVATE_RT_2_ID:-}"; do
  if [[ -n "$rt_id" ]]; then
    delete_resource "Route Table ${rt_id}" \
      "aws ec2 delete-route-table --route-table-id '${rt_id}' --region '${AWS_REGION}'"
  fi
done

# ============================================================
# Step 12: Detach and Delete Internet Gateway
# ============================================================
log_step "Step 12: Deleting Internet Gateway..."

if [[ -n "${IGW_ID:-}" && -n "${VPC_ID:-}" ]]; then
  delete_resource "Detach IGW from VPC" \
    "aws ec2 detach-internet-gateway --internet-gateway-id '${IGW_ID}' --vpc-id '${VPC_ID}' --region '${AWS_REGION}'"
  delete_resource "Internet Gateway ${IGW_ID}" \
    "aws ec2 delete-internet-gateway --internet-gateway-id '${IGW_ID}' --region '${AWS_REGION}'"
fi

# ============================================================
# Step 13: Delete Network ACL
# ============================================================
log_step "Step 13: Deleting Network ACL..."

if [[ -n "${PRIVATE_NACL_ID:-}" ]]; then
  delete_resource "Private NACL ${PRIVATE_NACL_ID}" \
    "aws ec2 delete-network-acl --network-acl-id '${PRIVATE_NACL_ID}' --region '${AWS_REGION}'"
fi

# ============================================================
# Step 14: Delete VPC
# ============================================================
log_step "Step 14: Deleting VPC..."

if [[ -n "${VPC_ID:-}" ]]; then
  delete_resource "VPC ${VPC_ID}" \
    "aws ec2 delete-vpc --vpc-id '${VPC_ID}' --region '${AWS_REGION}'"
fi

# ============================================================
# Step 15: Delete IAM Resources
# ============================================================
log_step "Step 15: Deleting IAM Resources..."

if [[ -n "${INSTANCE_PROFILE_NAME:-}" ]]; then
  # Remove role from instance profile first
  aws iam remove-role-from-instance-profile \
    --instance-profile-name "${INSTANCE_PROFILE_NAME}" \
    --role-name "${ROLE_NAME}" \
    --region "${AWS_REGION}" 2>/dev/null || true
  
  delete_resource "Instance Profile ${INSTANCE_PROFILE_NAME}" \
    "aws iam delete-instance-profile --instance-profile-name '${INSTANCE_PROFILE_NAME}'"
fi

if [[ -n "${ROLE_NAME:-}" ]]; then
  # Detach managed policies
  aws iam detach-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-arn "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore" 2>/dev/null || true
  
  # Delete inline policy
  aws iam delete-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-name "${POLICY_NAME}" 2>/dev/null || true
  
  delete_resource "IAM Role ${ROLE_NAME}" \
    "aws iam delete-role --role-name '${ROLE_NAME}'"
fi

# ============================================================
# Cleanup
# ============================================================
log_step "=========================================="
log_step "  Teardown Complete"
log_step "=========================================="
log_info "All CloudPulse resources have been deleted (or deletion attempted)."
log_info "Check above for any ✗ failures that may need manual cleanup."

# Clear the environment file
> "$ENV_FILE"
log_info "Environment file cleared."
