#!/usr/bin/env bash
# Start WEPPY MCP behind existing nginx HTTPS (virlur.duckdns.org → :8080)
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export PORT="${PORT:-8080}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://virlur.duckdns.org}"
export MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN:-}"
export DASHBOARD_AUTO_OPEN=false
export SKIP_PLUGIN_INSTALL=true
export WEPPY_MCP_DETACHED_LIFECYCLE=true
export HTTP_HOST="${HTTP_HOST:-127.0.0.1}"
export HTTP_PORT="${HTTP_PORT:-3002}"
export SUPERGATEWAY_PORT="${SUPERGATEWAY_PORT:-8787}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export NODE_ENV=production

# Free port if stale self
if ss -tlnp 2>/dev/null | rg -q ":${PORT}\\s"; then
  echo "[warn] port ${PORT} already in use"
  ss -tlnp | rg ":${PORT}\\s" || true
fi

exec node start.mjs
