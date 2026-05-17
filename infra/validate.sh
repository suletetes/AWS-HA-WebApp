#!/bin/bash
# CloudPulse - Master Validation Script
# Runs all validation scripts and reports overall pass/fail.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/common.sh"

log_step "=========================================="
log_step "  CloudPulse Infrastructure Validation"
log_step "=========================================="
echo ""

TOTAL_PASS=0
TOTAL_FAIL=0

run_validation() {
  local script_name="$1"
  local script_path="${SCRIPT_DIR}/tests/${script_name}"
  
  echo "---"
  if bash "$script_path"; then
    log_info "${script_name}: ALL PASSED"
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    log_error "${script_name}: SOME FAILED"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi
  echo ""
}

run_validation "validate-vpc.sh"
run_validation "validate-security.sh"
run_validation "validate-compute.sh"
run_validation "validate-alb.sh"

echo "=========================================="
echo "  Overall: ${TOTAL_PASS} suites passed, ${TOTAL_FAIL} suites failed"
echo "=========================================="

[[ $TOTAL_FAIL -eq 0 ]]
