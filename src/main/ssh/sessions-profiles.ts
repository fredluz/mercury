import type { SshConfig } from "../ssh-tunnel";
import type { SessionSummary, SessionMessage, SearchResult } from "../sessions";
import { pythonJsonInput, shellQuote, sshExec, sshPython } from "./transport";

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function sshListSessions(
  config: SshConfig,
  limit = 30,
  offset = 0,
  profile?: string,
): Promise<SessionSummary[]> {
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
limit = max(1, min(200, int(payload.get("limit") or 30)))
offset = max(0, int(payload.get("offset") or 0))
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT id, source, started_at, ended_at, message_count, model, title "
    "FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?",
    (limit, offset)
).fetchall()
result = []
for r in rows:
    result.append({
        "id": r["id"], "source": r["source"] or "cli",
        "startedAt": r["started_at"], "endedAt": r["ended_at"],
        "messageCount": r["message_count"] or 0, "model": r["model"] or "",
        "title": r["title"], "preview": ""
    })
print(json.dumps(result))
conn.close()
`;
  try {
    const out = await sshPython(config, script, pythonJsonInput({ profile, limit, offset }));
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

export async function sshGetSessionMessages(
  config: SshConfig,
  sessionId: string,
  profile?: string,
): Promise<SessionMessage[]> {
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
session_id = payload.get("sessionId") or ""
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT id, role, content, timestamp FROM messages WHERE session_id=? ORDER BY id ASC",
    (session_id,)
).fetchall()
print(json.dumps([{"id": r["id"], "role": r["role"], "content": r["content"] or "", "timestamp": r["timestamp"]} for r in rows]))
conn.close()
`;
  try {
    const out = await sshPython(config, script, pythonJsonInput({ profile, sessionId }));
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

export async function sshSearchSessions(
  config: SshConfig,
  query: string,
  limit = 20,
  profile?: string,
): Promise<SearchResult[]> {
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
query = payload.get("query") or ""
limit = max(1, min(200, int(payload.get("limit") or 20)))
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
try:
    rows = conn.execute(
        "SELECT DISTINCT s.id, s.title, s.started_at, s.source, s.message_count, s.model, m.content as snippet "
        "FROM sessions s JOIN messages m ON m.session_id = s.id "
        "WHERE m.content LIKE ? ORDER BY s.started_at DESC LIMIT ?",
        (f"%{query}%", limit)
    ).fetchall()
    print(json.dumps([{"sessionId": r["id"], "title": r["title"], "startedAt": r["started_at"], "source": r["source"] or "cli", "messageCount": r["message_count"] or 0, "model": r["model"] or "", "snippet": (r["snippet"] or "")[:200]} for r in rows]))
except Exception as e:
    print("[]")
conn.close()
`;
  try {
    const out = await sshPython(config, script, pythonJsonInput({ profile, query, limit }));
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export interface SshProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

export async function sshListProfiles(config: SshConfig): Promise<SshProfileInfo[]> {
  const script = `
import os, json
hermes_home = os.path.expanduser("~/.hermes")
profiles_dir = os.path.join(hermes_home, "profiles")
profiles = []

def read_config(path):
    model, provider = "", "auto"
    config_file = os.path.join(path, "config.yaml")
    if os.path.exists(config_file):
        content = open(config_file).read()
        import re
        m = re.search(r'^\\s*default:\\s*["\\'\\']?([^"\\'\\' \\n#]+)["\\'\\']?', content, re.M)
        if m: model = m.group(1).strip()
        p = re.search(r'^\\s*provider:\\s*["\\'\\']?([^"\\'\\' \\n#]+)["\\'\\']?', content, re.M)
        if p: provider = p.group(1).strip()
    return model, provider

def count_skills(path):
    skills_dir = os.path.join(path, "skills")
    count = 0
    if os.path.isdir(skills_dir):
        for cat in os.listdir(skills_dir):
            cat_path = os.path.join(skills_dir, cat)
            if os.path.isdir(cat_path):
                for name in os.listdir(cat_path):
                    if os.path.exists(os.path.join(cat_path, name, "SKILL.md")):
                        count += 1
    return count

def gw_running(path):
    pid_file = os.path.join(path, "gateway.pid")
    if not os.path.exists(pid_file): return False
    try:
        pid = int(open(pid_file).read().strip())
        os.kill(pid, 0)
        return True
    except:
        return False

# Default profile
model, provider = read_config(hermes_home)
profiles.append({
    "name": "default", "path": hermes_home, "isDefault": True, "isActive": True,
    "model": model, "provider": provider,
    "hasEnv": os.path.exists(os.path.join(hermes_home, ".env")),
    "hasSoul": os.path.exists(os.path.join(hermes_home, "SOUL.md")),
    "skillCount": count_skills(hermes_home),
    "gatewayRunning": gw_running(hermes_home)
})

if os.path.isdir(profiles_dir):
    for name in sorted(os.listdir(profiles_dir)):
        p = os.path.join(profiles_dir, name)
        if not os.path.isdir(p): continue
        model, provider = read_config(p)
        profiles.append({
            "name": name, "path": p, "isDefault": False, "isActive": False,
            "model": model, "provider": provider,
            "hasEnv": os.path.exists(os.path.join(p, ".env")),
            "hasSoul": os.path.exists(os.path.join(p, "SOUL.md")),
            "skillCount": count_skills(p),
            "gatewayRunning": gw_running(p)
        })

print(json.dumps(profiles))
`;
  try {
    const out = await sshPython(config, script);
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [{ name: "default", path: "~/.hermes", isDefault: true, isActive: true, model: "", provider: "auto", hasEnv: false, hasSoul: false, skillCount: 0, gatewayRunning: false }];
  }
}

export async function sshCreateProfile(
  config: SshConfig,
  name: string,
  clone: boolean,
): Promise<boolean> {
  try {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe) return false;
    const quoted = shellQuote(safe);
    if (clone) {
      await sshExec(config, `hermes profiles create ${quoted} --clone-from default 2>&1 || mkdir -p ~/.hermes/profiles/${quoted}`);
    } else {
      await sshExec(config, `hermes profiles create ${quoted} 2>&1 || mkdir -p ~/.hermes/profiles/${quoted}`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function sshDeleteProfile(config: SshConfig, name: string): Promise<boolean> {
  try {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe || safe === "default") return false;
    const quoted = shellQuote(safe);
    await sshExec(config, `hermes profiles delete ${quoted} --yes 2>&1 || rm -rf ~/.hermes/profiles/${quoted}`);
    return true;
  } catch {
    return false;
  }
}
