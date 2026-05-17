#!/bin/bash
# CloudPulse Infrastructure - Common Utility Functions

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_step() {
  echo -e "${BLUE}[STEP]${NC} $1"
}

# Save a resource ID to the environment file
save_resource() {
  local key="$1"
  local value="$2"
  echo "${key}=${value}" >> "$ENV_FILE"
  log_info "Saved ${key}=${value}"
}

# Load the environment file
load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
    log_info "Loaded environment from ${ENV_FILE}"
  else
    log_warn "Environment file not found: ${ENV_FILE}"
  fi
}

# Wait for a resource to reach a desired state
wait_for_resource() {
  local description="$1"
  local check_command="$2"
  local desired_state="$3"
  local timeout="${4:-300}"
  local interval=10
  local elapsed=0

  log_info "Waiting for ${description} to reach state: ${desired_state} (timeout: ${timeout}s)"

  while [[ $elapsed -lt $timeout ]]; do
    local current_state
    current_state=$(eval "$check_command" 2>/dev/null || echo "unknown")

    if [[ "$current_state" == "$desired_state" ]]; then
      log_info "${description} reached state: ${desired_state} (${elapsed}s)"
      return 0
    fi

    sleep $interval
    elapsed=$((elapsed + interval))
  done

  log_error "${description} did not reach state ${desired_state} within ${timeout}s (current: ${current_state:-unknown})"
  return 1
}

# Get the first two AZs in the configured region
get_availability_zones() {
  aws ec2 describe-availability-zones \
    --region "$AWS_REGION" \
    --query 'AvailabilityZones[?State==`available`].ZoneName' \
    --output text | awk '{print $1, $2}'
}

# Check if a command succeeded, exit with error if not
check_result() {
  local description="$1"
  local exit_code="$2"

  if [[ "$exit_code" -ne 0 ]]; then
    log_error "Failed: ${description}"
    exit 1
  fi
  log_info "Success: ${description}"
}
