#!/usr/bin/env node
/* eslint-disable no-console */

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(repoRoot, "prompt-exports", "perf-runs");

const EXIT_CODES = {
  PASS: 0,
  SKIPPED: 0,
  DEPENDENCY: 2,
  FAIL: 1,
};

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  }),
);

const explicitNumericOptions = {
  sshPort: args.has("ssh-port") || Boolean(process.env.MERCURY_SSH_PORT),
  remotePort: args.has("remote-port") || Boolean(process.env.MERCURY_SSH_REMOTE_PORT),
  localPort: args.has("local-port") || Boolean(process.env.MERCURY_SSH_LOCAL_PORT),
};

const options = {
  caseName: args.get("case") || "current-config",
  mode: args.get("mode") || "auto",
  samples: Math.max(1, Number(args.get("samples") || 1)),
  timeoutMs: Math.max(1000, Number(args.get("timeout-ms") || 15000)),
  query: args.get("query") || "latencyneedle",
  chatPrompt: args.get("chat-prompt") || "",
  remoteUrl: args.get("remote-url") || process.env.MERCURY_REMOTE_URL || "",
  apiKey: args.get("api-key") || process.env.MERCURY_REMOTE_API_KEY || "",
  sshHost: args.get("ssh-host") || process.env.MERCURY_SSH_HOST || "",
  sshUsername: args.get("ssh-user") || process.env.MERCURY_SSH_USER || "",
  sshKeyPath: args.get("ssh-key") || process.env.MERCURY_SSH_KEY || "",
  sshPort: Number(args.get("ssh-port") || process.env.MERCURY_SSH_PORT || 22),
  remotePort: Number(args.get("remote-port") || process.env.MERCURY_SSH_REMOTE_PORT || 8642),
  localPort: Number(args.get("local-port") || process.env.MERCURY_SSH_LOCAL_PORT || 18642),
  runId: args.get("run-id") || `ssh-remote-${new Date().toISOString().replace(/[:.]/g, "-")}`,
};

if (!["current-config", "explicit"].includes(options.caseName)) {
  console.error(`Unsupported --case=${options.caseName}; use current-config or explicit.`);
  process.exit(EXIT_CODES.FAIL);
}

if (!["auto", "remote", "ssh"].includes(options.mode)) {
  console.error(`Unsupported --mode=${options.mode}; use auto, remote, or ssh.`);
  process.exit(EXIT_CODES.FAIL);
}

function sha12(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function summarize(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((acc, value) => acc + value, 0);
  const mean = sum / samples.length;
  const variance = samples.reduce((acc, value) => acc + (value - mean) ** 2, 0) / samples.length;
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    max: sorted[sorted.length - 1],
    mean,
    stddev: Math.sqrt(variance),
  };
}

function hermesHome() {
  return process.env.HERMES_HOME?.trim() || path.join(os.homedir(), ".hermes");
}

function readCurrentConfig() {
  const desktopPath = path.join(hermesHome(), "desktop.json");
  try {
    if (!fs.existsSync(desktopPath)) return null;
    return JSON.parse(fs.readFileSync(desktopPath, "utf8"));
  } catch {
    return null;
  }
}

function currentConfigToRuntime() {
  if (options.caseName === "explicit") {
    return {
      mode: options.mode === "auto" ? (options.sshHost ? "ssh" : "remote") : options.mode,
      remoteUrl: options.remoteUrl,
      apiKey: options.apiKey,
      ssh: {
        host: options.sshHost,
        username: options.sshUsername,
        keyPath: options.sshKeyPath,
        port: Number.isFinite(options.sshPort) ? options.sshPort : 22,
        remotePort: Number.isFinite(options.remotePort) ? options.remotePort : 8642,
        localPort: Number.isFinite(options.localPort) ? options.localPort : 18642,
      },
    };
  }

  const config = readCurrentConfig();
  if (!config) return null;
  const ssh = config.sshConfig || {};
  return {
    mode: options.mode === "auto" ? config.connectionMode || "local" : options.mode,
    remoteUrl: options.remoteUrl || config.remoteUrl || "",
    apiKey: options.apiKey || config.remoteApiKey || "",
    ssh: {
      host: options.sshHost || ssh.host || "",
      username: options.sshUsername || ssh.username || "",
      keyPath: options.sshKeyPath || ssh.keyPath || "",
      port: explicitNumericOptions.sshPort ? options.sshPort : Number(ssh.port || 22),
      remotePort: explicitNumericOptions.remotePort ? options.remotePort : Number(ssh.remotePort || 8642),
      localPort: explicitNumericOptions.localPort ? options.localPort : Number(ssh.localPort || 18642),
    },
  };
}

function redactedUrlMeta(url) {
  if (!url) return { configured: false };
  try {
    const parsed = new URL(url);
    return {
      configured: true,
      protocol: parsed.protocol.replace(":", ""),
      hostHash: sha12(parsed.host),
      hasPath: parsed.pathname !== "/",
    };
  } catch {
    return { configured: true, invalid: true, length: url.length };
  }
}

function redactedSshMeta(config) {
  return {
    hostConfigured: Boolean(config?.host?.trim()),
    hostHash: config?.host ? sha12(config.host) : undefined,
    usernameConfigured: Boolean(config?.username?.trim()),
    hasKeyPath: Boolean(config?.keyPath?.trim()),
    sshPort: config?.port || 22,
    remotePort: config?.remotePort || 8642,
    requestedLocalPort: config?.localPort || 18642,
  };
}

function classifyDependencyError(message) {
  if (/timed out|timeout/i.test(message)) return "timeout";
  if (/permission denied|publickey|authentication|no such identity/i.test(message)) return "auth";
  if (/host key|identification has changed/i.test(message)) return "host-key";
  if (/could not resolve|name or service not known|nodename nor servname|connection refused|network/i.test(message)) {
    return "network";
  }
  return "external";
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    name: error instanceof Error ? error.name : "Error",
    category: classifyDependencyError(message),
  };
}

let diagFile = "";
function writeDiag(record) {
  if (!diagFile) return;
  fs.appendFileSync(diagFile, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, "utf8");
}

async function timed(name, meta, fn) {
  const start = performance.now();
  try {
    const value = await fn();
    const durationMs = performance.now() - start;
    const result = { name, status: "PASS", durationMs, meta, ok: true };
    writeDiag({ scope: "ssh", phase: "span", name, durationMs, ok: true, meta });
    return { result, value };
  } catch (error) {
    const durationMs = performance.now() - start;
    const safeError = sanitizeError(error);
    const result = {
      name,
      status: "DEPENDENCY",
      durationMs,
      meta,
      ok: false,
      error: safeError,
    };
    writeDiag({ scope: "ssh", phase: "span", name, durationMs, ok: false, error: safeError.name, meta });
    return { result, value: undefined };
  }
}

function httpRequest(url, { method = "GET", apiKey = "", body = undefined, timeoutMs = options.timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const mod = target.protocol === "https:" ? https : http;
    const headers = {};
    let payload;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = mod.request(target, { method, timeout: timeoutMs, headers }, (res) => {
      let bytes = 0;
      res.on("data", (chunk) => { bytes += chunk.length; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, bytes });
        } else {
          reject(new Error(`HTTP ${res.statusCode || 0}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("HTTP request timed out"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function checkSshBinary() {
  try {
    execFileSync("ssh", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function buildSshArgs(config) {
  const keyPath = config.keyPath?.trim() || path.join(os.homedir(), ".ssh", "id_rsa");
  return [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-o", "ControlMaster=auto",
    "-o", "ControlPath=~/.ssh/cm-hermes-%r@%h:%p",
    "-o", "ControlPersist=60s",
    "-i", keyPath,
    "-p", String(config.port || 22),
    `${config.username}@${config.host}`,
  ];
}

function sshExec(config, command, stdin, timeoutMs = options.timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...buildSshArgs(config), command], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (ok) resolve(value);
      else reject(value);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      settle(false, new Error("SSH command timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => settle(false, error));
    child.on("close", (code) => {
      if (code === 0) settle(true, stdout);
      else settle(false, new Error(stderr.trim() || "SSH command failed"));
    });
    child.stdin.end(stdin ?? undefined);
  });
}

function connectPort(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.connect(port, "127.0.0.1", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
  });
}

async function findFreePort(preferred) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(preferred, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      const fallback = net.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await connectPort(port, 1000)) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("SSH tunnel port timed out");
}

async function startTunnelAndHealth(config) {
  const localPort = await findFreePort(config.localPort || 18642);
  const child = spawn(
    "ssh",
    [
      "-N",
      "-L", `${localPort}:127.0.0.1:${config.remotePort || 8642}`,
      "-p", String(config.port || 22),
      "-i", config.keyPath?.trim() || path.join(os.homedir(), ".ssh", "id_rsa"),
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "BatchMode=yes",
      "-o", "ControlMaster=auto",
      "-o", "ControlPath=~/.ssh/cm-hermes-%r@%h:%p",
      "-o", "ControlPersist=60s",
      "-o", "ExitOnForwardFailure=yes",
      `${config.username}@${config.host}`,
    ],
    { stdio: "ignore" },
  );
  try {
    await waitForPort(localPort, Math.min(options.timeoutMs, 12000));
    await httpRequest(`http://127.0.0.1:${localPort}/health`, { timeoutMs: Math.min(options.timeoutMs, 5000) });
    return { localPort };
  } finally {
    child.kill("SIGTERM");
  }
}

async function runRemote(runtime) {
  const operations = [];
  if (!runtime.remoteUrl) {
    return {
      status: "SKIPPED",
      reason: "No remote URL configured. Pass --remote-url or use a current remote config.",
      operations,
    };
  }

  const urlMeta = redactedUrlMeta(runtime.remoteUrl);
  for (let i = 0; i < options.samples; i += 1) {
    const { result } = await timed("remote.health", { ...urlMeta, sample: i }, () =>
      httpRequest(`${runtime.remoteUrl.replace(/\/+$/, "")}/health`, {
        apiKey: runtime.apiKey,
        timeoutMs: options.timeoutMs,
      }),
    );
    operations.push(result);
  }

  if (options.chatPrompt) {
    const body = {
      model: "benchmark-probe",
      messages: [{ role: "user", content: options.chatPrompt }],
      stream: false,
      max_tokens: 1,
    };
    const { result } = await timed(
      "remote.chat_probe",
      { ...urlMeta, promptLength: options.chatPrompt.length },
      () => httpRequest(`${runtime.remoteUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
        method: "POST",
        apiKey: runtime.apiKey,
        body,
        timeoutMs: Math.max(options.timeoutMs, 30000),
      }),
    );
    operations.push(result);
  }

  return { status: classifyOverall(operations), operations };
}

const PROFILE_COUNT_SCRIPT = `
import json, os
home = os.path.expanduser("~/.hermes")
profiles_dir = os.path.join(home, "profiles")
count = 1
if os.path.isdir(profiles_dir):
    count += len([name for name in os.listdir(profiles_dir) if not name.startswith(".") and os.path.isdir(os.path.join(profiles_dir, name))])
print(json.dumps({"profileCount": count}))
`;

const SESSION_COUNT_SCRIPT = `
import json, os, sqlite3
home = os.path.expanduser("~/.hermes")
dbs = [os.path.join(home, "state.db")]
profiles = os.path.join(home, "profiles")
if os.path.isdir(profiles):
    for name in os.listdir(profiles):
        db = os.path.join(profiles, name, "state.db")
        if os.path.exists(db): dbs.append(db)
count = 0
for db in dbs:
    if not os.path.exists(db): continue
    try:
        conn = sqlite3.connect(db)
        count += conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        conn.close()
    except Exception:
        pass
print(json.dumps({"sessionCount": count}))
`;

function searchSessionsScript(query) {
  return `
import json, os, sqlite3
query = ${JSON.stringify(query)}
home = os.path.expanduser("~/.hermes")
dbs = [os.path.join(home, "state.db")]
profiles = os.path.join(home, "profiles")
if os.path.isdir(profiles):
    for name in os.listdir(profiles):
        db = os.path.join(profiles, name, "state.db")
        if os.path.exists(db): dbs.append(db)
count = 0
for db in dbs:
    if not os.path.exists(db): continue
    try:
        conn = sqlite3.connect(db)
        count += conn.execute(
            "SELECT COUNT(DISTINCT s.id) FROM sessions s JOIN messages m ON m.session_id = s.id WHERE m.content LIKE ?",
            ("%" + query + "%",),
        ).fetchone()[0]
        conn.close()
    except Exception:
        pass
print(json.dumps({"matchCount": count}))
`;
}

async function runSsh(runtime) {
  const operations = [];
  const config = runtime.ssh;
  const sshMeta = redactedSshMeta(config);
  if (!config?.host || !config?.username) {
    return {
      status: "SKIPPED",
      reason: "No SSH host/user configured. Pass --ssh-host and --ssh-user or use a current SSH config.",
      operations,
    };
  }
  if (!checkSshBinary()) {
    return {
      status: "DEPENDENCY",
      reason: "ssh binary is not available on PATH.",
      operations,
    };
  }

  for (let i = 0; i < options.samples; i += 1) {
    const { result } = await timed("ssh.exec.ping", { ...sshMeta, commandKind: "shell", sample: i }, () =>
      sshExec(config, "printf mercury-ssh-ok", undefined, options.timeoutMs),
    );
    operations.push({ ...result, stdoutLength: undefined });
  }

  const gatewayCommand =
    `if [ -f $HOME/.hermes/gateway.pid ]; then ` +
    `pid=$(python3 -c "import json,sys; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d.get('pid',d) if isinstance(d,dict) else d)" 2>/dev/null || cat $HOME/.hermes/gateway.pid); ` +
    `kill -0 $pid 2>/dev/null && echo "running" || echo "stopped"; ` +
    `else echo "stopped"; fi`;
  operations.push((await timed("ssh.gateway_status", { ...sshMeta, commandKind: "gateway-status" }, () =>
    sshExec(config, gatewayCommand, undefined, options.timeoutMs),
  )).result);

  operations.push((await timed("ssh.list_profiles", { ...sshMeta, commandKind: "python-stdin" }, () =>
    sshExec(config, "python3 -", PROFILE_COUNT_SCRIPT, options.timeoutMs),
  )).result);

  operations.push((await timed("ssh.list_cached_sessions", { ...sshMeta, commandKind: "python-stdin" }, () =>
    sshExec(config, "python3 -", SESSION_COUNT_SCRIPT, options.timeoutMs),
  )).result);

  operations.push((await timed(
    "ssh.search_sessions",
    { ...sshMeta, commandKind: "python-stdin", queryLength: options.query.length, queryHash: sha12(options.query) },
    () => sshExec(config, "python3 -", searchSessionsScript(options.query), options.timeoutMs),
  )).result);

  operations.push((await timed("ssh.tunnel_health", sshMeta, () => startTunnelAndHealth(config))).result);

  return { status: classifyOverall(operations), operations };
}

function classifyOverall(operations) {
  if (operations.some((operation) => operation.status === "FAIL")) return "FAIL";
  if (operations.some((operation) => operation.status === "DEPENDENCY")) return "DEPENDENCY";
  if (operations.some((operation) => operation.status === "PASS")) return "PASS";
  return "SKIPPED";
}

function durationsByOperation(operations) {
  const byName = new Map();
  for (const operation of operations) {
    if (operation.status !== "PASS") continue;
    const list = byName.get(operation.name) || [];
    list.push(operation.durationMs);
    byName.set(operation.name, list);
  }
  return Object.fromEntries(
    Array.from(byName.entries()).map(([name, values]) => [name, summarize(values)]),
  );
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, `${options.runId}-ssh-remote.json`);
  diagFile = path.join(outputDir, `${options.runId}-ssh-remote.ndjson`);
  const runtime = currentConfigToRuntime();
  const base = {
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    caseName: options.caseName,
    requestedMode: options.mode,
    samples: options.samples,
    timeoutMs: options.timeoutMs,
    artifactPath,
    diagFile,
    secretHandling: "Artifacts redact hostnames, URLs, API keys, commands, stdout/stderr, prompts, and query text.",
  };

  let summary;
  try {
    if (!runtime || !["remote", "ssh"].includes(runtime.mode)) {
      summary = {
        ...base,
        mode: runtime?.mode || "unknown",
        status: "SKIPPED",
        reason: "Current config is not remote or SSH. Pass --case=explicit with --mode=remote/ssh to benchmark explicitly.",
        operations: [],
        stats: {},
      };
    } else if (runtime.mode === "remote") {
      const result = await runRemote(runtime);
      summary = {
        ...base,
        mode: "remote",
        target: redactedUrlMeta(runtime.remoteUrl),
        ...result,
        stats: durationsByOperation(result.operations),
      };
    } else {
      const result = await runSsh(runtime);
      summary = {
        ...base,
        mode: "ssh",
        target: redactedSshMeta(runtime.ssh),
        ...result,
        stats: durationsByOperation(result.operations),
      };
    }
  } catch (error) {
    summary = {
      ...base,
      mode: runtime?.mode || "unknown",
      status: "FAIL",
      reason: "Harness failure",
      error: sanitizeError(error),
      operations: [],
      stats: {},
    };
  }

  fs.writeFileSync(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`${summary.status} ${artifactPath}`);
  process.exit(EXIT_CODES[summary.status] ?? EXIT_CODES.FAIL);
}

main();
