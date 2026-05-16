import { ChildProcess, spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { performance } from "perf_hooks";
import net from "net";
import http from "http";
import { recordPerfEvent, withPerfSpan } from "./perf/telemetry";

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  remotePort: number;
  localPort: number;
}

let tunnelProcess: ChildProcess | null = null;
let activeConfig: SshConfig | null = null;
let activeProfile = "default";
let activeTunnelKey = "";
let tunnelRunning = false;

function normalizeProfile(profile?: string): string {
  const trimmed = profile?.trim();
  return trimmed && trimmed !== "default" ? trimmed : "default";
}

export function buildSshTunnelIdentityKey(
  config: SshConfig,
  profile?: string,
): string {
  return [
    normalizeProfile(profile),
    config.host || "",
    config.username || "",
    String(config.port || 22),
    String(config.remotePort),
    String(config.localPort),
  ].join("|");
}

function matchesActiveTunnel(config?: SshConfig, profile?: string): boolean {
  if (!activeConfig || !activeTunnelKey) return false;
  if (!config) return true;
  return activeTunnelKey === buildSshTunnelIdentityKey(config, profile);
}

export function getSshTunnelUrl(profile?: string, config?: SshConfig): string | null {
  if (!activeConfig || !tunnelRunning) return null;
  const requestedProfile = normalizeProfile(profile);
  if (requestedProfile !== activeProfile) return null;
  if (config && !matchesActiveTunnel(config, requestedProfile)) return null;
  return `http://127.0.0.1:${activeConfig.localPort}`;
}

export function isSshTunnelActive(config?: SshConfig, profile?: string): boolean {
  return tunnelProcess !== null && tunnelRunning && matchesActiveTunnel(config, profile);
}

function checkTunnelHealth(port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      `http://127.0.0.1:${port}/health`,
      { method: "GET", timeout: timeoutMs },
      (res) => {
        const healthy = res.statusCode === 200;
        res.resume();
        resolve(healthy);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await checkTunnelHealth(port, 1500)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`SSH tunnel health check failed after ${timeoutMs}ms`);
}

export async function isSshTunnelHealthy(
  config?: SshConfig,
  profile?: string,
): Promise<boolean> {
  return activeConfig !== null && tunnelRunning && matchesActiveTunnel(config, profile)
    ? checkTunnelHealth(activeConfig.localPort)
    : false;
}

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(preferred, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      const fallback = net.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const port = (fallback.address() as net.AddressInfo).port;
        fallback.close(() => resolve(port));
      });
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt(): void {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`SSH tunnel not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 400);
        }
      });
    }
    attempt();
  });
}

function buildSshArgs(config: SshConfig, localPort: number): string[] {
  const keyPath = config.keyPath || join(homedir(), ".ssh", "id_rsa");
  return [
    "-N",
    "-L", `${localPort}:127.0.0.1:${config.remotePort}`,
    "-p", String(config.port),
    "-i", keyPath,
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "BatchMode=yes",
    "-o", "ControlMaster=auto",
    "-o", "ControlPath=~/.ssh/cm-hermes-%r@%h:%p",
    "-o", "ControlPersist=60s",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    `${config.username}@${config.host}`,
  ];
}

function sshTunnelMeta(config: SshConfig, localPort?: number, profile?: string): Record<string, unknown> {
  return {
    hostConfigured: Boolean(config.host?.trim()),
    usernameConfigured: Boolean(config.username?.trim()),
    hasKeyPath: Boolean(config.keyPath?.trim()),
    sshPort: config.port || 22,
    remotePort: config.remotePort,
    requestedLocalPort: config.localPort,
    localPort,
    profile: normalizeProfile(profile),
  };
}

export async function startSshTunnel(
  config: SshConfig,
  profile?: string,
): Promise<void> {
  await withPerfSpan("ssh", "ssh.tunnel.start", sshTunnelMeta(config, undefined, profile), async () => {
    if (isSshTunnelActive(config, profile) && (await isSshTunnelHealthy(config, profile))) return;
    stopSshTunnel();

    const localPort = await withPerfSpan(
      "ssh",
      "ssh.tunnel.find_free_port",
      sshTunnelMeta(config, undefined, profile),
      () => findFreePort(config.localPort || 18642),
    );
    activeConfig = { ...config, localPort };
    activeProfile = normalizeProfile(profile);
    activeTunnelKey = buildSshTunnelIdentityKey(config, profile);
    tunnelRunning = false;

    const spawnStart = performance.now();
    try {
      tunnelProcess = spawn("ssh", buildSshArgs(config, localPort), {
        stdio: "ignore",
        detached: false,
      });
    } catch (error) {
      recordPerfEvent({
        scope: "ssh",
        name: "ssh.tunnel.spawn",
        phase: "span",
        durationMs: performance.now() - spawnStart,
        ok: false,
        error: error instanceof Error ? error.name : "Error",
        meta: sshTunnelMeta(config, localPort, profile),
      });
      throw error;
    }

    tunnelProcess.on("exit", () => {
      tunnelRunning = false;
      tunnelProcess = null;
      activeConfig = null;
      activeTunnelKey = "";
      activeProfile = "default";
      recordPerfEvent({
        scope: "ssh",
        name: "ssh.tunnel.process_exit",
        phase: "mark",
        meta: sshTunnelMeta(config, localPort, profile),
      });
    });

    tunnelProcess.on("error", () => {
      tunnelRunning = false;
      tunnelProcess = null;
      activeConfig = null;
      activeTunnelKey = "";
      activeProfile = "default";
      recordPerfEvent({
        scope: "ssh",
        name: "ssh.tunnel.process_error",
        phase: "mark",
        ok: false,
        meta: sshTunnelMeta(config, localPort, profile),
      });
    });

    recordPerfEvent({
      scope: "ssh",
      name: "ssh.tunnel.spawn",
      phase: "span",
      durationMs: performance.now() - spawnStart,
      ok: true,
      meta: sshTunnelMeta(config, localPort),
    });

    try {
      await withPerfSpan(
        "ssh",
        "ssh.tunnel.wait_for_port",
        sshTunnelMeta(config, localPort, profile),
        () => waitForPort(localPort, 12000),
      );
      tunnelRunning = true;
      await withPerfSpan(
        "ssh",
        "ssh.tunnel.wait_for_health",
        sshTunnelMeta(config, localPort, profile),
        () => waitForHealth(localPort, 20000),
      );
    } catch (err) {
      stopSshTunnel();
      throw err;
    }
  });
}

export function stopSshTunnel(): void {
  const hadProcess = Boolean(tunnelProcess && !tunnelProcess.killed);
  const meta = activeConfig ? sshTunnelMeta(activeConfig, activeConfig.localPort) : { hadProcess };
  if (tunnelProcess && !tunnelProcess.killed) {
    tunnelProcess.kill("SIGTERM");
  }
  tunnelRunning = false;
  activeConfig = null;
  activeTunnelKey = "";
  activeProfile = "default";
  recordPerfEvent({
    scope: "ssh",
    name: "ssh.tunnel.stop",
    phase: "mark",
    meta: {
      ...meta,
      hadProcess,
    },
  });
}

export async function ensureSshTunnel(
  config: SshConfig,
  profile?: string,
): Promise<void> {
  if (isSshTunnelActive(config, profile) && await isSshTunnelHealthy(config, profile)) return;
  await startSshTunnel(config, profile);
}

// Test SSH reachability + hermes health endpoint through a temporary tunnel
export function testSshConnection(config: SshConfig): Promise<boolean> {
  return findFreePort(config.localPort || 19642)
    .then((localPort) => new Promise<boolean>((resolve) => {
      const args = buildSshArgs(config, localPort);
      const proc = spawn("ssh", args, { stdio: "ignore" });

      let done = false;
      const finish = (result: boolean): void => {
        if (done) return;
        done = true;
        proc.kill("SIGTERM");
        resolve(result);
      };

      proc.on("error", () => finish(false));

      const timeout = setTimeout(() => finish(false), 20000);

      // Poll until tunnel port is reachable, then hit /health
      const deadline = Date.now() + 15000;
      async function poll(): Promise<void> {
        if (done) return;
        const portOpen = await new Promise<boolean>((res) => {
          const s = net.connect(localPort, "127.0.0.1", () => { s.destroy(); res(true); });
          s.on("error", () => { s.destroy(); res(false); });
        });

        if (!portOpen) {
          if (Date.now() > deadline) { clearTimeout(timeout); finish(false); return; }
          setTimeout(poll, 400);
          return;
        }

        // Port is open — hit hermes /health
        const req = http.request(
          `http://127.0.0.1:${localPort}/health`,
          { method: "GET", timeout: 3000 },
          (res) => {
            clearTimeout(timeout);
            finish(res.statusCode === 200);
            res.resume();
          },
        );
        req.on("error", () => { clearTimeout(timeout); finish(false); });
        req.end();
      }

      setTimeout(poll, 600);
    }))
    .catch(() => false);
}
