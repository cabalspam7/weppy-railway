#!/usr/bin/env node
/**
 * Zero-dep local Studio plugin proxy → Railway shared WEPPY
 * Node 18+ only (built-in http/https). No npm install required.
 *
 *   set RAILWAY_URL=https://weppy-mcp-production.up.railway.app
 *   node weppy-local-proxy.mjs
 */
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const TARGET = process.env.RAILWAY_URL || process.env.WEPPY_PUBLIC_URL || "https://weppy-mcp-production.up.railway.app";
const LISTEN_HOST = process.env.LISTEN_HOST || "127.0.0.1";
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "3002", 10);
const targetUrl = new URL(TARGET);
const isHttps = targetUrl.protocol === "https:";
const lib = isHttps ? https : http;
const remotePort = targetUrl.port || (isHttps ? 443 : 80);

function log(...a) { console.log("[plugin-proxy]", ...a); }

const server = http.createServer((req, res) => {
  const path = req.url || "/";
  const headers = { ...req.headers, host: targetUrl.host };
  delete headers["connection"]; // let agent manage
  const opts = {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: remotePort,
    path,
    method: req.method,
    headers,
  };
  const pReq = lib.request(opts, (pRes) => {
    res.writeHead(pRes.statusCode || 502, pRes.headers);
    pRes.pipe(res);
  });
  pReq.on("error", (err) => {
    log("http error", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "proxy_error", detail: err.message }));
    } else res.end();
  });
  req.pipe(pReq);
});

server.on("upgrade", (req, socket, head) => {
  const path = req.url || "/";
  const headers = { ...req.headers, host: targetUrl.host };
  const opts = {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: remotePort,
    path,
    method: "GET",
    headers,
  };
  const pReq = lib.request(opts);
  pReq.on("upgrade", (pRes, pSocket, pHead) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        Object.entries(pRes.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
          .join("\r\n") +
        "\r\n\r\n"
    );
    if (pHead?.length) socket.write(pHead);
    if (head?.length) pSocket.write(head);
    pSocket.pipe(socket);
    socket.pipe(pSocket);
    pSocket.on("error", () => socket.destroy());
    socket.on("error", () => pSocket.destroy());
  });
  pReq.on("error", (err) => {
    log("ws error", err.message);
    try {
      socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    } catch {}
    socket.destroy();
  });
  pReq.end();
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    log(`port ${LISTEN_PORT} in use — matikan WEPPY/server lain di :3002 dulu`);
  } else log("listen error", err.message);
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`listening http://${LISTEN_HOST}:${LISTEN_PORT}`);
  log(`→ ${TARGET}`);
  log("open Roblox Studio + WEPPY plugin (default host/port)");
  log(`check: curl http://${LISTEN_HOST}:${LISTEN_PORT}/status`);
});
