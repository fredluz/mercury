import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { performance } from "perf_hooks";
import type { SshConfig } from "../ssh-tunnel";
import { recordPerfEvent } from "../perf/telemetry";

export type SshCommandKind =
  | "python-stdin"
  | "python-inline"
  | "read-file"
  | "write-file"
  | "file-exists"
  | "gateway-status"
  | "gateway-start"
  | "gateway-stop"
  | "hermes-version"
  | "hermes-doctor"
  | "hermes-update"
  | "hermes-dump"
  | "shell";

export function classifySshCommand(command: string): SshCommandKind {
  const normalized = command.trim();
  if (normalized === "python3 -") return "python-stdin";
  if (normalized.startsWith("python3 -c ")) return "python-inline";
  if (/\bcat -- \"\$p\"/.test(normalized)) return "read-file";
  if (/\bcat > \"\$file\"/.test(normalized)) return "write-file";
  if (/\btest -e \"\$file\"/.test(normalized)) return "file-exists";
  if (/gateway\.pid/.test(normalized) && /kill -0/.test(normalized)) return "gateway-status";
  if (/\bhermes gateway start\b/.test(normalized)) return "gateway-start";
  if (/\bhermes gateway stop\b/.test(normalized)) return "gateway-stop";
  if (/\bhermes (?:--version|version)\b/.test(normalized)) return "hermes-version";
  if (/\bhermes doctor\b/.test(normalized)) return "hermes-doctor";
  if (/\bhermes update\b/.test(normalized)) return "hermes-update";
  if (/\bhermes dump\b/.test(normalized)) return "hermes-dump";
  return "shell";
}

function sshExecMeta(
  config: SshConfig,
  command: string,
  stdin: string | undefined,
  timeoutMs: number,
): Record<string, unknown> {
  return {
    hostConfigured: Boolean(config.host?.trim()),
    usernameConfigured: Boolean(config.username?.trim()),
    sshPort: config.port || 22,
    hasKeyPath: Boolean(config.keyPath?.trim()),
    commandKind: classifySshCommand(command),
    commandLength: command.length,
    hasStdin: stdin !== undefined,
    stdinLength: stdin?.length,
    timeoutMs,
  };
}

function recordSshExecSpan(
  meta: Record<string, unknown>,
  durationMs: number,
  ok: boolean,
  error?: unknown,
): void {
  recordPerfEvent({
    scope: "ssh",
    name: "ssh.exec",
    phase: "span",
    durationMs,
    ok,
    error: error instanceof Error ? error.name : typeof error === "string" ? "Error" : undefined,
    meta,
  });
}

export function buildExecArgs(config: SshConfig): string[] {
  const keyPath = config.keyPath?.trim() || join(homedir(), ".ssh", "id_rsa");
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

export function sshExec(config: SshConfig, command: string, stdin?: string, timeoutMs = 30000): Promise<string> {
  const start = performance.now();
  const meta = sshExecMeta(config, command, stdin, timeoutMs);
  return new Promise((resolve, reject) => {
    let finished = false;
    const settle = (ok: boolean, value: string | Error): void => {
      if (finished) return;
      finished = true;
      recordSshExecSpan(meta, performance.now() - start, ok, ok ? undefined : value);
      if (ok) resolve(value as string);
      else reject(value);
    };

    const child = spawn("ssh", [...buildExecArgs(config), command], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      settle(false, new Error("SSH command timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => {
      clearTimeout(timeout);
      settle(false, err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) settle(true, stdout);
      else settle(false, new Error(sanitizeSshError(stderr) || "SSH command failed"));
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

export function sshPython(config: SshConfig, script: string, stdin?: string, timeoutMs = 30000): Promise<string> {
  if (stdin === undefined) {
    return sshExec(config, "python3 -", script, timeoutMs);
  }
  return sshExec(config, `python3 -c ${shellQuote(script)}`, stdin, timeoutMs);
}

export function sanitizeSshError(stderr: string): string {
  const cleaned = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Warning: Permanently added /.test(line))
    .filter((line) => !/identity file .* not accessible/i.test(line))
    .join("\n")
    .trim();
  if (/Permission denied \(publickey\)|no such identity|could not open a connection|publickey/i.test(cleaned)) {
    return "SSH authentication failed. Configure an SSH key for this host and try again.";
  }
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(cleaned)) {
    return "SSH host key verification failed. Check the host key before reconnecting.";
  }
  return cleaned;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function normalizeRemotePath(remotePath: string): string {
  return remotePath.replace(/^~\//, "$HOME/");
}

export function pythonJsonInput(payload: unknown): string {
  return JSON.stringify(payload);
}

export async function sshReadFile(config: SshConfig, remotePath: string): Promise<string> {
  try {
    return await sshExec(
      config,
      `bash -c 'case "$1" in "~/"*) p="$HOME/\${1#~/}" ;; "\\$HOME/"*) p="$HOME/\${1#\\$HOME/}" ;; *) p="$1" ;; esac; cat -- "$p" 2>/dev/null || true' -- ${shellQuote(normalizeRemotePath(remotePath))}`,
    );
  } catch {
    return "";
  }
}

export async function sshWriteFile(config: SshConfig, remotePath: string, content: string): Promise<void> {
  const p = normalizeRemotePath(remotePath);
  const dir = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : ".";
  await sshExec(
    config,
    `bash -c 'expand(){ case "$1" in "~/"*) printf "%s" "$HOME/\${1#~/}" ;; "\\$HOME/"*) printf "%s" "$HOME/\${1#\\$HOME/}" ;; *) printf "%s" "$1" ;; esac; }; dir=$(expand "$1"); file=$(expand "$2"); mkdir -p -- "$dir" && cat > "$file"' -- ${shellQuote(dir)} ${shellQuote(p)}`,
    content,
  );
}

export async function sshFileExists(config: SshConfig, remotePath: string): Promise<boolean> {
  try {
    const out = await sshExec(
      config,
      `bash -c 'expand(){ case "$1" in "~/"*) printf "%s" "$HOME/\${1#~/}" ;; "\\$HOME/"*) printf "%s" "$HOME/\${1#\\$HOME/}" ;; *) printf "%s" "$1" ;; esac; }; file=$(expand "$1"); test -e "$file" && printf yes || printf no' -- ${shellQuote(normalizeRemotePath(remotePath))}`,
    );
    return out.trim() === "yes";
  } catch {
    return false;
  }
}
