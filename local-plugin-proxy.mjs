#!/usr/bin/env node
/**
 * Local Studio plugin proxy → Railway shared WEPPY
 *
 * Why: Roblox WEPPY plugin defaults to http://127.0.0.1:3002 and often
 * hardcodes ws:// (no TLS). Railway is HTTPS-only. This proxy lets each
 * user keep plugin on localhost:3002 while traffic goes to the shared
 * Railway MCP that Notion also uses.
 *
 * Usage (on the PC that runs Roblox Studio):
 *   npm i http-proxy          # once, or use npx below
 *   RAILWAY_URL=https://weppy-mcp-production.up.railway.app node local-plugin-proxy.mjs
 *
 * One-liner (no clone):
 *   npx --yes node@20 -e "..."  (see MULTI_USER.md)
 *
 * Then open Roblox Studio + WEPPY plugin (default host/port).
 * Verify: curl http://127.0.0.1:3002/status
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let httpProxy;
try {
  httpProxy = require("http-proxy");
} catch {
  console.error(
    "[plugin-proxy] missing dependency: run `npm i http-proxy` in this folder"
  );
  process.exit(1);
}

const TARGET =
  process.env.RAILWAY_URL ||
  process.env.WEPPY_PUBLIC_URL ||
  "https://weppy-mcp-production.up.railway.app";
const LISTEN_HOST = process.env.LISTEN_HOST || "127.0.0.1";
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "3002", 10);

const proxy = httpProxy.createProxyServer({
  target: TARGET,
  changeOrigin: true,
  ws: true,
  secure: true,
  xfwd: true,
  // long-lived plugin websocket
  proxyTimeout: 0,
  timeout: 0,
});

proxy.on("error", (err, _req, res) => {
  console.error("[plugin-proxy] error:", err.message);
  if (res && !res.headersSent && typeof res.writeHead === "function") {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_error", detail: err.message }));
  } else if (res && typeof res.destroy === "function") {
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  }
});

const server = createServer((req, res) => {
  proxy.web(req, res);
});

server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[plugin-proxy] listening http://${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`[plugin-proxy] → ${TARGET}`);
  console.log(
    `[plugin-proxy] open Roblox Studio + WEPPY plugin (default localhost:3002)`
  );
  console.log(
    `[plugin-proxy] check: curl http://${LISTEN_HOST}:${LISTEN_PORT}/status`
  );
});
