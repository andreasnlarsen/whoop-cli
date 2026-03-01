#!/usr/bin/env bash
set -euo pipefail

PROFILE="${WHOOP_PROFILE:-default}"
CLI="${WHOOP_CLI_BIN:-whoop}"
AUTH_OUT="$(mktemp /tmp/whoop-auth-refresh.XXXXXX.json)"
SUMMARY_OUT="$(mktemp /tmp/whoop-summary.XXXXXX.json)"
trap 'rm -f "$AUTH_OUT" "$SUMMARY_OUT"' EXIT

# 1) Refresh token state
"$CLI" auth refresh --profile "$PROFILE" --json >"$AUTH_OUT"

# 2) Lightweight health check
"$CLI" summary --profile "$PROFILE" --json >"$SUMMARY_OUT"

echo "whoop refresh monitor: ok"
