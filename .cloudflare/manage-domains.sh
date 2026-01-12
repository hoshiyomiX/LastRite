#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Config
DOMAINS_FILE="$(dirname "$0")/domains.txt"
WORKER_NAME="last-rite"

# Helper functions
info() { echo -e "${BLUE}ℹ${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warning() { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

# Check if domains file exists
if [ ! -f "$DOMAINS_FILE" ]; then
  error "Domains file not found: $DOMAINS_FILE"
  exit 1
fi

# Read domains from file
DOMAINS=()
while IFS= read -r line || [ -n "$line" ]; do
  line=$(echo "$line" | xargs)
  [ -z "$line" ] || [[ "$line" == \#* ]] && continue
  DOMAINS+=("$line")
done < "$DOMAINS_FILE"

if [ ${#DOMAINS[@]} -eq 0 ]; then
  error "No domains found in $DOMAINS_FILE"
  exit 1
fi

info "Loaded ${#DOMAINS[@]} domains from $DOMAINS_FILE"

# Commands
attach_domains() {
  info "Attaching all domains to worker: $WORKER_NAME"
  echo ""
  
  local success=0
  local already=0
  local failed=0
  
  for domain in "${DOMAINS[@]}"; do
    printf "Processing: %-50s " "$domain"
    
    output=$(wrangler domains add "$domain" 2>&1 || true)
    
    if echo "$output" | grep -qi "already exists"; then
      echo -e "${YELLOW}[ALREADY ATTACHED]${NC}"
      ((already++))
    elif echo "$output" | grep -qi "successfully attached\|success"; then
      echo -e "${GREEN}[ATTACHED]${NC}"
      ((success++))
    else
      echo -e "${RED}[FAILED]${NC}"
      error "  Error: $output"
      ((failed++))
    fi
  done
  
  echo ""
  info "Summary: ${GREEN}$success attached${NC}, ${YELLOW}$already already${NC}, ${RED}$failed failed${NC}"
  
  [ $failed -eq 0 ] && return 0 || return 1
}

list_domains() {
  info "Listing all attached domains for worker: $WORKER_NAME"
  echo ""
  
  wrangler domains list || {
    error "Failed to list domains"
    return 1
  }
}

remove_domains() {
  warning "This will DETACH all domains from worker: $WORKER_NAME"
  read -p "Are you sure? (yes/NO): " confirm
  
  if [ "$confirm" != "yes" ]; then
    info "Aborted"
    return 0
  fi
  
  echo ""
  info "Removing all domains..."
  
  local success=0
  local failed=0
  
  for domain in "${DOMAINS[@]}"; do
    printf "Removing: %-50s " "$domain"
    
    if wrangler domains remove "$domain" --force 2>/dev/null; then
      echo -e "${GREEN}[REMOVED]${NC}"
      ((success++))
    else
      echo -e "${RED}[FAILED]${NC}"
      ((failed++))
    fi
  done
  
  echo ""
  info "Summary: ${GREEN}$success removed${NC}, ${RED}$failed failed${NC}"
}

verify_domains() {
  info "Verifying domain responses..."
  echo ""
  
  local working=0
  local broken=0
  
  for domain in "${DOMAINS[@]}"; do
    printf "Testing: %-50s " "$domain"
    
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "https://$domain/api/v1/myip" --max-time 10 2>/dev/null || echo "000")
    
    if [ "$http_code" -eq 200 ]; then
      echo -e "${GREEN}[OK - HTTP $http_code]${NC}"
      ((working++))
    elif [ "$http_code" -ge 400 ] && [ "$http_code" -lt 500 ]; then
      echo -e "${YELLOW}[PARTIAL - HTTP $http_code]${NC}"
      ((working++))
    else
      echo -e "${RED}[FAILED - HTTP $http_code]${NC}"
      ((broken++))
    fi
  done
  
  echo ""
  info "Summary: ${GREEN}$working working${NC}, ${RED}$broken broken${NC}"
  
  [ $broken -eq 0 ] && return 0 || return 1
}

show_usage() {
  cat << EOF
${BLUE}Cloudflare Worker Domain Management${NC}

Usage: $0 <command>

Commands:
  ${GREEN}attach${NC}   - Attach all domains from $DOMAINS_FILE
  ${BLUE}list${NC}     - List currently attached domains
  ${RED}remove${NC}   - Remove all domains (requires confirmation)
  ${YELLOW}verify${NC}  - Test HTTP responses for all domains
  ${BLUE}help${NC}     - Show this help message

Examples:
  $0 attach        # Attach all domains
  $0 verify        # Test all domains
  $0 list          # Show current status

Domains file: $DOMAINS_FILE
Domains loaded: ${#DOMAINS[@]}

To add/remove domains, edit $DOMAINS_FILE and run '$0 attach'
EOF
}

# Main
COMMAND="${1:-help}"

case "$COMMAND" in
  attach)
    attach_domains
    ;;
  list|ls)
    list_domains
    ;;
  remove|rm)
    remove_domains
    ;;
  verify|test)
    verify_domains
    ;;
  help|--help|-h)
    show_usage
    ;;
  *)
    error "Unknown command: $COMMAND"
    echo ""
    show_usage
    exit 1
    ;;
esac
