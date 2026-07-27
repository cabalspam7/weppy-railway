#!/usr/bin/env node
/**
 * Railway entrypoint for WEPPY Roblox MCP
 *
 * Architecture (single public $PORT):
 *
 *   Internet ($PORT)
 *     ├─ /sse  /message  /mcp  /healthz  → supergateway (MCP SSE / Streamable HTTP)
 *     └─ /*                              → WEPPY HTTP bridge (plugin + dashboard)
 *
 *   supergateway --stdio → @weppy/roblox-mcp
 *     └─ WEPPY also binds HTTP bridge on 127.0.0.1:3002 (Studio plugin API)
 *
 * IMPORTANT:
 *   Roblox Studio plugin expects an HTTP bridge. Official default is
 *   http://127.0.0.1:3002 (localhost only). For remote Studio you MUST either:
 *     A) Run WEPPY on the same Windows/Mac machine as Studio (recommended), or
 *     B) Tunnel Railway → Studio machine (cloudflared/ngrok), or
 *     C) Point plugin custom host (if available) to this public URL.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import httpProxy from "http-proxy";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PUBLIC_PORT = parseInt(process.env.PORT || "8080", 10);
// Prefer WEPPY_HTTP_PORT, fall back to HTTP_PORT (WEPPY native env), default 3002
const WEPPY_HTTP_PORT = parseInt(
  process.env.WEPPY_HTTP_PORT || process.env.HTTP_PORT || "3002",
  10
);
const WEPPY_HTTP_HOST =
  process.env.WEPPY_HTTP_HOST || process.env.HTTP_HOST || "127.0.0.1";
const SUPERGATEWAY_PORT = parseInt(process.env.SUPERGATEWAY_PORT || "8787", 10);
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://127.0.0.1:${PUBLIC_PORT}`);

const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || ""; // optional bearer for /sse|/message|/mcp
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const children = [];

function log(...args) {
  console.log(`[weppy-railway]`, ...args);
}

// Auto-apply Pro license bypass before spawning WEPPY (idempotent)
function ensureProBypass() {
  if (process.env.WEPPY_PRO_BYPASS === "0" || process.env.WEPPY_PRO_BYPASS === "false") {
    log("pro bypass disabled via WEPPY_PRO_BYPASS");
    return;
  }
  const patcher = join(__dirname, "patch-pro-bypass.mjs");
  const target = join(
    __dirname,
    "node_modules/@weppy/roblox-mcp/dist/index.js"
  );
  if (!existsSync(patcher) || !existsSync(target)) {
    log("pro bypass skipped — patcher or target missing");
    return;
  }
  const r = spawnSync(process.execPath, [patcher, target], {
    encoding: "utf8",
    cwd: __dirname,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    log(`pro bypass patch exit=${r.status}`);
  } else {
    log("pro bypass applied/verified");
  }
}

ensureProBypass();

function spawnLogged(name, command, args, env = {}) {
  log(`start ${name}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  child.on("exit", (code, signal) => {
    log(`${name} exited code=${code} signal=${signal}`);
    // If core process dies, bring the container down so Railway restarts
    if (name === "supergateway" || name === "weppy-direct") {
      process.exit(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

function authOk(req) {
  if (!AUTH_TOKEN) return true;
  const h = req.headers["authorization"] || "";
  if (h === `Bearer ${AUTH_TOKEN}`) return true;
  const q = new URL(req.url, "http://x").searchParams.get("token");
  return q === AUTH_TOKEN;
}

function isMcpPath(pathname) {
  return (
    pathname === "/sse" ||
    pathname.startsWith("/sse/") ||
    pathname === "/message" ||
    pathname.startsWith("/message") ||
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/healthz" ||
    pathname === "/health"
  );
}

function requiresAuth(pathname) {
  // health endpoints stay public so Railway healthcheck + uptime monitors work
  if (pathname === "/healthz" || pathname === "/health" || pathname === "/railway-health") {
    return false;
  }
  return isMcpPath(pathname);
}

async function waitFor(url, tries = 60, delayMs = 500) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok || r.status < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

// Resolve weppy binary from node_modules
const weppyBin = join(
  __dirname,
  "node_modules",
  "@weppy",
  "roblox-mcp",
  "dist",
  "index.js"
);
const supergatewayBin = join(
  __dirname,
  "node_modules",
  "supergateway",
  "dist",
  "index.js"
);

// 1) Start WEPPY via supergateway (stdio MCP → SSE + Streamable HTTP)
//    WEPPY itself also opens HTTP bridge on WEPPY_HTTP_HOST:WEPPY_HTTP_PORT
const weppyStdioCmd = `node ${JSON.stringify(weppyBin)}`;

spawnLogged(
  "supergateway",
  process.execPath,
  [
    supergatewayBin,
    "--stdio",
    weppyStdioCmd,
    "--port",
    String(SUPERGATEWAY_PORT),
    "--baseUrl",
    PUBLIC_BASE_URL,
    "--ssePath",
    "/sse",
    "--messagePath",
    "/message",
    "--outputTransport",
    "sse",
    "--healthEndpoint",
    "/healthz",
    "--cors",
    "--logLevel",
    LOG_LEVEL === "debug" ? "debug" : "info",
  ],
  {
    // Force WEPPY HTTP bridge bind for Railway / remote plugin access
    HTTP_HOST: WEPPY_HTTP_HOST,
    HTTP_PORT: String(WEPPY_HTTP_PORT),
    // Don't try to open browser dashboard on a headless host
    DASHBOARD_AUTO_OPEN: "false",
    // Plugin install path is useless on Linux Railway (no Roblox Studio)
    SKIP_PLUGIN_INSTALL: "true",
    // Keep process alive even if stdin closes (Railway has no MCP parent stdin)
    WEPPY_MCP_DETACHED_LIFECYCLE: "true",
    LOG_LEVEL,
    NODE_ENV: "production",
  }
);

// Optional second Streamable HTTP endpoint (stateful) on another internal port
// Disabled by default — enable with ENABLE_STREAMABLE_HTTP=true
if (process.env.ENABLE_STREAMABLE_HTTP === "true") {
  const STREAM_PORT = parseInt(process.env.STREAMABLE_PORT || "8788", 10);
  spawnLogged(
    "supergateway-streamable",
    process.execPath,
    [
      supergatewayBin,
      "--stdio",
      weppyStdioCmd,
      "--port",
      String(STREAM_PORT),
      "--outputTransport",
      "streamableHttp",
      "--streamableHttpPath",
      "/mcp",
      "--stateful",
      "--sessionTimeout",
      "600000",
      "--healthEndpoint",
      "/healthz",
      "--cors",
    ],
    {
      HTTP_HOST: "127.0.0.1",
      HTTP_PORT: String(WEPPY_HTTP_PORT + 1),
      DASHBOARD_AUTO_OPEN: "false",
      SKIP_PLUGIN_INSTALL: "true",
      WEPPY_MCP_DETACHED_LIFECYCLE: "true",
      LOG_LEVEL,
    }
  );
}

// 2) Reverse proxy on public $PORT
const proxy = httpProxy.createProxyServer({
  ws: true,
  xfwd: true,
  changeOrigin: true,
});

proxy.on("error", (err, req, res) => {
  log("proxy error", err.message, req?.url);
  if (res && !res.headersSent && typeof res.writeHead === "function") {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "bad_gateway", detail: err.message }));
  }
});

// Fix CORS for remote dashboard / plugin browser tools
// + disable nginx proxy buffering for SSE (X-Accel-Buffering: no)
proxy.on("proxyRes", (proxyRes, req) => {
  proxyRes.headers["access-control-allow-origin"] = "*";
  proxyRes.headers["access-control-allow-methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  proxyRes.headers["access-control-allow-headers"] =
    "Content-Type, Authorization, X-Requested-With";
  const path = req?.url || "";
  if (path.startsWith("/sse") || path.startsWith("/mcp")) {
    proxyRes.headers["x-accel-buffering"] = "no";
    proxyRes.headers["cache-control"] = "no-cache, no-transform";
  }
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  // Root health / info
  if (pathname === "/" || pathname === "/railway-health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify(
        {
          ok: true,
          service: "weppy-railway",
          publicBaseUrl: PUBLIC_BASE_URL,
          endpoints: {
            mcp_sse: `${PUBLIC_BASE_URL}/sse`,
            mcp_message: `${PUBLIC_BASE_URL}/message`,
            healthz: `${PUBLIC_BASE_URL}/healthz`,
            weppy_status: `${PUBLIC_BASE_URL}/status`,
            dashboard: `${PUBLIC_BASE_URL}/dashboard`,
          },
          auth: AUTH_TOKEN ? "bearer_required_for_mcp" : "open",
          proBypass: process.env.WEPPY_PRO_BYPASS === "0" ? "disabled" : "enabled",
          notes: [
            "Studio plugin default is localhost:3002 — remote Studio needs tunnel or custom host.",
            "Set MCP_AUTH_TOKEN to protect /sse and /message.",
            "Pro license bypass auto-applied via patch-pro-bypass.mjs on start.",
          ],
        },
        null,
        2
      )
    );
    return;
  }

  if (isMcpPath(pathname)) {
    if (requiresAuth(pathname) && !authOk(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized", hint: "Bearer token or ?token=" }));
      return;
    }
    proxy.web(req, res, {
      target: `http://127.0.0.1:${SUPERGATEWAY_PORT}`,
    });
    return;
  }

  // Everything else → WEPPY HTTP bridge (plugin poll, dashboard, /status, etc.)
  proxy.web(req, res, {
    target: `http://${WEPPY_HTTP_HOST}:${WEPPY_HTTP_PORT}`,
  });
});

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url || "/", "http://x").pathname;
  if (isMcpPath(pathname)) {
    if (!authOk(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    proxy.ws(req, socket, head, {
      target: `http://127.0.0.1:${SUPERGATEWAY_PORT}`,
    });
  } else {
    proxy.ws(req, socket, head, {
      target: `http://${WEPPY_HTTP_HOST}:${WEPPY_HTTP_PORT}`,
    });
  }
});

server.listen(PUBLIC_PORT, "0.0.0.0", async () => {
  log(`public proxy listening on 0.0.0.0:${PUBLIC_PORT}`);
  log(`PUBLIC_BASE_URL=${PUBLIC_BASE_URL}`);
  log(`waiting for WEPPY HTTP bridge on ${WEPPY_HTTP_HOST}:${WEPPY_HTTP_PORT} ...`);

  const bridgeUp = await waitFor(
    `http://${WEPPY_HTTP_HOST}:${WEPPY_HTTP_PORT}/status`,
    90,
    500
  );
  const sgUp = await waitFor(`http://127.0.0.1:${SUPERGATEWAY_PORT}/healthz`, 90, 500);

  log(`WEPPY bridge: ${bridgeUp ? "UP" : "NOT YET / status may differ"}`);
  log(`supergateway: ${sgUp ? "UP" : "NOT YET"}`);
  log(`ready — MCP SSE: ${PUBLIC_BASE_URL}/sse`);
  log(`ready — dashboard/plugin: ${PUBLIC_BASE_URL}/dashboard (or /status)`);
});

function shutdown(signal) {
  log(`shutdown ${signal}`);
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
