import { spawn, spawnSync } from "child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import type {
  RuntimeDebugAgent,
  RuntimeDebugAgentRequest,
  RuntimeDebugAgentResult,
  RuntimeDiagnostic,
} from "../../shared/runtime";
import { getConnectionConfig } from "../config";
import { getRuntimeDiagnostic } from "../hermes";
import { normalizeProfile } from "../hermes/runtime/profile";
import { getEnhancedPath } from "../install/paths";

const AGENT_COMMANDS: Record<
  RuntimeDebugAgent,
  { label: string; command: string }
> = {
  codex: { label: "Codex", command: "codex" },
  claude: { label: "Claude Code", command: "claude" },
  pi: { label: "Pi", command: "pi" },
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isRuntimeDebugAgent(value: unknown): value is RuntimeDebugAgent {
  return value === "codex" || value === "claude" || value === "pi";
}

function normalizeRequest(request: unknown): RuntimeDebugAgentRequest | null {
  if (!request || typeof request !== "object") return null;
  const candidate = request as { agent?: unknown; profile?: unknown };
  if (!isRuntimeDebugAgent(candidate.agent)) return null;
  const rawProfile =
    typeof candidate.profile === "string" ? candidate.profile : "";
  const profile = rawProfile ? normalizeProfile(rawProfile.slice(0, 128)) : "";
  return {
    agent: candidate.agent,
    ...(profile ? { profile } : {}),
  };
}

function truncate(value: string, maxLength = 12_000): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}\n…<truncated>`;
}

function safeJson(value: unknown): string {
  return truncate(JSON.stringify(value, null, 2));
}

function buildRuntimeDebugPrompt(
  request: RuntimeDebugAgentRequest,
  diagnostic: RuntimeDiagnostic,
): string {
  const connectionConfig = getConnectionConfig();
  const connection = safeJson({
    ...connectionConfig,
    apiKey: connectionConfig.apiKey ? "<redacted>" : "",
  });
  const profile =
    request.profile?.trim() || diagnostic.selectedProfile || "default";

  return `# Mercury Runtime Debug Request

You are debugging Mercury's local runtime identity / chat readiness state.

## Goal
Explain why chat runtime verification is not currently trusted for profile \`${profile}\`, then recommend concrete fix steps. Do not modify source code unless the user explicitly asks.

## Relevant Mercury docs / source paths
- docs/subsystems/connection-modes.md
- docs/subsystems/chat-and-tracing.md
- docs/investigations/runtime-warning-2026-05-19.md
- src/main/hermes/runtime/manager.ts
- src/main/hermes/runtime/identity.ts
- src/main/hermes/runtime/diagnostics.ts
- src/renderer/src/screens/Layout/Layout.tsx
- src/renderer/src/screens/Chat/Chat.tsx

## Current runtime diagnostic snapshot
\`\`\`json
${safeJson(diagnostic)}
\`\`\`

## Current connection config snapshot
\`\`\`json
${connection}
\`\`\`

## Suggested investigation steps
1. Check whether the selected profile has a running local gateway process and API port.
2. Check whether the runtime identity endpoint/API readiness can be reached.
3. Check whether the diagnostic is just idle preflight, stale, or a real profile mismatch.
4. Report exact commands or Mercury settings changes needed to fix the runtime.
`;
}

function writeUnixScript(
  scriptPath: string,
  promptPath: string,
  agent: RuntimeDebugAgent,
): void {
  const { label, command } = AGENT_COMMANDS[agent];
  const path = getEnhancedPath();
  const cwd = process.cwd();
  const script = `#!/usr/bin/env bash
set -u
export PATH=${shellQuote(path)}
cd ${shellQuote(cwd)}
clear
printf '%s\n' 'Mercury runtime diagnostics'
printf '%s\n' 'Agent: ${label}'
printf '%s\n' 'Prompt: ${promptPath}'
printf '\n'
if ! command -v ${shellQuote(command)} >/dev/null 2>&1; then
  printf '%s\n' 'Could not find ${command} on PATH.'
  printf '%s\n' 'The diagnostic prompt is below; copy it into your preferred agent:'
  printf '\n'
  cat ${shellQuote(promptPath)}
  printf '\n'
  read -r -p 'Press Return to close...'
  exit 1
fi
${shellQuote(command)} "$(cat ${shellQuote(promptPath)})"
status=$?
printf '\nAgent exited with status %s. Prompt file: %s\n' "$status" ${shellQuote(promptPath)}
read -r -p 'Press Return to close...'
`;
  writeFileSync(scriptPath, script, "utf-8");
  chmodSync(scriptPath, 0o755);
}

function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      HOME: homedir(),
    },
  });
  child.unref();
}

function commandExists(command: string): boolean {
  const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      HOME: homedir(),
    },
    stdio: "ignore",
  });
  return result.status === 0;
}

function buildWindowsCommand(
  promptPath: string,
  agent: RuntimeDebugAgent,
): string[] {
  const { label, command } = AGENT_COMMANDS[agent];
  const psCommand = [
    `$env:PATH = ${powershellQuote(getEnhancedPath())} + [IO.Path]::PathSeparator + $env:PATH`,
    `Set-Location -LiteralPath ${powershellQuote(process.cwd())}`,
    `Write-Host 'Mercury runtime diagnostics'`,
    `Write-Host 'Agent: ${label.replaceAll("'", "''")}'`,
    `Write-Host 'Prompt: ${promptPath.replaceAll("'", "''")}'`,
    `if (-not (Get-Command ${powershellQuote(command)} -ErrorAction SilentlyContinue)) { Write-Host 'Could not find ${command} on PATH.'; Get-Content -LiteralPath ${powershellQuote(promptPath)}; Read-Host 'Press Return to close'; exit 1 }`,
    `$prompt = Get-Content -Raw -LiteralPath ${powershellQuote(promptPath)}`,
    `& ${powershellQuote(command)} $prompt`,
    `Write-Host ''`,
    `Write-Host 'Agent exited. Prompt file: ${promptPath.replaceAll("'", "''")}'`,
    `Read-Host 'Press Return to close'`,
  ].join("; ");
  return [
    "powershell.exe",
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    psCommand,
  ];
}

function launchTerminal(
  promptPath: string,
  agent: RuntimeDebugAgent,
  scriptPath?: string,
): string[] {
  if (process.platform === "win32") {
    const command = buildWindowsCommand(promptPath, agent);
    spawnDetached(command[0], command.slice(1));
    return command;
  }

  if (!scriptPath) throw new Error("Runtime debug script was not created.");

  if (process.platform === "darwin") {
    const command = ["open", "-a", "Terminal", scriptPath];
    spawnDetached(command[0], command.slice(1));
    return command;
  }

  const terminalCandidates = [
    { command: "x-terminal-emulator", args: ["-e", scriptPath] },
    { command: "gnome-terminal", args: ["--", scriptPath] },
    { command: "konsole", args: ["-e", scriptPath] },
    { command: "xterm", args: ["-e", scriptPath] },
  ];
  const terminal = terminalCandidates.find((candidate) =>
    commandExists(candidate.command),
  );
  if (!terminal) {
    throw new Error(
      `No supported terminal emulator found. Prompt file: ${promptPath}`,
    );
  }
  spawnDetached(terminal.command, terminal.args);
  return [terminal.command, ...terminal.args];
}

export function launchRuntimeDebugAgent(
  request: unknown,
): RuntimeDebugAgentResult {
  const normalized = normalizeRequest(request);
  if (!normalized) {
    return {
      success: false,
      agent: "codex",
      error: "Invalid runtime debug agent request.",
    };
  }

  try {
    const diagnostic = getRuntimeDiagnostic(normalized.profile);
    const dir = mkdtempSync(join(tmpdir(), "mercury-runtime-debug-"));
    const promptPath = join(dir, "prompt.md");
    const scriptPath =
      process.platform === "win32" ? undefined : join(dir, "run.sh");
    writeFileSync(
      promptPath,
      buildRuntimeDebugPrompt(normalized, diagnostic),
      "utf-8",
    );

    if (scriptPath) writeUnixScript(scriptPath, promptPath, normalized.agent);

    const command = launchTerminal(promptPath, normalized.agent, scriptPath);
    return {
      success: true,
      agent: normalized.agent,
      command,
      promptPath,
      scriptPath,
    };
  } catch (err) {
    return {
      success: false,
      agent: normalized.agent,
      error: (err as Error).message,
    };
  }
}
