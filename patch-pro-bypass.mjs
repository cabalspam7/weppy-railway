#!/usr/bin/env node
/**
 * WEPPY Pro license bypass — surgical binary patch for @weppy/roblox-mcp dist/index.js
 *
 * Choke points:
 *  1. evaluateProAccess() always allowed
 *  2. getStatus() force canUsePro/active
 *  3. evaluateEffectiveState() short-circuit pro
 *  4. default iwe() license-state → active/pro
 *  5. TH() response normalizer default → active
 *  6. resetGateway cannot wipe pro
 *  7. canUsePro:!1 + unlicensed pairs → active
 *
 * Usage:
 *   node patch-pro-bypass.mjs [path/to/index.js]
 *   node patch-pro-bypass.mjs --restore
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TARGET = path.join(
  __dirname,
  "node_modules/@weppy/roblox-mcp/dist/index.js"
);

const args = process.argv.slice(2);
const restore = args.includes("--restore");
const target =
  args.find((a) => a !== "--restore" && !a.startsWith("-")) || DEFAULT_TARGET;
const bak = `${target}.bak-pro`;
const MARKER = "/*WEPPY_PRO_BYPASS_V1*/";

if (!fs.existsSync(target)) {
  console.error(`[patch] missing target: ${target}`);
  process.exit(1);
}

if (restore) {
  if (!fs.existsSync(bak)) {
    console.error(`[patch] no backup at ${bak}`);
    process.exit(1);
  }
  fs.copyFileSync(bak, target);
  console.log(`[patch] restored from ${bak}`);
  process.exit(0);
}

// Always patch from clean backup so re-runs stay idempotent
if (!fs.existsSync(bak)) {
  fs.copyFileSync(target, bak);
  console.log(`[patch] backup → ${bak}`);
}

let src = fs.readFileSync(bak, "utf8");
const stats = {};

function replaceAll(label, find, repl) {
  if (!src.includes(find)) {
    stats[label] = 0;
    return;
  }
  const parts = src.split(find);
  stats[label] = parts.length - 1;
  src = parts.join(repl);
}

// 1) evaluateProAccess always allow
replaceAll(
  "evaluateProAccess_nuclear",
  "async evaluateProAccess(){let e=this.getStatus();if(e.canUsePro)return{allowed:!0,state:e};",
  'async evaluateProAccess(){let e=this.getStatus();return{allowed:!0,state:{...e,canUsePro:!0,status:"active"}};if(e.canUsePro)return{allowed:!0,state:e};'
);

// 2) default unlicensed state → active pro
replaceAll(
  "default_iwe",
  'function iwe(){return{canUsePro:!1,status:"unlicensed",checkedAt:Math.floor(Date.now()/1e3),source:"cached"}}',
  'function iwe(){return{canUsePro:!0,status:"active",checkedAt:Math.floor(Date.now()/1e3),source:"cached",billingState:"ok",reason:"pro_bypass"}}'
);

// 3) evaluateEffectiveState force pro
replaceAll(
  "evaluateEffectiveState_force",
  'evaluateEffectiveState(e){let n=cwe(e),i=hi();if(n.status==="revoked"||n.status==="invalid"||n.status==="unlicensed")return{...n,canUsePro:!1};',
  'evaluateEffectiveState(e){let n=cwe(e),i=hi();return{...n,canUsePro:!0,status:"active"};if(n.status==="revoked"||n.status==="invalid"||n.status==="unlicensed")return{...n,canUsePro:!1};'
);

// 4) getStatus force pro overlay
replaceAll(
  "getStatus_force",
  'getStatus(e){let n=this.cache.getState(),i=this.evaluateEffectiveState(n),r=!!this.cache.getSessionToken();return this.client.isConfigured()&&r&&this.cache.getProvider()&&typeof n.nextRecheckAt=="number"&&hi()>=n.nextRecheckAt&&!this.refreshInFlight&&this.runScheduledRefresh(),this.toNormalizedState(i,e)}',
  'getStatus(e){let n=this.cache.getState(),i=this.evaluateEffectiveState(n),r=!!this.cache.getSessionToken();return this.client.isConfigured()&&r&&this.cache.getProvider()&&typeof n.nextRecheckAt=="number"&&hi()>=n.nextRecheckAt&&!this.refreshInFlight&&this.runScheduledRefresh(),{...this.toNormalizedState(i,e),canUsePro:!0,status:"active",billingState:"ok"}}'
);

// 5) TH() default
replaceAll(
  "TH_default_false",
  'function TH(t){let e={canUsePro:!1,status:"unlicensed",checkedAt:Math.floor(Date.now()/1e3),source:"cached"};',
  'function TH(t){let e={canUsePro:!0,status:"active",checkedAt:Math.floor(Date.now()/1e3),source:"cached"};'
);

// 6) resetGateway cannot wipe
replaceAll(
  "resetGateway",
  'async resetGateway(e){let n=this.getResponseProvider(e.provider),i={canUsePro:!1,status:"unlicensed",checkedAt:hi(),source:"offline_snapshot"};',
  'async resetGateway(e){let n=this.getResponseProvider(e.provider),i={canUsePro:!0,status:"active",checkedAt:hi(),source:"offline_snapshot",reason:"pro_bypass"};'
);

// 7) remaining unlicensed defaults
src = src.replace(/canUsePro:!1,status:"unlicensed"/g, () => {
  stats.canUsePro_unlicensed_pair = (stats.canUsePro_unlicensed_pair || 0) + 1;
  return 'canUsePro:!0,status:"active"';
});

if (!src.includes('return{allowed:!0,state:{...e,canUsePro:!0,status:"active"}}')) {
  console.error("[patch] nuclear evaluateProAccess patch failed — version mismatch?");
  process.exit(2);
}

// Marker must NOT precede the shebang — Node ESM treats #! only on line 1.
// Put marker right after shebang (or at top if no shebang).
src = src.replace(new RegExp(`^${MARKER.replace(/[/*]/g, "\\$&")}\n?`), "");
src = src.replace(new RegExp(`\n${MARKER.replace(/[/*]/g, "\\$&")}\n?`), "\n");
if (src.startsWith("#!")) {
  const nl = src.indexOf("\n");
  if (nl !== -1) {
    src = src.slice(0, nl + 1) + MARKER + "\n" + src.slice(nl + 1);
  } else {
    src = src + "\n" + MARKER + "\n";
  }
} else if (!src.startsWith(MARKER)) {
  src = `${MARKER}\n${src}`;
}

fs.writeFileSync(target, src, "utf8");
console.log("[patch] applied to", target);
console.log("[patch] stats:", JSON.stringify(stats, null, 2));
console.log(
  "[patch] remaining canUsePro:!1:",
  (src.match(/canUsePro:!1/g) || []).length
);
console.log("[patch] marker:", MARKER);
