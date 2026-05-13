import type { SshConfig } from "../ssh-tunnel";
import type { CachedSession } from "../session-cache";
import type { SavedModel } from "../models";
import type { MemoryProviderInfo } from "../installer";
import { shellQuote, sshExec, sshReadFile, sshWriteFile, sshPython } from "./transport";
import { remoteConfigPath, sshGetConfigValue, sshReadEnv } from "./config";
import { sshListSessions } from "./sessions-profiles";

// ── Gateway ───────────────────────────────────────────────────────────────────

export async function sshGatewayStatus(config: SshConfig): Promise<boolean> {
  try {
    const out = await sshExec(
      config,
      `if [ -f $HOME/.hermes/gateway.pid ]; then ` +
      `pid=$(python3 -c "import json,sys; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d.get('pid',d) if isinstance(d,dict) else d)" 2>/dev/null || cat $HOME/.hermes/gateway.pid); ` +
      `kill -0 $pid 2>/dev/null && echo "running" || echo "stopped"; ` +
      `else echo "stopped"; fi`,
    );
    return out.trim() === "running";
  } catch {
    return false;
  }
}

export async function sshStartGateway(config: SshConfig): Promise<void> {
  try {
    await sshExec(config, `nohup hermes gateway start > $HOME/.hermes/gateway.log 2>&1 &`);
  } catch {
    // best effort
  }
}

export async function sshStopGateway(config: SshConfig): Promise<void> {
  try {
    await sshExec(
      config,
      `hermes gateway stop 2>/dev/null || ` +
      `(if [ -f $HOME/.hermes/gateway.pid ]; then ` +
      `pid=$(python3 -c "import json; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d['pid'] if isinstance(d,dict) else d)" 2>/dev/null); ` +
      `[ -n "$pid" ] && kill $pid 2>/dev/null; fi); true`,
    );
  } catch {
    // best effort
  }
}

// ── Remote API key (for chat auth through SSH tunnel) ─────────────────────────

export async function sshReadRemoteApiKey(config: SshConfig): Promise<string> {
  try {
    const env = await sshReadEnv(config);
    return env["API_SERVER_KEY"] || "";
  } catch {
    return "";
  }
}

// ── Versions ──────────────────────────────────────────────────────────────────

export async function sshGetHermesVersion(config: SshConfig): Promise<string | null> {
  try {
    const out = await sshExec(config, `hermes --version 2>/dev/null || hermes version 2>/dev/null || echo ""`);
    return out.trim() || null;
  } catch {
    return null;
  }
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export async function sshReadLogs(
  config: SshConfig,
  logFile?: string,
  lines = 300,
): Promise<{ content: string; path: string }> {
  const allowed = ["agent.log", "errors.log", "gateway.log"];
  const file = logFile && allowed.includes(logFile) ? logFile : "agent.log";
  const remotePath = `$HOME/.hermes/logs/${file}`;
  try {
    const safeLines = Math.max(1, Math.min(5000, Number.parseInt(String(lines), 10) || 300));
    const content = await sshExec(
      config,
      `bash -c 'case "$2" in "~/"*) p="$HOME/\${2#~/}" ;; "\\$HOME/"*) p="$HOME/\${2#\\$HOME/}" ;; *) p="$2" ;; esac; tail -n "$1" -- "$p" 2>/dev/null || echo ""' -- ${shellQuote(String(safeLines))} ${shellQuote(remotePath)}`,
    );
    return { content: content.trim(), path: `~/.hermes/logs/${file}` };
  } catch {
    return { content: "", path: `~/.hermes/logs/${file}` };
  }
}

// ── Platform toggles (Gateway page) ──────────────────────────────────────────

const SSH_SUPPORTED_PLATFORMS = [
  "telegram", "discord", "slack", "whatsapp", "signal",
  "matrix", "mattermost", "email", "sms", "bluebubbles",
  "dingtalk", "feishu", "wecom", "weixin", "webhooks", "home_assistant",
];

// Map from app platform keys to gateway_state.json keys (where they differ)
const PLATFORM_STATE_KEY: Record<string, string> = {
  home_assistant: "homeassistant",
};

export async function sshGetPlatformEnabled(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, boolean>> {
  void profile;
  try {
    const raw = await sshReadFile(config, "$HOME/.hermes/gateway_state.json");
    if (raw.trim()) {
      const state = JSON.parse(raw);
      const platforms = state.platforms || {};
      const result: Record<string, boolean> = {};
      for (const platform of SSH_SUPPORTED_PLATFORMS) {
        const stateKey = PLATFORM_STATE_KEY[platform] || platform;
        const p = platforms[stateKey];
        result[platform] = p ? p.state === "connected" || p.state === "running" : false;
      }
      return result;
    }
  } catch {
    // fall through
  }
  return Object.fromEntries(SSH_SUPPORTED_PLATFORMS.map((p) => [p, false]));
}

export async function sshSetPlatformEnabled(
  config: SshConfig,
  platform: string,
  enabled: boolean,
  profile?: string,
): Promise<void> {
  if (!SSH_SUPPORTED_PLATFORMS.includes(platform)) return;
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;

  let updated = content;
  const existingRe = new RegExp(
    `^([ \\t]+${platform}:\\s*\\n[ \\t]+enabled:\\s*)(?:true|false)`,
    "m",
  );

  if (existingRe.test(updated)) {
    updated = updated.replace(existingRe, `$1${enabled}`);
  } else {
    const platformsIdx = updated.indexOf("\nplatforms:");
    if (platformsIdx === -1) {
      updated += `\nplatforms:\n  ${platform}:\n    enabled: ${enabled}\n`;
    } else {
      const after = updated.substring(platformsIdx + 1);
      const lines = after.split("\n");
      let insertOffset = platformsIdx + 1 + lines[0].length + 1;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "" || /^\s/.test(lines[i])) insertOffset += lines[i].length + 1;
        else break;
      }
      const entry = `  ${platform}:\n    enabled: ${enabled}\n`;
      updated = updated.substring(0, insertOffset) + entry + updated.substring(insertOffset);
    }
  }

  await sshWriteFile(config, configPath, updated);
}

// ── Cached sessions (Sessions screen uses listCachedSessions) ─────────────────

export async function sshListCachedSessions(
  config: SshConfig,
  limit = 50,
  offset = 0,
): Promise<CachedSession[]> {
  void offset;
  const sessions = await sshListSessions(config, limit, 0);
  return sessions.map((s) => ({
    id: s.id,
    title: s.title || s.id,
    startedAt: s.startedAt,
    source: s.source,
    messageCount: s.messageCount,
    model: s.model,
  }));
}

// ── Doctor / diagnostics ──────────────────────────────────────────────────────

export async function sshRunDoctor(config: SshConfig): Promise<string> {
  try {
    const out = await sshExec(config, `hermes doctor 2>&1 || echo "hermes not found in PATH"`);
    return out.trim() || "No output from doctor.";
  } catch (err) {
    return `SSH doctor failed: ${(err as Error).message}`;
  }
}

export async function sshRunUpdate(config: SshConfig): Promise<void> {
  await sshExec(config, "hermes update 2>&1", undefined, 120000);
}

export async function sshRunDump(config: SshConfig): Promise<string> {
  try {
    const out = await sshExec(config, "hermes dump 2>&1", undefined, 60000);
    return out.trim() || "No output from dump.";
  } catch (err) {
    return `SSH dump failed: ${(err as Error).message}`;
  }
}

export async function sshDiscoverMemoryProviders(
  config: SshConfig,
  profile?: string,
): Promise<MemoryProviderInfo[]> {
  const activeProvider = (await sshGetConfigValue(config, "memory.provider", profile)) || "";
  const script = `
import json, os
known = {
    "honcho": {"description": "memory.providers.honcho", "envVars": ["HONCHO_API_KEY"]},
    "hindsight": {"description": "memory.providers.hindsight", "envVars": ["HINDSIGHT_API_KEY", "HINDSIGHT_API_URL", "HINDSIGHT_BANK_ID"]},
    "mem0": {"description": "memory.providers.mem0", "envVars": ["MEM0_API_KEY"]},
    "retaindb": {"description": "memory.providers.retaindb", "envVars": ["RETAINDB_API_KEY"]},
    "supermemory": {"description": "memory.providers.supermemory", "envVars": ["SUPERMEMORY_API_KEY"]},
    "holographic": {"description": "memory.providers.holographic", "envVars": []},
    "openviking": {"description": "memory.providers.openviking", "envVars": ["OPENVIKING_ENDPOINT", "OPENVIKING_API_KEY"]},
    "byterover": {"description": "memory.providers.byterover", "envVars": ["BRV_API_KEY"]},
}
roots = [
    os.path.expanduser("~/.hermes/plugins/memory"),
    os.path.expanduser("~/hermes/plugins/memory"),
    os.path.expanduser("~/hermes-agent/plugins/memory"),
]
names = set(known)
for root in roots:
    if os.path.isdir(root):
        for name in os.listdir(root):
            if not name.startswith("_") and os.path.isdir(os.path.join(root, name)):
                names.add(name)
result = []
for name in sorted(names):
    meta = known.get(name, {"description": f"memory.providers.{name}", "envVars": []})
    result.append({
        "name": name,
        "description": meta["description"],
        "envVars": meta["envVars"],
        "installed": True,
        "active": name == ${JSON.stringify(activeProvider)},
    })
print(json.dumps(result))
`;
  try {
    const out = await sshPython(config, script);
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

// ── Models library ─────────────────────────────────────────────────────────────

export async function sshListModels(config: SshConfig): Promise<SavedModel[]> {
  try {
    const raw = await sshReadFile(config, "$HOME/.hermes/models.json");
    if (raw.trim()) return JSON.parse(raw);
  } catch {
    // no models.json on remote yet
  }
  return [];
}

export async function sshSaveModels(config: SshConfig, models: SavedModel[]): Promise<void> {
  await sshWriteFile(config, "$HOME/.hermes/models.json", JSON.stringify(models, null, 2));
}
