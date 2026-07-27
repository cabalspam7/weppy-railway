# Multi-User: Railway shared MCP + Studio di PC masing-masing

## Arsitektur

```
User A Studio + Plugin ──localhost:3002──► local-plugin-proxy ──HTTPS──┐
User B Studio + Plugin ──localhost:3002──► local-plugin-proxy ──HTTPS──┼──► Railway WEPPY
Notion Custom Agent ──────────────────────── /mcp (Streamable HTTP) ───┘
```

- **1 Railway** = shared brain (tools, dashboard, routing `studio-1` / `studio-2`)
- **Tiap user** cuma jalanin **proxy kecil** di PC + Roblox Studio + plugin WEPPY
- Plugin tetap default `127.0.0.1:3002` (paling kompatibel)

Public base:
```
https://weppy-mcp-production.up.railway.app
```

| Endpoint | Siapa |
|----------|--------|
| `/mcp` | Notion Custom Agents (Streamable HTTP) |
| `/sse` + `/message` | AI client SSE (Bearer token) |
| `/status` | cek `pluginClients` |
| `/dashboard` | lihat Studio targets |
| `/plugin/ws` | WebSocket plugin (via proxy) |

---

## Setup abang (owner Railway) — sekali

Notion Custom MCP URL:
```
https://weppy-mcp-production.up.railway.app/mcp
```

Kalau MCP auth ON, pakai header / query token dari env `MCP_AUTH_TOKEN`.

Dashboard:
```
https://weppy-mcp-production.up.railway.app/dashboard
```

---

## Setup tiap user (PC sendiri)

### Syarat
- Roblox Studio
- Node.js 20+
- Plugin WEPPY (`WeppyRobloxMCP`) — install sekali:
  ```powershell
  irm https://raw.githubusercontent.com/hope1026/weppy-roblox-mcp/main/install.ps1 | iex
  ```
  atau copy `WeppyRobloxMCP.rbxm` ke folder Plugins Roblox.

### 1) Jalanin local proxy (ganti localhost → Railway)

Di folder repo / mana aja yang ada `http-proxy`:

```powershell
# Windows PowerShell
cd path\to\weppy-railway
npm i http-proxy
$env:RAILWAY_URL="https://weppy-mcp-production.up.railway.app"
node local-plugin-proxy.mjs
```

Biarkan terminal ini **tetap nyala**.

### 2) Buka Studio
1. Buka Roblox Studio + place
2. Plugin WEPPY **enabled**
3. Host/Port plugin = **default** (`127.0.0.1` / `3002`) — **jangan** ganti ke Railway langsung kecuali lo yakin plugin support WSS

### 3) Cek connected
```powershell
curl http://127.0.0.1:3002/status
```

Harus ada `pluginClients` dengan `connectionState: "connected"` dan `targetAlias` misalnya `studio-1`.

Atau buka dashboard Railway → Connection → Studio Targets.

### 4) Notion
Reconnect Custom MCP (kalau perlu). Minta agent:
- "list connected studio clients"
- "gunakan studio-1 …" kalau multi Studio

---

## Alternatif tanpa proxy (plugin custom host)

Di UI plugin WEPPY (kalau ada field Host/Port):

| Field | Value |
|-------|--------|
| Server Host | `weppy-mcp-production.up.railway.app` |
| Server Port | `443` |

Hanya jalan kalau plugin build lo support **HTTPS + WSS**. Banyak build default `ws://` → gagal di 443. Kalau gagal, balik ke **local-plugin-proxy**.

---

## Multi Studio routing

| Alias | Arti |
|-------|------|
| `studio-1` | Studio pertama yang connect |
| `studio-2` | Kedua, dst |

Di Notion / agent sebut explicit:
> "Di studio-1 buat Part di Workspace. Di studio-2 ganti Lighting."

Dashboard → Connection → copy Studio ID.

---

## Troubleshooting

| Gejala | Cek |
|--------|-----|
| Notion ready, `pluginClients: []` | User belum jalanin proxy / Studio / plugin |
| Proxy error EADDRINUSE :3002 | Ada WEPPY lokal lain — matikan, cuma proxy yang denger di 3002 |
| Plugin disconnect | Proxy terminal ketutup / internet PC |
| Command ke Studio salah orang | Pakai `targetAlias` / `clientId` |
| Railway `/status` kosong | Plugin masih nempel WEPPY **lokal** (server mode), bukan proxy |

Cek shared state:
```bash
curl -s https://weppy-mcp-production.up.railway.app/status
```

---

## Jangan

1. Tiap user deploy Railway sendiri — pecah session
2. Notion → `localhost` / IP PC user — Notion cloud gak bisa
3. Jalanin full `npx @weppy/roblox-mcp` **server mode** di PC **dan** expect Notion Railway liat plugin itu — beda proses
4. Matikan proxy saat main Studio

---

## Ringkas buat dikasih user

```text
1. Install Node + plugin WEPPY
2. Jalankan:
   npm i http-proxy
   set RAILWAY_URL=https://weppy-mcp-production.up.railway.app
   node local-plugin-proxy.mjs
3. Buka Roblox Studio (plugin on)
4. Cek: curl http://127.0.0.1:3002/status  → pluginClients terisi
5. Notion tetap pakai:
   https://weppy-mcp-production.up.railway.app/mcp
```
