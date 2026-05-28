#!/bin/bash
# CloudPulse - EC2 User-Data Bootstrap Script
# This script runs on first boot to install Node.js, deploy the app, and start it.
# It is base64-encoded and passed to the Launch Template as user-data.

set -euo pipefail

# Log all output to a file for debugging
exec > >(tee /var/log/cloudpulse-bootstrap.log) 2>&1
echo "=== CloudPulse Bootstrap Started at $(date) ==="

# ============================================================
# Step 1: Install Node.js 20 LTS on Amazon Linux 2023
# ============================================================
echo "Installing Node.js 20 LTS..."
dnf install -y nodejs20 npm

# Verify installation
node --version
npm --version

# ============================================================
# Step 2: Create application directory
# ============================================================
echo "Creating application directory..."
APP_DIR="/opt/cloudpulse"
mkdir -p "$APP_DIR"

# ============================================================
# Step 3: Deploy application code
# In production, you'd pull from S3, CodeDeploy, or a git repo.
# For this learning project, we embed a minimal package.json
# and pull the app code from an S3 bucket or git.
# ============================================================
echo "Deploying application code..."
cd "$APP_DIR"

# Create package.json (production dependencies only)
cat > package.json << 'PACKAGE_EOF'
{
  "name": "cloudpulse-dashboard",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@aws-sdk/client-auto-scaling": "^3.600.0",
    "@aws-sdk/client-cloudwatch": "^3.600.0",
    "@aws-sdk/client-ec2": "^3.600.0",
    "dotenv": "^16.4.5",
    "ejs": "^3.1.10",
    "express": "^4.19.2",
    "uuid": "^9.0.1",
    "winston": "^3.13.0",
    "winston-daily-rotate-file": "^5.0.0"
  }
}
PACKAGE_EOF

# Deploy application code from S3
# Resolve the deploy bucket from instance tags (set by the launch template)
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region || echo "us-east-1")
DEPLOY_BUCKET=$(aws ec2 describe-tags --filters "Name=resource-id,Values=${INSTANCE_ID}" "Name=key,Values=DeployBucket" --region "${AWS_REGION}" --query 'Tags[0].Value' --output text 2>/dev/null || echo "")

# Fallback: use naming convention if tag not found
if [[ -z "$DEPLOY_BUCKET" || "$DEPLOY_BUCKET" == "None" ]]; then
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  DEPLOY_BUCKET="cloudpulse-deploy-${ACCOUNT_ID}"
fi

echo "Pulling app from s3://${DEPLOY_BUCKET}/cloudpulse/latest/"
aws s3 sync "s3://${DEPLOY_BUCKET}/cloudpulse/latest/" "$APP_DIR/" --region "${AWS_REGION}"

# ============================================================
# Step 4: Install production dependencies
# ============================================================
echo "Installing npm dependencies..."
npm install --production

# ============================================================
# Step 5: Create log directory
# The application writes logs to /var/log/cloudpulse/app.log
# with rotation at 50MB and max 5 rotated files.
# ============================================================
echo "Creating log directory..."
mkdir -p /var/log/cloudpulse
chown -R ec2-user:ec2-user /var/log/cloudpulse

# ============================================================
# Step 6: Create environment file
# Configure the application with the ASG name and region.
# The ASG name is passed via instance tags or hardcoded here.
# ============================================================
echo "Creating environment configuration..."
cat > "$APP_DIR/.env" << ENV_EOF
PORT=3000
AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region || echo "us-east-1")
ASG_NAME=cloudpulse-asg
METRICS_NAMESPACE=CloudPulse
METRICS_INTERVAL_MS=60000
DASHBOARD_REFRESH_MS=30000
LOG_FILE_PATH=/var/log/cloudpulse/app.log
LOG_MAX_SIZE=50m
LOG_MAX_FILES=5
HEALTH_CHECK_TIMEOUT_MS=5000
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY_MS=1000
ENV_EOF

# ============================================================
# Step 7: Set up systemd service for auto-restart
# systemd ensures the app restarts automatically if it crashes
# and starts on boot.
# ============================================================
echo "Setting up systemd service..."
cat > /etc/systemd/system/cloudpulse.service << 'SERVICE_EOF'
[Unit]
Description=CloudPulse Health Dashboard
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/cloudpulse
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/cloudpulse/.env

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cloudpulse

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Set ownership
chown -R ec2-user:ec2-user "$APP_DIR"

# ============================================================
# Step 8: Start the application
# ============================================================
echo "Starting CloudPulse service..."
systemctl daemon-reload
systemctl enable cloudpulse
systemctl start cloudpulse

echo "=== CloudPulse Bootstrap Completed at $(date) ==="
echo "Service status:"
systemctl status cloudpulse --no-pager || true
