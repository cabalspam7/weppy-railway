FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    DASHBOARD_AUTO_OPEN=false \
    SKIP_PLUGIN_INSTALL=true \
    WEPPY_MCP_DETACHED_LIFECYCLE=true \
    HTTP_HOST=127.0.0.1 \
    HTTP_PORT=3002 \
    SUPERGATEWAY_PORT=8787 \
    LOG_LEVEL=info

# System deps (certs for outbound license/API calls)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json patch-pro-bypass.mjs ./
RUN npm install --omit=dev && node patch-pro-bypass.mjs

COPY start.mjs ./

# Railway injects PORT; our reverse proxy binds 0.0.0.0:$PORT
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8080}/railway-health" || exit 1

CMD ["node", "start.mjs"]
