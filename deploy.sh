#!/usr/bin/env bash
# One-shot Railway deploy helper for weppy-railway
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v railway >/dev/null 2>&1; then
  echo "Install Railway CLI first: npm i -g @railway/cli"
  exit 1
fi

if ! railway whoami >/dev/null 2>&1; then
  echo "Belum login Railway."
  echo "Jalankan: railway login --browserless"
  echo "Lalu paste pairing code di https://railway.app/account/tokens (device flow)"
  exit 1
fi

echo "[1/5] Init project (skip if already linked)..."
railway status >/dev/null 2>&1 || railway init

echo "[2/5] Set env defaults..."
TOKEN="${MCP_AUTH_TOKEN:-$(openssl rand -hex 24)}"
railway variables set \
  MCP_AUTH_TOKEN="$TOKEN" \
  DASHBOARD_AUTO_OPEN=false \
  SKIP_PLUGIN_INSTALL=true \
  WEPPY_MCP_DETACHED_LIFECYCLE=true \
  HTTP_HOST=127.0.0.1 \
  HTTP_PORT=3002 \
  SUPERGATEWAY_PORT=8787 \
  LOG_LEVEL=info \
  NODE_ENV=production

echo "[3/5] Deploy..."
railway up --detach

echo "[4/5] Generate domain (if none)..."
railway domain 2>/dev/null || true

echo "[5/5] Resolve public URL..."
DOMAIN="$(railway domain 2>/dev/null | head -1 || true)"
if [[ -n "${DOMAIN}" ]]; then
  # domain command output varies; also try variables
  true
fi
# Prefer RAILWAY_PUBLIC_DOMAIN after deploy
sleep 3
PUBLIC="$(railway variables 2>/dev/null | rg -o 'https?://[a-zA-Z0-9.-]+' | head -1 || true)"
if [[ -z "${PUBLIC}" ]]; then
  echo "Set PUBLIC_BASE_URL manually after domain is ready:"
  echo "  railway variables set PUBLIC_BASE_URL=https://YOUR-APP.up.railway.app"
else
  railway variables set PUBLIC_BASE_URL="$PUBLIC" || true
fi

echo
echo "Done."
echo "MCP_AUTH_TOKEN=$TOKEN"
echo "Health: curl -s https://YOUR-APP.up.railway.app/railway-health"
echo "SSE:    https://YOUR-APP.up.railway.app/sse"
echo "Logs:   railway logs"
