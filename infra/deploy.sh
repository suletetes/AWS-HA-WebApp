#!/bin/bash
# CloudPulse Infrastructure - Master Deploy Script
# Executes all provisioning scripts in dependency order.
# Continues execution even if an earlier script fails.
#
# Execution order: iam.sh → vpc.sh → alb.sh → compute.sh → monitoring.sh
#
# Requirements: 12.6, 14.4

set -uo pipefail

# Prevent Git Bash on Windows from mangling paths (e.g., /health -> C:/Program Files/Git/health)
export MSYS_NO_PATHCONV=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/common.sh"

# Clear previous environment file
> "$ENV_FILE"

log_step "=========================================="
log_step "  CloudPulse Infrastructure Deployment"
log_step "=========================================="
log_info "Region: ${AWS_REGION}"
log_info "Project: ${PROJECT_NAME}"
echo ""

FAILED_SCRIPTS=()

run_script() {
  local script_name="$1"
  local script_path="${SCRIPT_DIR}/scripts/${script_name}"
  
  log_step "Running ${script_name}..."
  echo "---"
  
  if bash "$script_path"; then
    log_info "${script_name} completed successfully"
  else
    log_error "${script_name} FAILED (exit code: $?)"
    FAILED_SCRIPTS+=("$script_name")
  fi
  echo ""
}

# Execute scripts in dependency order
run_script "iam.sh"
run_script "vpc.sh"
run_script "alb.sh"
run_script "compute.sh"
run_script "monitoring.sh"

# Summary
echo ""
log_step "=========================================="
log_step "  Deployment Summary"
log_step "=========================================="

if [[ ${#FAILED_SCRIPTS[@]} -eq 0 ]]; then
  log_info "All scripts completed successfully!"
  
  # Load env to display ALB DNS
  load_env
  echo ""
  echo "============================================"
  echo "  Application URL: http://${ALB_DNS_NAME:-<pending>}"
  echo "============================================"
  echo ""
  log_info "Wait 3-5 minutes for instances to pass health checks."
  log_info "Then access the dashboard at the URL above."
else
  log_error "The following scripts failed:"
  for script in "${FAILED_SCRIPTS[@]}"; do
    log_error "  - ${script}"
  done
  log_warn "Some resources may have been created. Run teardown.sh to clean up."
fi
