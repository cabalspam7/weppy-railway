# WEPPY MCP — Public HTTPS Endpoints

**Base URL:** https://virlur.duckdns.org  
**Status:** LIVE (nginx TLS → :8080 → WEPPY)

## Endpoints

| Path | Auth | Fungsi |
|------|------|--------|
| https://virlur.duckdns.org/railway-health | no | Health + daftar endpoint |
| https://virlur.duckdns.org/healthz | no | OK probe |
| https://virlur.duckdns.org/status | no | WEPPY bridge status |
| https://virlur.duckdns.org/dashboard | no | Web dashboard |
| https://virlur.duckdns.org/sse | **Bearer** | MCP SSE (AI client) |
| https://virlur.duckdns.org/message | **Bearer** | MCP message POST |

## MCP Auth Token

```
4e30f630519b0b7eacc7854700fbe72d18bbebfc955f6ee7
```

Header:
```
Authorization: Bearer 4e30f630519b0b7eacc7854700fbe72d18bbebfc955f6ee7
```

## Connect AI client (Hermes / Claude / Cursor)

### Direct SSE URL
```json
{
  "mcpServers": {
    "weppy-roblox": {
      "url": "https://virlur.duckdns.org/sse",
      "headers": {
        "Authorization": "Bearer 4e30f630519b0b7eacc7854700fbe72d18bbebfc955f6ee7"
      }
    }
  }
}
```

### Stdio wrapper
```bash
npx -y supergateway \
  --sse "https://virlur.duckdns.org/sse" \
  --oauth2Bearer "4e30f630519b0b7eacc7854700fbe72d18bbebfc955f6ee7"
```

## Verify
```bash
curl -s https://virlur.duckdns.org/railway-health
curl -s https://virlur.duckdns.org/status
curl -sN -H "Authorization: Bearer 4e30f630519b0b7eacc7854700fbe72d18bbebfc955f6ee7" https://virlur.duckdns.org/sse
```

## Process control
```bash
# currently running as background node (session proc)
# restart:
pkill -f 'weppy-railway/start.mjs' || true
cd /home/rafacorps/weppy-railway && set -a && source .env && set +a && node start.mjs

# optional systemd user unit:
systemctl --user enable --now weppy-mcp
systemctl --user status weppy-mcp
```

Generated: 2026-07-27T15:28:12Z
