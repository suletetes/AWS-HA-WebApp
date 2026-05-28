#!/bin/bash
# CloudPulse Infrastructure - Application Load Balancer
# Creates the ALB, security groups, target group, and HTTP listener.
#
# NOTE: ALB costs ~$0.0225/hour (~$16/month) outside free tier
#
# This script creates:
# 1. ALB Security Group (allows inbound HTTP port 80 from anywhere)
# 2. App Security Group (allows inbound port 3000 from ALB SG only)
# 3. Internet-facing Application Load Balancer in public subnets
# 4. Target Group with health check configuration
# 5. HTTP Listener on port 80 forwarding to the target group
#
# Prerequisites: vpc.sh must have run first (provides VPC_ID, subnet IDs)
#
# Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 14.1, 14.4

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib/config.sh"
source "${SCRIPT_DIR}/../lib/common.sh"

# Load resource IDs from previous scripts (VPC, subnets)
load_env

log_step "Creating ALB resources for CloudPulse..."

# ============================================================
# Step 1: Create ALB Security Group
# This security group is attached to the ALB and allows:
# - Inbound: HTTP traffic (TCP port 80) from anywhere (0.0.0.0/0)
# - Outbound: Will be configured after App SG is created (TCP 3000 to App SG)
# ============================================================
log_info "Creating ALB Security Group: ${PROJECT_NAME}-alb-sg"

# Create the security group in our VPC
ALB_SG_ID=$(aws ec2 create-security-group \
  --group-name "${PROJECT_NAME}-alb-sg" \
  --description "CloudPulse ALB Security Group - allows inbound HTTP from internet" \
  --vpc-id "$VPC_ID" \
  --region "$AWS_REGION" \
  --output text --query 'GroupId')

check_result "ALB Security Group created: ${ALB_SG_ID}" $?

# Tag the ALB security group for identification
aws ec2 create-tags \
  --resources "$ALB_SG_ID" \
  --tags Key=Name,Value="${PROJECT_NAME}-alb-sg" Key=Project,Value="$PROJECT_NAME" \
  --region "$AWS_REGION"

# Add inbound rule: Allow HTTP (TCP 80) from anywhere
# This enables users to access the ALB from the internet
aws ec2 authorize-security-group-ingress \
  --group-id "$ALB_SG_ID" \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0 \
  --region "$AWS_REGION"

check_result "ALB SG inbound rule: TCP 80 from 0.0.0.0/0" $?

log_info "ALB Security Group created: ${ALB_SG_ID}"

# ============================================================
# Step 2: Create App Security Group
# This security group is attached to EC2 instances and allows:
# - Inbound: TCP port 3000 from ALB Security Group only (least privilege)
# - Outbound: TCP port 443 to 0.0.0.0/0 (for AWS API access via NAT)
# ============================================================
log_info "Creating App Security Group: ${PROJECT_NAME}-app-sg"

# Create the app security group in our VPC
APP_SG_ID=$(aws ec2 create-security-group \
  --group-name "${PROJECT_NAME}-app-sg" \
  --description "CloudPulse App Security Group - allows inbound from ALB on port 3000" \
  --vpc-id "$VPC_ID" \
  --region "$AWS_REGION" \
  --output text --query 'GroupId')

check_result "App Security Group created: ${APP_SG_ID}" $?

# Tag the app security group for identification
aws ec2 create-tags \
  --resources "$APP_SG_ID" \
  --tags Key=Name,Value="${PROJECT_NAME}-app-sg" Key=Project,Value="$PROJECT_NAME" \
  --region "$AWS_REGION"

# Add inbound rule: Allow TCP 3000 from ALB Security Group only
# This ensures only the ALB can reach the application instances
aws ec2 authorize-security-group-ingress \
  --group-id "$APP_SG_ID" \
  --protocol tcp \
  --port "$APP_PORT" \
  --source-group "$ALB_SG_ID" \
  --region "$AWS_REGION"

check_result "App SG inbound rule: TCP ${APP_PORT} from ALB SG (${ALB_SG_ID})" $?

# Remove the default "allow all" outbound rule so we can apply least-privilege
# The default VPC security group allows all outbound traffic
aws ec2 revoke-security-group-egress \
  --group-id "$APP_SG_ID" \
  --protocol all \
  --cidr 0.0.0.0/0 \
  --region "$AWS_REGION" 2>/dev/null || true

# Add outbound rule: Allow TCP 443 to anywhere (for AWS API calls via NAT Gateway)
# Instances need HTTPS access to reach CloudWatch, EC2, AutoScaling APIs
aws ec2 authorize-security-group-egress \
  --group-id "$APP_SG_ID" \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 \
  --region "$AWS_REGION"

check_result "App SG outbound rule: TCP 443 to 0.0.0.0/0" $?

log_info "App Security Group created: ${APP_SG_ID}"

# ============================================================
# Step 2b: Configure ALB Security Group outbound rule
# Now that the App SG exists, restrict ALB outbound to only port 3000
# to the App Security Group (least privilege)
# ============================================================
log_info "Configuring ALB SG outbound rule to App SG"

# Remove the default "allow all" outbound rule from ALB SG
aws ec2 revoke-security-group-egress \
  --group-id "$ALB_SG_ID" \
  --protocol all \
  --cidr 0.0.0.0/0 \
  --region "$AWS_REGION" 2>/dev/null || true

# Add outbound rule: Allow TCP 3000 to App Security Group only
# The ALB should only be able to forward traffic to app instances on port 3000
aws ec2 authorize-security-group-egress \
  --group-id "$ALB_SG_ID" \
  --protocol tcp \
  --port "$APP_PORT" \
  --source-group "$APP_SG_ID" \
  --region "$AWS_REGION"

check_result "ALB SG outbound rule: TCP ${APP_PORT} to App SG (${APP_SG_ID})" $?

# ============================================================
# Step 3: Create Internet-Facing Application Load Balancer
# The ALB is placed in public subnets so it can receive traffic from
# the internet. It distributes requests to instances in private subnets.
# NOTE: ALB costs ~$0.0225/hour (~$16/month) outside free tier
# ============================================================
log_info "Creating Application Load Balancer: ${PROJECT_NAME}-alb"

# Create the ALB in both public subnets for high availability
# --scheme internet-facing: ALB gets a public DNS name accessible from internet
# --type application: Layer 7 load balancer (HTTP/HTTPS aware)
ALB_ARN=$(aws elbv2 create-load-balancer \
  --name "${PROJECT_NAME}-alb" \
  --subnets "$PUBLIC_SUBNET_1_ID" "$PUBLIC_SUBNET_2_ID" \
  --security-groups "$ALB_SG_ID" \
  --scheme internet-facing \
  --type application \
  --tags Key=Name,Value="${PROJECT_NAME}-alb" Key=Project,Value="$PROJECT_NAME" \
  --region "$AWS_REGION" \
  --output text --query 'LoadBalancers[0].LoadBalancerArn')

check_result "ALB created: ${ALB_ARN}" $?

# Get the ALB DNS name — this is how users will access the application
ALB_DNS_NAME=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "$ALB_ARN" \
  --region "$AWS_REGION" \
  --output text --query 'LoadBalancers[0].DNSName')

log_info "ALB DNS Name: ${ALB_DNS_NAME}"

# Wait for the ALB to become active before creating listeners
# The ALB transitions from 'provisioning' to 'active' state
log_info "Waiting for ALB to become active..."

wait_for_resource \
  "ALB ${PROJECT_NAME}-alb" \
  "aws elbv2 describe-load-balancers --load-balancer-arns ${ALB_ARN} --region ${AWS_REGION} --output text --query 'LoadBalancers[0].State.Code'" \
  "active" \
  300

check_result "ALB is now active" $?

# ============================================================
# Step 4: Create Target Group
# The target group defines where the ALB sends traffic:
# - Protocol HTTP on port 3000 (our app listens on 3000)
# - Target type: instance (EC2 instances registered by ASG)
# - Health check on /health endpoint to determine instance health
# ============================================================
log_info "Creating Target Group: ${PROJECT_NAME}-tg"

# Create target group with health check configuration
# Health check settings determine when instances are marked healthy/unhealthy:
# - Path: /health — our app's health endpoint
# - Interval: 30s — check every 30 seconds
# - Timeout: 5s — fail if no response within 5 seconds
# - Healthy threshold: 2 — mark healthy after 2 consecutive successes
# - Unhealthy threshold: 3 — mark unhealthy after 3 consecutive failures
TG_ARN=$(aws elbv2 create-target-group \
  --name "${PROJECT_NAME}-tg" \
  --protocol HTTP \
  --port "$APP_PORT" \
  --vpc-id "$VPC_ID" \
  --target-type instance \
  --health-check-protocol HTTP \
  --health-check-path "${HEALTH_CHECK_PATH}" \
  --health-check-interval-seconds "$HEALTH_CHECK_INTERVAL" \
  --health-check-timeout-seconds "$HEALTH_CHECK_TIMEOUT" \
  --healthy-threshold-count "$HEALTHY_THRESHOLD" \
  --unhealthy-threshold-count "$UNHEALTHY_THRESHOLD" \
  --tags Key=Name,Value="${PROJECT_NAME}-tg" Key=Project,Value="$PROJECT_NAME" \
  --region "$AWS_REGION" \
  --output text --query 'TargetGroups[0].TargetGroupArn')

check_result "Target Group created: ${TG_ARN}" $?

log_info "Target Group created with health check on ${HEALTH_CHECK_PATH}"

# ============================================================
# Step 5: Create HTTP Listener on port 80
# The listener defines how the ALB handles incoming connections:
# - Listens on port 80 (HTTP)
# - Default action: forward all requests to our target group
# No HTTPS listener needed — we access via ALB DNS name over HTTP only
# ============================================================
log_info "Creating HTTP Listener on port 80"

# Create listener that forwards all traffic to the target group
LISTENER_ARN=$(aws elbv2 create-listener \
  --load-balancer-arn "$ALB_ARN" \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn="$TG_ARN" \
  --region "$AWS_REGION" \
  --output text --query 'Listeners[0].ListenerArn')

check_result "HTTP Listener created: ${LISTENER_ARN}" $?

# ============================================================
# Step 6: Save all resource IDs to environment file
# These IDs are needed by subsequent scripts (compute.sh)
# ============================================================
log_info "Saving ALB resource IDs to environment file"

save_resource "ALB_SG_ID" "$ALB_SG_ID"
save_resource "APP_SG_ID" "$APP_SG_ID"
save_resource "ALB_ARN" "$ALB_ARN"
save_resource "TG_ARN" "$TG_ARN"
save_resource "LISTENER_ARN" "$LISTENER_ARN"
save_resource "ALB_DNS_NAME" "$ALB_DNS_NAME"

# ============================================================
# Step 7: Output summary
# Display the ALB DNS name for user access
# ============================================================
log_info "ALB setup complete!"
log_info "  ALB Security Group: ${ALB_SG_ID}"
log_info "  App Security Group: ${APP_SG_ID}"
log_info "  ALB ARN: ${ALB_ARN}"
log_info "  Target Group ARN: ${TG_ARN}"
log_info "  Listener ARN: ${LISTENER_ARN}"
echo ""
echo "Application URL: http://${ALB_DNS_NAME}"
