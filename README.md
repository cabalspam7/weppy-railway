# WEPPY Roblox MCP — Railway Host

Deploy **@weppy/roblox-mcp** ke Railway supaya AI agent (Hermes/Claude/Cursor) bisa connect via **SSE**, dan Studio plugin bisa hit **HTTP bridge** lewat reverse proxy 1 port.

## Arsitektur

```
                    ┌─────────────────────────────────────────┐
                    │              Railway ($PORT)            │
 Internet ─────────►│  reverse proxy (start.mjs)              │
                    │                                         │
                    │  /sse /message /healthz ──► supergateway│
                    │         │                               │
                    │         └─stdio─► @weppy/roblox-mcp     │
                    │                      │                  │
                    │  /* (dashboard,      │                  │
                    │   /status, plugin) ──┘ HTTP :3002       │
                    └─────────────────────────────────────────┘
```

| Endpoint | Fungsi |
|----------|--------|
| `GET /` atau `/railway-health` | Health + daftar endpoint |
| `GET /sse` + `POST /message` | MCP transport (AI client) |
| `GET /status` | Status WEPPY bridge |
| `GET /dashboard` | WEPPY web dashboard |
| `/*` | Plugin HTTP API (poll commands, dll) |

## Batasan KRITIS (baca dulu)

WEPPY **dirancang localhost**:

1. **MCP transport** default = **stdio** (AI app spawn process lokal).
2. **HTTP bridge** default = `127.0.0.1:3002` (Studio plugin di mesin yang sama).
3. Official README: *"The server runs on localhost only (127.0.0.1:3002)."*

Jadi **Railway saja TIDAK cukup** biar AI remote + Studio remote jalan 100% out-of-the-box.

### Setup yang realistis

| Skenario | Cara |
|----------|------|
| **A. Recommended** | WEPPY jalan di **Windows VPS / PC** yang ada Roblox Studio. AI (Hermes di Linux) connect lewat tunnel SSE. |
| **B. Full Railway** | Deploy ini ke Railway. Studio di Windows connect plugin ke URL Railway (custom host / hosts-file hack / reverse tunnel). |
| **C. Hybrid** | Studio + WEPPY lokal di Windows. Expose cuma MCP SSE ke internet via cloudflared/ngrok. |

## Deploy ke Railway

### 1. Login CLI

```bash
railway login
# atau non-interactive:
railway login --browserless
# paste token dari https://railway.app/account/tokens
```

### 2. Init + deploy dari folder ini

```bash
cd /home/rafacorps/weppy-railway
railway init          # create project "weppy-mcp"
railway up            # build + deploy
railway domain        # generate public URL
```

### 3. Env vars (Railway dashboard atau CLI)

```bash
railway variables set MCP_AUTH_TOKEN="$(openssl rand -hex 24)"
railway variables set LOG_LEVEL=info
railway variables set DASHBOARD_AUTO_OPEN=false
railway variables set SKIP_PLUGIN_INSTALL=true
railway variables set WEPPY_MCP_DETACHED_LIFECYCLE=true
# setelah domain ada:
railway variables set PUBLIC_BASE_URL="https://YOUR-APP.up.railway.app"
```

### 4. Cek health

```bash
curl -s https://YOUR-APP.up.railway.app/railway-health | jq
curl -s https://YOUR-APP.up.railway.app/status
curl -s https://YOUR-APP.up.railway.app/healthz
```

## Connect AI client (Hermes / Claude / Cursor)

### SSE (supergateway style)

```json
{
  "mcpServers": {
    "weppy-roblox": {
      "url": "https://YOUR-APP.up.railway.app/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

### Via lokal stdio wrapper (kalau client cuma support stdio)

```bash
npx -y supergateway \
  --sse "https://YOUR-APP.up.railway.app/sse" \
  --oauth2Bearer "YOUR_MCP_AUTH_TOKEN"
```

Config MCP:

```json
{
  "mcpServers": {
    "weppy-roblox": {
      "command": "npx",
      "args": [
        "-y", "supergateway",
        "--sse", "https://YOUR-APP.up.railway.app/sse",
        "--oauth2Bearer", "YOUR_MCP_AUTH_TOKEN"
      ]
    }
  }
}
```

## Connect Roblox Studio plugin

Plugin default hit `http://127.0.0.1:3002`. Opsi:

### Opsi 1 — reverse tunnel di mesin Studio (paling clean)

Di Windows (Studio machine):

```powershell
# cloudflared tunnel ke Railway bridge path, ATAU
# jalankan WEPPY lokal (recommended):
npx -y @weppy/roblox-mcp@latest
```

Kalau WEPPY lokal, AI remote connect via:

```bash
# di Windows expose port 3002 + stdio via cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```

### Opsi 2 — plugin ke public Railway URL

Kalau plugin punya field **Server Host / Custom URL** di settings:

```
https://YOUR-APP.up.railway.app
```

Kalau **tidak ada** custom host (banyak build hardcode localhost):

```powershell
# Windows hosts + local reverse proxy (Caddy/nginx) ke Railway
# atau SSH reverse tunnel:
ssh -R 3002:YOUR-APP.up.railway.app:443 user@studio-machine
```

Lebih gampang: **jalanin WEPPY di mesin Studio**, Railway cuma buat AI SSE gateway yang proxy ke situ (client-mode) — butuh arsitektur 2-node.

### Opsi 3 — WEPPY di Windows VPS (paling stabil buat Valgorant)

```
[Roblox Studio + Plugin]  ←localhost:3002→  [WEPPY di Windows VPS]
                                                    ↑ stdio
                                            [supergateway :8787]
                                                    ↑
                                            [cloudflared / ngrok]
                                                    ↑
                                            [Hermes di Linux VPS]
```

Script Windows (PowerShell):

```powershell
# install
npm i -g @weppy/roblox-mcp supergateway

# terminal 1 — expose MCP as SSE
npx supergateway `
  --stdio "npx -y @weppy/roblox-mcp@latest" `
  --port 8787 `
  --baseUrl http://127.0.0.1:8787 `
  --ssePath /sse --messagePath /message --cors

# terminal 2 — public tunnel
cloudflared tunnel --url http://127.0.0.1:8787
```

Lalu di Hermes pakai URL cloudflared `/sse`.

## File di repo ini

| File | Fungsi |
|------|--------|
| `start.mjs` | Reverse proxy + spawn supergateway+WEPPY |
| `Dockerfile` | Image Node 20 |
| `railway.toml` / `railway.json` | Config Railway |
| `package.json` | deps: weppy + supergateway + http-proxy |
| `.env.example` | Contoh env |

## Local test (sebelum deploy)

```bash
cd /home/rafacorps/weppy-railway
npm install
PORT=8080 MCP_AUTH_TOKEN=test node start.mjs
# other terminal:
curl -s http://127.0.0.1:8080/railway-health
curl -s http://127.0.0.1:8080/status
curl -s http://127.0.0.1:8080/healthz
```

## Troubleshooting

| Gejala | Fix |
|--------|-----|
| Container crash loop | Cek logs: `railway logs`. Pastikan `WEPPY_MCP_DETACHED_LIFECYCLE=true` |
| `/sse` 502 | Supergateway belum ready — tunggu 30–60s cold start |
| Plugin "Disconnected" | Plugin masih ke localhost. Pakai opsi Studio di atas |
| Dashboard blank | Buka `/dashboard` lewat public URL; hard refresh |
| 401 on /sse | Kirim `Authorization: Bearer $MCP_AUTH_TOKEN` |
| License / Pro tools fail | Normal di Basic; Pro key diaktifkan lewat plugin UI |

## Ringkas rekomendasi buat lu (Valgorant + Hermes)

1. **Roblox Studio** → Windows VPS `104.207.93.128` (atau PC lu)
2. **WEPPY + plugin** → install di mesin yang sama dengan Studio
3. **Expose MCP SSE** → cloudflared/ngrok dari Windows
4. **Hermes (Linux)** → connect ke URL tunnel `/sse`
5. **Railway** (opsional) → ganti cloudflared biar URL stabil + auth token

Railway bagus buat **URL stabil + auth**, tapi **Studio harus tetap “dekat” dengan HTTP bridge WEPPY**.
