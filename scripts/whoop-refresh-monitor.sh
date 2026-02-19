#!/usr/bin/env bash
set -euo pipefail

PROFILE="${WHOOP_PROFILE:-default}"
CLI="${WHOOP_CLI_BIN:-whoop}"

# 1) Refresh token state
$CLI auth refresh --profile "$PROFILE" --json >/tmp/whoop-auth-refresh.json

# 2) Lightweight health check
$CLI summary --profile "$PROFILE" --json >/tmp/whoop-summary.json

echo "whoop refresh monitor: ok"
