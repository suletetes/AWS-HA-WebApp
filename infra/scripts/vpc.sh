#!/bin/bash
# CloudPulse Infrastructure - VPC Network Architecture
# Provisions the complete VPC networking stack including subnets, gateways,
# route tables, and NACLs using AWS CLI.
#
# This script creates:
# 1. VPC with CIDR 10.0.0.0/16 (DNS support + DNS hostnames enabled)
# 2. 2 public subnets (10.0.1.0/24 in AZ-a, 10.0.2.0/24 in AZ-b)
# 3. 2 private subnets (10.0.3.0/24 in AZ-a, 10.0.4.0/24 in AZ-b)
# 4. Internet Gateway attached to VPC
# 5. 2 Elastic IPs (one per AZ)
# 6. 2 NAT Gateways (one in each public subnet)
# 7. Public route table with route to IGW
# 8. 2 private route tables (one per AZ) with route to local NAT Gateway
# 9. NACLs on private subnets restricting traffic
#
# Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.5, 12.2, 12.3, 12.4
#
# Cost Note: NAT Gateways incur charges (~$0.045/hr each + data processing).
# Consider deleting these resources when not in use via teardown.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib/config.sh"
source "${SCRIPT_DIR}/../lib/common.sh"

log_step "Creating VPC networking stack for CloudPulse..."

# ============================================================
# Step 1: Get Availability Zones dynamically
# We need 2 AZs for high availability across the region.
# get_availability_zones returns the first two available AZs.
# ============================================================
log_info "Discovering availability zones in region: ${AWS_REGION}"

AZ_OUTPUT=$(get_availability_zones)
AZ_1=$(echo "$AZ_OUTPUT" | awk '{print $1}')
AZ_2=$(echo "$AZ_OUTPUT" | awk '{print $2}')

if [[ -z "$AZ_1" || -z "$AZ_2" ]]; then
  log_error "Could not determine availability zones. Need at least 2 AZs in region ${AWS_REGION}."
  exit 1
fi

log_info "Using Availability Zones: ${AZ_1}, ${AZ_2}"

# ============================================================
# Step 2: Create VPC with CIDR 10.0.0.0/16
# The VPC is the isolated virtual network that contains all our resources.
# We use a /16 CIDR which gives us 65,536 IP addresses — plenty of room
# for subnets, load balancers, and future expansion.
# ============================================================
log_info "Creating VPC with CIDR: ${VPC_CIDR}"

VPC_ID=$(aws ec2 create-vpc \
  --cidr-block "$VPC_CIDR" \
  --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${PROJECT_NAME}-vpc},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'Vpc.VpcId')

check_result "VPC created: ${VPC_ID}" $?
save_resource "VPC_ID" "$VPC_ID"

# ============================================================
# Step 3: Enable DNS support and DNS hostnames on the VPC
# DNS support allows instances to resolve public DNS hostnames.
# DNS hostnames assigns public DNS names to instances with public IPs.
# Both are required for services like ELB to work correctly.
# ============================================================
log_info "Enabling DNS support on VPC"

aws ec2 modify-vpc-attribute \
  --vpc-id "$VPC_ID" \
  --enable-dns-support '{"Value": true}' \
  --region "$AWS_REGION"

check_result "DNS support enabled" $?

log_info "Enabling DNS hostnames on VPC"

aws ec2 modify-vpc-attribute \
  --vpc-id "$VPC_ID" \
  --enable-dns-hostnames '{"Value": true}' \
  --region "$AWS_REGION"

check_result "DNS hostnames enabled" $?

# ============================================================
# Step 4: Create Public Subnets
# Public subnets host internet-facing resources (ALB, NAT Gateways).
# We create one in each AZ for high availability.
# - Public Subnet 1: 10.0.1.0/24 in AZ-a (256 IPs)
# - Public Subnet 2: 10.0.2.0/24 in AZ-b (256 IPs)
# ============================================================
log_info "Creating public subnet 1 (${PUBLIC_SUBNET_1_CIDR}) in ${AZ_1}"

PUBLIC_SUBNET_1_ID=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block "$PUBLIC_SUBNET_1_CIDR" \
  --availability-zone "$AZ_1" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJECT_NAME}-public-subnet-1},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'Subnet.SubnetId')

check_result "Public subnet 1 created: ${PUBLIC_SUBNET_1_ID}" $?
save_resource "PUBLIC_SUBNET_1_ID" "$PUBLIC_SUBNET_1_ID"

log_info "Creating public subnet 2 (${PUBLIC_SUBNET_2_CIDR}) in ${AZ_2}"

PUBLIC_SUBNET_2_ID=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block "$PUBLIC_SUBNET_2_CIDR" \
  --availability-zone "$AZ_2" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJECT_NAME}-public-subnet-2},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'Subnet.SubnetId')

check_result "Public subnet 2 created: ${PUBLIC_SUBNET_2_ID}" $?
save_resource "PUBLIC_SUBNET_2_ID" "$PUBLIC_SUBNET_2_ID"

# ============================================================
# Step 5: Create Private Subnets
# Private subnets host application instances (EC2). They have no
# direct internet access — outbound traffic goes through NAT Gateways.
# - Private Subnet 1: 10.0.3.0/24 in AZ-a (256 IPs)
# - Private Subnet 2: 10.0.4.0/24 in AZ-b (256 IPs)
# ============================================================
log_info "Creating private subnet 1 (${PRIVATE_SUBNET_1_CIDR}) in ${AZ_1}"

PRIVATE_SUBNET_1_ID=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block "$PRIVATE_SUBNET_1_CIDR" \
  --availability-zone "$AZ_1" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJECT_NAME}-private-subnet-1},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'Subnet.SubnetId')

check_result "Private subnet 1 created: ${PRIVATE_SUBNET_1_ID}" $?
save_resource "PRIVATE_SUBNET_1_ID" "$PRIVATE_SUBNET_1_ID"

log_info "Creating private subnet 2 (${PRIVATE_SUBNET_2_CIDR}) in ${AZ_2}"

PRIVATE_SUBNET_2_ID=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block "$PRIVATE_SUBNET_2_CIDR" \
  --availability-zone "$AZ_2" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJECT_NAME}-private-subnet-2},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'Subnet.SubnetId')

check_result "Private subnet 2 created: ${PRIVATE_SUBNET_2_ID}" $?
save_resource "PRIVATE_SUBNET_2_ID" "$PRIVATE_SUBNET_2_ID"

# ============================================================
# Step 6: Create and Attach Internet Gateway
# The IGW enables communication between the VPC and the public internet.
# Resources in public subnets use the IGW for inbound/outbound internet traffic.
# Only one IGW can be attached to a VPC at a time.
# ============================================================
log_info "Creating Internet Gateway"

IGW_ID=$(aws ec2 create-internet-gateway \
  --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${PROJECT_NAME}-igw},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'InternetGateway.InternetGatewayId')

check_result "Internet Gateway created: ${IGW_ID}" $?
save_resource "IGW_ID" "$IGW_ID"

log_info "Attaching Internet Gateway to VPC"

aws ec2 attach-internet-gateway \
  --internet-gateway-id "$IGW_ID" \
  --vpc-id "$VPC_ID" \
  --region "$AWS_REGION"

check_result "Internet Gateway attached to VPC" $?

# ============================================================
# Step 7: Allocate Elastic IPs for NAT Gateways
# Each NAT Gateway requires a static Elastic IP address.
# We allocate one per AZ so each private subnet has its own
# NAT Gateway for fault isolation — if one AZ's NAT fails,
# the other AZ continues to function.
# ============================================================
log_info "Allocating Elastic IP 1 for NAT Gateway in ${AZ_1}"

EIP_1_ALLOC_ID=$(aws ec2 allocate-address \
  --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${PROJECT_NAME}-eip-nat-1},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'AllocationId')

check_result "Elastic IP 1 allocated: ${EIP_1_ALLOC_ID}" $?
save_resource "EIP_1_ALLOC_ID" "$EIP_1_ALLOC_ID"

log_info "Allocating Elastic IP 2 for NAT Gateway in ${AZ_2}"

EIP_2_ALLOC_ID=$(aws ec2 allocate-address \
  --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${PROJECT_NAME}-eip-nat-2},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'AllocationId')

check_result "Elastic IP 2 allocated: ${EIP_2_ALLOC_ID}" $?
save_resource "EIP_2_ALLOC_ID" "$EIP_2_ALLOC_ID"

# ============================================================
# Step 8: Create NAT Gateways
# NAT Gateways allow instances in private subnets to initiate
# outbound connections to the internet (e.g., for AWS API calls,
# package downloads) without being directly reachable from the internet.
# We place one NAT Gateway in each public subnet for HA.
#
# Cost Note: NAT Gateways cost ~$0.045/hour each (~$32/month per gateway).
# This is one of the primary cost drivers outside the free tier.
# ============================================================
log_info "Creating NAT Gateway 1 in public subnet 1 (${AZ_1})"

NAT_GW_1_ID=$(aws ec2 create-nat-gateway \
  --subnet-id "$PUBLIC_SUBNET_1_ID" \
  --allocation-id "$EIP_1_ALLOC_ID" \
  --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${PROJECT_NAME}-nat-gw-1},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'NatGateway.NatGatewayId')

check_result "NAT Gateway 1 created: ${NAT_GW_1_ID}" $?
save_resource "NAT_GW_1_ID" "$NAT_GW_1_ID"

log_info "Creating NAT Gateway 2 in public subnet 2 (${AZ_2})"

NAT_GW_2_ID=$(aws ec2 create-nat-gateway \
  --subnet-id "$PUBLIC_SUBNET_2_ID" \
  --allocation-id "$EIP_2_ALLOC_ID" \
  --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${PROJECT_NAME}-nat-gw-2},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'NatGateway.NatGatewayId')

check_result "NAT Gateway 2 created: ${NAT_GW_2_ID}" $?
save_resource "NAT_GW_2_ID" "$NAT_GW_2_ID"

# ============================================================
# Step 9: Wait for NAT Gateways to become available
# NAT Gateways take 1-3 minutes to provision. We must wait for
# them to reach the "available" state before creating routes that
# reference them, otherwise the route creation will fail.
# ============================================================
log_info "Waiting for NAT Gateway 1 to become available..."

aws ec2 wait nat-gateway-available \
  --nat-gateway-ids "$NAT_GW_1_ID" \
  --region "$AWS_REGION"

check_result "NAT Gateway 1 is available" $?

log_info "Waiting for NAT Gateway 2 to become available..."

aws ec2 wait nat-gateway-available \
  --nat-gateway-ids "$NAT_GW_2_ID" \
  --region "$AWS_REGION"

check_result "NAT Gateway 2 is available" $?

# ============================================================
# Step 10: Create Public Route Table
# The public route table directs all non-local traffic (0.0.0.0/0)
# to the Internet Gateway. This makes subnets associated with this
# route table "public" — instances can send/receive internet traffic.
# ============================================================
log_info "Creating public route table"

PUBLIC_RT_ID=$(aws ec2 create-route-table \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PROJECT_NAME}-public-rt},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'RouteTable.RouteTableId')

check_result "Public route table created: ${PUBLIC_RT_ID}" $?
save_resource "PUBLIC_RT_ID" "$PUBLIC_RT_ID"

# Add route to Internet Gateway for all internet-bound traffic
log_info "Adding route to IGW in public route table"

aws ec2 create-route \
  --route-table-id "$PUBLIC_RT_ID" \
  --destination-cidr-block "0.0.0.0/0" \
  --gateway-id "$IGW_ID" \
  --region "$AWS_REGION"

check_result "Public route to IGW created" $?

# ============================================================
# Step 11: Associate Public Subnets with Public Route Table
# Subnets are "public" only when associated with a route table
# that has a route to an Internet Gateway. Without this association,
# the subnet uses the VPC's main route table (which has no IGW route).
# ============================================================
log_info "Associating public subnet 1 with public route table"

PUBLIC_RT_ASSOC_1=$(aws ec2 associate-route-table \
  --route-table-id "$PUBLIC_RT_ID" \
  --subnet-id "$PUBLIC_SUBNET_1_ID" \
  --region "$AWS_REGION" \
  --output text --query 'AssociationId')

check_result "Public subnet 1 associated with public RT" $?
save_resource "PUBLIC_RT_ASSOC_1" "$PUBLIC_RT_ASSOC_1"

log_info "Associating public subnet 2 with public route table"

PUBLIC_RT_ASSOC_2=$(aws ec2 associate-route-table \
  --route-table-id "$PUBLIC_RT_ID" \
  --subnet-id "$PUBLIC_SUBNET_2_ID" \
  --region "$AWS_REGION" \
  --output text --query 'AssociationId')

check_result "Public subnet 2 associated with public RT" $?
save_resource "PUBLIC_RT_ASSOC_2" "$PUBLIC_RT_ASSOC_2"

# ============================================================
# Step 12: Create Private Route Tables (one per AZ)
# Each private subnet gets its own route table pointing to the
# NAT Gateway in the same AZ. This ensures AZ-isolated routing:
# if NAT GW in AZ-a fails, only private subnet in AZ-a is affected.
# ============================================================
log_info "Creating private route table 1 (for ${AZ_1})"

PRIVATE_RT_1_ID=$(aws ec2 create-route-table \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PROJECT_NAME}-private-rt-1},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'RouteTable.RouteTableId')

check_result "Private route table 1 created: ${PRIVATE_RT_1_ID}" $?
save_resource "PRIVATE_RT_1_ID" "$PRIVATE_RT_1_ID"

# Route internet-bound traffic from private subnet 1 to NAT Gateway 1
log_info "Adding route to NAT Gateway 1 in private route table 1"

aws ec2 create-route \
  --route-table-id "$PRIVATE_RT_1_ID" \
  --destination-cidr-block "0.0.0.0/0" \
  --nat-gateway-id "$NAT_GW_1_ID" \
  --region "$AWS_REGION"

check_result "Private route 1 to NAT GW 1 created" $?

log_info "Creating private route table 2 (for ${AZ_2})"

PRIVATE_RT_2_ID=$(aws ec2 create-route-table \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PROJECT_NAME}-private-rt-2},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'RouteTable.RouteTableId')

check_result "Private route table 2 created: ${PRIVATE_RT_2_ID}" $?
save_resource "PRIVATE_RT_2_ID" "$PRIVATE_RT_2_ID"

# Route internet-bound traffic from private subnet 2 to NAT Gateway 2
log_info "Adding route to NAT Gateway 2 in private route table 2"

aws ec2 create-route \
  --route-table-id "$PRIVATE_RT_2_ID" \
  --destination-cidr-block "0.0.0.0/0" \
  --nat-gateway-id "$NAT_GW_2_ID" \
  --region "$AWS_REGION"

check_result "Private route 2 to NAT GW 2 created" $?

# ============================================================
# Step 13: Associate Private Subnets with Private Route Tables
# Each private subnet is associated with the route table that
# points to the NAT Gateway in the same AZ.
# ============================================================
log_info "Associating private subnet 1 with private route table 1"

PRIVATE_RT_ASSOC_1=$(aws ec2 associate-route-table \
  --route-table-id "$PRIVATE_RT_1_ID" \
  --subnet-id "$PRIVATE_SUBNET_1_ID" \
  --region "$AWS_REGION" \
  --output text --query 'AssociationId')

check_result "Private subnet 1 associated with private RT 1" $?
save_resource "PRIVATE_RT_ASSOC_1" "$PRIVATE_RT_ASSOC_1"

log_info "Associating private subnet 2 with private route table 2"

PRIVATE_RT_ASSOC_2=$(aws ec2 associate-route-table \
  --route-table-id "$PRIVATE_RT_2_ID" \
  --subnet-id "$PRIVATE_SUBNET_2_ID" \
  --region "$AWS_REGION" \
  --output text --query 'AssociationId')

check_result "Private subnet 2 associated with private RT 2" $?
save_resource "PRIVATE_RT_ASSOC_2" "$PRIVATE_RT_ASSOC_2"

# ============================================================
# Step 14: Enable Auto-Assign Public IP on Public Subnets
# Instances launched in public subnets automatically receive a
# public IP address. This is needed for the ALB nodes and any
# bastion hosts placed in public subnets.
# ============================================================
log_info "Enabling auto-assign public IP on public subnet 1"

aws ec2 modify-subnet-attribute \
  --subnet-id "$PUBLIC_SUBNET_1_ID" \
  --map-public-ip-on-launch \
  --region "$AWS_REGION"

check_result "Auto-assign public IP enabled on public subnet 1" $?

log_info "Enabling auto-assign public IP on public subnet 2"

aws ec2 modify-subnet-attribute \
  --subnet-id "$PUBLIC_SUBNET_2_ID" \
  --map-public-ip-on-launch \
  --region "$AWS_REGION"

check_result "Auto-assign public IP enabled on public subnet 2" $?

# ============================================================
# Step 15: Create Network ACL for Private Subnets
# NACLs are stateless firewalls at the subnet level. Unlike security
# groups (stateful), NACLs require explicit rules for both inbound
# and outbound traffic, including return traffic on ephemeral ports.
#
# Our private subnet NACL allows:
# - Inbound TCP 3000 from VPC (ALB health checks and app traffic)
# - Inbound TCP 1024-65535 from anywhere (return traffic from internet)
# - Outbound TCP 443 to anywhere (AWS API calls via HTTPS)
# - Outbound TCP 1024-65535 to anywhere (ephemeral ports for responses)
# - Deny all other traffic (implicit deny at rule 32767)
# ============================================================
log_info "Creating Network ACL for private subnets"

PRIVATE_NACL_ID=$(aws ec2 create-network-acl \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=network-acl,Tags=[{Key=Name,Value=${PROJECT_NAME}-private-nacl},{Key=Project,Value=${PROJECT_NAME}}]" \
  --region "$AWS_REGION" \
  --output text --query 'NetworkAcl.NetworkAclId')

check_result "Private NACL created: ${PRIVATE_NACL_ID}" $?
save_resource "PRIVATE_NACL_ID" "$PRIVATE_NACL_ID"

# --- Inbound Rules ---

# Rule 100: Allow inbound TCP port 3000 from VPC CIDR (10.0.0.0/16)
# This allows the ALB (in public subnets) to reach the app on port 3000
log_info "Adding NACL inbound rule: Allow TCP 3000 from VPC CIDR"

aws ec2 create-network-acl-entry \
  --network-acl-id "$PRIVATE_NACL_ID" \
  --rule-number 100 \
  --protocol "6" \
  --rule-action "allow" \
  --ingress \
  --cidr-block "$VPC_CIDR" \
  --port-range From=3000,To=3000 \
  --region "$AWS_REGION"

check_result "NACL inbound rule 100 (TCP 3000 from VPC) created" $?

# Rule 110: Allow inbound TCP ports 1024-65535 from 0.0.0.0/0
# These are ephemeral ports for return traffic from internet requests
# (e.g., responses from AWS APIs, package downloads via NAT Gateway)
log_info "Adding NACL inbound rule: Allow TCP 1024-65535 from 0.0.0.0/0 (ephemeral ports)"

aws ec2 create-network-acl-entry \
  --network-acl-id "$PRIVATE_NACL_ID" \
  --rule-number 110 \
  --protocol "6" \
  --rule-action "allow" \
  --ingress \
  --cidr-block "0.0.0.0/0" \
  --port-range From=1024,To=65535 \
  --region "$AWS_REGION"

check_result "NACL inbound rule 110 (ephemeral ports) created" $?

# --- Outbound Rules ---

# Rule 100: Allow outbound TCP port 443 to 0.0.0.0/0
# Instances need HTTPS access for AWS API calls (CloudWatch, EC2, ASG)
# and for downloading packages/updates via NAT Gateway
log_info "Adding NACL outbound rule: Allow TCP 443 to 0.0.0.0/0"

aws ec2 create-network-acl-entry \
  --network-acl-id "$PRIVATE_NACL_ID" \
  --rule-number 100 \
  --protocol "6" \
  --rule-action "allow" \
  --egress \
  --cidr-block "0.0.0.0/0" \
  --port-range From=443,To=443 \
  --region "$AWS_REGION"

check_result "NACL outbound rule 100 (TCP 443) created" $?

# Rule 110: Allow outbound TCP ports 1024-65535 to 0.0.0.0/0
# Ephemeral ports for response traffic back to clients (ALB health checks,
# user requests) and for establishing outbound connections
log_info "Adding NACL outbound rule: Allow TCP 1024-65535 to 0.0.0.0/0"

aws ec2 create-network-acl-entry \
  --network-acl-id "$PRIVATE_NACL_ID" \
  --rule-number 110 \
  --protocol "6" \
  --rule-action "allow" \
  --egress \
  --cidr-block "0.0.0.0/0" \
  --port-range From=1024,To=65535 \
  --region "$AWS_REGION"

check_result "NACL outbound rule 110 (ephemeral ports) created" $?

# Note: All other traffic is implicitly denied by the default deny rule
# (rule number 32767, which denies all traffic not matched by earlier rules).
# This is the "deny all other traffic" requirement.

# ============================================================
# Step 16: Associate Private NACL with Private Subnets
# Replace the default NACL association with our custom NACL.
# We need to find the current (default) NACL association first,
# then replace it with our custom NACL.
# ============================================================
log_info "Associating private NACL with private subnet 1"

# Get the current NACL association ID for private subnet 1
CURRENT_NACL_ASSOC_1=$(aws ec2 describe-network-acls \
  --filters "Name=association.subnet-id,Values=${PRIVATE_SUBNET_1_ID}" \
  --region "$AWS_REGION" \
  --output text --query 'NetworkAcls[0].Associations[?SubnetId==`'"${PRIVATE_SUBNET_1_ID}"'`].NetworkAclAssociationId')

aws ec2 replace-network-acl-association \
  --association-id "$CURRENT_NACL_ASSOC_1" \
  --network-acl-id "$PRIVATE_NACL_ID" \
  --region "$AWS_REGION"

check_result "Private NACL associated with private subnet 1" $?

log_info "Associating private NACL with private subnet 2"

# Get the current NACL association ID for private subnet 2
CURRENT_NACL_ASSOC_2=$(aws ec2 describe-network-acls \
  --filters "Name=association.subnet-id,Values=${PRIVATE_SUBNET_2_ID}" \
  --region "$AWS_REGION" \
  --output text --query 'NetworkAcls[0].Associations[?SubnetId==`'"${PRIVATE_SUBNET_2_ID}"'`].NetworkAclAssociationId')

aws ec2 replace-network-acl-association \
  --association-id "$CURRENT_NACL_ASSOC_2" \
  --network-acl-id "$PRIVATE_NACL_ID" \
  --region "$AWS_REGION"

check_result "Private NACL associated with private subnet 2" $?

# ============================================================
# Summary
# ============================================================
log_info "VPC networking stack created successfully!"
log_info "  VPC ID:              ${VPC_ID}"
log_info "  Public Subnet 1:     ${PUBLIC_SUBNET_1_ID} (${AZ_1})"
log_info "  Public Subnet 2:     ${PUBLIC_SUBNET_2_ID} (${AZ_2})"
log_info "  Private Subnet 1:    ${PRIVATE_SUBNET_1_ID} (${AZ_1})"
log_info "  Private Subnet 2:    ${PRIVATE_SUBNET_2_ID} (${AZ_2})"
log_info "  Internet Gateway:    ${IGW_ID}"
log_info "  NAT Gateway 1:       ${NAT_GW_1_ID} (${AZ_1})"
log_info "  NAT Gateway 2:       ${NAT_GW_2_ID} (${AZ_2})"
log_info "  Public Route Table:  ${PUBLIC_RT_ID}"
log_info "  Private RT 1:        ${PRIVATE_RT_1_ID}"
log_info "  Private RT 2:        ${PRIVATE_RT_2_ID}"
log_info "  Private NACL:        ${PRIVATE_NACL_ID}"
