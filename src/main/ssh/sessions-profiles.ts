import type { SshConfig } from "../ssh-tunnel";
import type { SessionSummary, SessionMessage, SearchResult } from "../sessions";
import { isValidProfileName } from "../../shared/profile-identity";
import type { ProfileAgentMetadata, ProfileInfo } from "../../shared/profiles";
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
hermes_home = os.path.expanduser("~/.hermes")
def scopes():
    if profile:
        name = "default" if profile == "default" else profile
        home = hermes_home if name == "default" else os.path.join(hermes_home, "profiles", name)
        return [(name, os.path.join(home, "state.db"))]
    result = [("default", os.path.join(hermes_home, "state.db"))]
    profiles_dir = os.path.join(hermes_home, "profiles")
    if os.path.isdir(profiles_dir):
        for name in sorted(os.listdir(profiles_dir)):
            if name.startswith("."): continue
            home = os.path.join(profiles_dir, name)
            if os.path.isdir(home): result.append((name, os.path.join(home, "state.db")))
    return result
result = []
for profile_name, db in scopes():
    if not os.path.exists(db): continue
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, source, started_at, ended_at, message_count, model, title "
        "FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?",
        (limit + offset, 0)
    ).fetchall()
    for r in rows:
        result.append({
            "id": r["id"], "source": r["source"] or "cli",
            "startedAt": r["started_at"], "endedAt": r["ended_at"],
            "messageCount": r["message_count"] or 0, "model": r["model"] or "",
            "title": r["title"], "preview": "", "profile": profile_name
        })
    conn.close()
result.sort(key=lambda r: r["startedAt"] or 0, reverse=True)
print(json.dumps(result[offset:offset + limit]))
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, limit, offset }),
    );
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
hermes_home = os.path.expanduser("~/.hermes")
def scopes():
    if profile:
        name = "default" if profile == "default" else profile
        home = hermes_home if name == "default" else os.path.join(hermes_home, "profiles", name)
        return [(name, os.path.join(home, "state.db"))]
    result = [("default", os.path.join(hermes_home, "state.db"))]
    profiles_dir = os.path.join(hermes_home, "profiles")
    if os.path.isdir(profiles_dir):
        for name in sorted(os.listdir(profiles_dir)):
            if name.startswith("."): continue
            home = os.path.join(profiles_dir, name)
            if os.path.isdir(home): result.append((name, os.path.join(home, "state.db")))
    return result
for _profile_name, db in scopes():
    if not os.path.exists(db): continue
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    found = conn.execute("SELECT id FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not found:
        conn.close(); continue
    rows = conn.execute(
        "SELECT id, role, content, timestamp FROM messages WHERE session_id=? AND role IN ('user', 'assistant') AND content IS NOT NULL ORDER BY timestamp, id",
        (session_id,)
    ).fetchall()
    print(json.dumps([{"id": r["id"], "role": r["role"], "content": r["content"] or "", "timestamp": r["timestamp"]} for r in rows]))
    conn.close(); sys.exit(0)
print("[]")
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, sessionId }),
    );
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
hermes_home = os.path.expanduser("~/.hermes")
def scopes():
    if profile:
        name = "default" if profile == "default" else profile
        home = hermes_home if name == "default" else os.path.join(hermes_home, "profiles", name)
        return [(name, os.path.join(home, "state.db"))]
    result = [("default", os.path.join(hermes_home, "state.db"))]
    profiles_dir = os.path.join(hermes_home, "profiles")
    if os.path.isdir(profiles_dir):
        for name in sorted(os.listdir(profiles_dir)):
            if name.startswith("."): continue
            home = os.path.join(profiles_dir, name)
            if os.path.isdir(home): result.append((name, os.path.join(home, "state.db")))
    return result
result = []
for profile_name, db in scopes():
    if not os.path.exists(db): continue
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT DISTINCT s.id, s.title, s.started_at, s.source, s.message_count, s.model, m.content as snippet "
            "FROM sessions s JOIN messages m ON m.session_id = s.id "
            "WHERE m.content LIKE ? ORDER BY s.started_at DESC LIMIT ?",
            (f"%{query}%", limit)
        ).fetchall()
        result.extend([{"sessionId": r["id"], "title": r["title"], "startedAt": r["started_at"], "source": r["source"] or "cli", "messageCount": r["message_count"] or 0, "model": r["model"] or "", "snippet": (r["snippet"] or "")[:200], "profile": profile_name} for r in rows])
    except Exception:
        pass
    conn.close()
result.sort(key=lambda r: r["startedAt"] or 0, reverse=True)
print(json.dumps(result[:limit]))
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, query, limit }),
    );
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export interface SshProfileInfo extends ProfileInfo {}

export async function sshListProfiles(
  config: SshConfig,
): Promise<SshProfileInfo[]> {
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
        raw = open(pid_file).read().strip()
        try:
            parsed = json.loads(raw)
            pid = int(parsed.get("pid", raw))
        except Exception:
            pid = int(raw)
        os.kill(pid, 0)
        return True
    except Exception:
        return False

def read_metadata(path):
    metadata_file = os.path.join(path, "desktop", "profile-agent.json")
    try:
        data = json.load(open(metadata_file))
        if not isinstance(data, dict): return {}
        pointers = []
        for entry in data.get("docsPointers") or []:
            if isinstance(entry, dict) and isinstance(entry.get("id"), str) and isinstance(entry.get("title"), str):
                pointer = {"id": entry.get("id"), "title": entry.get("title")}
                if isinstance(entry.get("path"), str) and entry.get("path").strip(): pointer["path"] = entry.get("path").strip()
                if isinstance(entry.get("url"), str) and entry.get("url").strip(): pointer["url"] = entry.get("url").strip()
                pointers.append(pointer)
        return {
            "displayName": data.get("displayName") if isinstance(data.get("displayName"), str) and data.get("displayName").strip() else None,
            "description": data.get("description") if isinstance(data.get("description"), str) and data.get("description").strip() else None,
            "selectedPackIds": [x for x in (data.get("selectedPackIds") or []) if isinstance(x, str)],
            "docsPointers": pointers,
        }
    except Exception:
        return {"selectedPackIds": [], "docsPointers": []}

def active_profile():
    try:
        value = open(os.path.join(hermes_home, "active_profile")).read().strip()
        return value or "default"
    except Exception:
        return "default"

def append_profile(name, path, is_default, active):
    model, provider = read_config(path)
    metadata = read_metadata(path)
    profile = {
        "name": name, "path": path, "isDefault": is_default, "isActive": active == name,
        "model": model, "provider": provider,
        "hasEnv": os.path.exists(os.path.join(path, ".env")),
        "hasSoul": os.path.exists(os.path.join(path, "SOUL.md")),
        "skillCount": count_skills(path),
        "gatewayRunning": gw_running(path),
        "displayName": "Mercury" if is_default else (metadata.get("displayName") or name),
        "kind": "builtin" if is_default else "custom",
        "immutable": True if is_default else False,
        "deletable": False if is_default else True,
        "selectedPackIds": metadata.get("selectedPackIds") or [],
        "docsPointers": metadata.get("docsPointers") or [],
    }
    if metadata.get("description"): profile["description"] = metadata.get("description")
    profiles.append(profile)

active = active_profile()
append_profile("default", hermes_home, True, active)

if os.path.isdir(profiles_dir):
    for name in sorted(os.listdir(profiles_dir)):
        if name.startswith("."): continue
        p = os.path.join(profiles_dir, name)
        if os.path.isdir(p): append_profile(name, p, False, active)

print(json.dumps(profiles))
`;
  try {
    const out = await sshPython(config, script);
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [
      {
        name: "default",
        path: "~/.hermes",
        isDefault: true,
        isActive: true,
        model: "",
        provider: "auto",
        hasEnv: false,
        hasSoul: false,
        skillCount: 0,
        gatewayRunning: false,
        displayName: "Mercury",
        kind: "builtin",
        immutable: true,
        deletable: false,
        selectedPackIds: [],
        docsPointers: [],
      },
    ];
  }
}

export async function sshWriteProfileAgentMetadata(
  config: SshConfig,
  profile: string,
  metadata: ProfileAgentMetadata,
): Promise<void> {
  if (profile !== "default" && !isValidProfileName(profile)) {
    throw new Error("Profile metadata writes require a valid profile name.");
  }

  const script = `
import json, os, sys, traceback
payload = json.load(sys.stdin)
profile = payload.get("profile") or "default"
metadata = payload.get("metadata") or {}
hermes_home = os.path.expanduser("~/.hermes")
profile_home = hermes_home if profile == "default" else os.path.join(hermes_home, "profiles", profile)
metadata_path = os.path.join(profile_home, "desktop", "profile-agent.json")

def clean_string(value):
    return value.strip() if isinstance(value, str) and value.strip() else None

def clean_pointer(entry):
    if not isinstance(entry, dict): return None
    pointer_id = clean_string(entry.get("id"))
    title = clean_string(entry.get("title"))
    if not pointer_id or not title: return None
    pointer = {"id": pointer_id, "title": title}
    path = clean_string(entry.get("path"))
    url = clean_string(entry.get("url"))
    if path: pointer["path"] = path
    if url: pointer["url"] = url
    return pointer

try:
    normalized = {"version": 1}
    display_name = clean_string(metadata.get("displayName"))
    description = clean_string(metadata.get("description"))
    if display_name: normalized["displayName"] = display_name
    if description: normalized["description"] = description
    normalized["selectedPackIds"] = [x for x in (metadata.get("selectedPackIds") or []) if isinstance(x, str)]
    normalized["docsPointers"] = [p for p in [clean_pointer(x) for x in (metadata.get("docsPointers") or [])] if p]
    os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
    with open(metadata_path, "w") as f:
        json.dump(normalized, f, indent=2)
        f.write("\\n")
    print(json.dumps({"success": True}))
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc) or traceback.format_exc()}))
`;

  const out = await sshPython(
    config,
    script,
    pythonJsonInput({ profile, metadata }),
    30000,
  );
  const result = JSON.parse(
    out.trim() || '{"success":false,"error":"Profile metadata write returned no result"}',
  ) as { success?: boolean; error?: string };
  if (!result.success) throw new Error(result.error || "Profile metadata write failed");
}

export interface SshProfileMutationResult {
  success: boolean;
  error?: string;
}

export async function sshCreateProfile(
  config: SshConfig,
  name: string,
  copyDefaultConfig: boolean,
): Promise<SshProfileMutationResult> {
  if (!isValidProfileName(name)) {
    return {
      success: false,
      error:
        "Profile names must start with a lowercase letter or number and contain only lowercase letters, numbers, underscores, or hyphens.",
    };
  }

  const script = `
import json, os, shutil, subprocess, sys, traceback
payload = json.load(sys.stdin)
name = payload.get("name") or ""
copy_default_config = bool(payload.get("copyDefaultConfig"))

def finish(result):
    print(json.dumps(result))
    sys.exit(0)

try:
    proc = subprocess.run(
        ["hermes", "profile", "create", name, "--no-skills"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=15,
    )
    if proc.returncode != 0:
        finish({"success": False, "error": (proc.stderr or proc.stdout or "Profile creation failed").strip()})

    if copy_default_config:
        hermes_home = os.path.expanduser("~/.hermes")
        profile_home = os.path.join(hermes_home, "profiles", name)
        try:
            for filename in ["config.yaml", ".env"]:
                source = os.path.join(hermes_home, filename)
                if os.path.exists(source):
                    shutil.copy2(source, os.path.join(profile_home, filename))
        except Exception as copy_error:
            rollback = subprocess.run(
                ["hermes", "profile", "delete", name, "--yes"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=15,
            )
            error = str(copy_error)
            if rollback.returncode != 0:
                rollback_error = (rollback.stderr or rollback.stdout or "rollback failed").strip()
                error = f"{error} Rollback attempted but failed: {rollback_error}"
            finish({"success": False, "error": error})

    finish({"success": True})
except subprocess.TimeoutExpired:
    finish({"success": False, "error": "Profile creation timed out"})
except Exception as exc:
    finish({"success": False, "error": str(exc) or traceback.format_exc()})
`;

  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ name, copyDefaultConfig }),
      30000,
    );
    return JSON.parse(
      out.trim() ||
        '{"success":false,"error":"Profile creation returned no result"}',
    );
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Profile creation failed",
    };
  }
}

export async function sshDeleteProfile(
  config: SshConfig,
  name: string,
): Promise<boolean> {
  try {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe || safe === "default") return false;
    const quoted = shellQuote(safe);
    await sshExec(
      config,
      `hermes profiles delete ${quoted} --yes 2>&1 || rm -rf ~/.hermes/profiles/${quoted}`,
    );
    return true;
  } catch {
    return false;
  }
}
