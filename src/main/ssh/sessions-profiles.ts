import type { SshConfig } from "../ssh-tunnel";
import type { SessionSummary, SessionMessage, SearchResult } from "../sessions";
import { isValidProfileName } from "../../shared/profile-identity";
import type {
  AgentAvatarDataUrlResult,
  AgentAvatarMutationResult,
} from "../../shared/agents";
import {
  AGENT_AVATAR_CONTENT_TYPE,
  AGENT_AVATAR_FILE_NAME,
  AGENT_AVATAR_MAX_BYTES,
  type ProfileAgentMetadata,
  type ProfileAvatarMetadata,
  type ProfileInfo,
} from "../../shared/profiles";
import { deriveAgentSkillPackCount } from "../../shared/agent-packs";
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

def collect_skill_keys(path):
    skills_dir = os.path.join(path, "skills")
    keys = []
    if os.path.isdir(skills_dir):
        for cat in os.listdir(skills_dir):
            cat_path = os.path.join(skills_dir, cat)
            if os.path.isdir(cat_path):
                for name in os.listdir(cat_path):
                    if os.path.exists(os.path.join(cat_path, name, "SKILL.md")):
                        keys.append("skill:" + cat + "/" + name)
    return keys

def count_memory(path):
    mem_file = os.path.join(path, "memories", "MEMORY.md")
    try:
        content = open(mem_file).read()
    except Exception:
        return 0
    if not content.strip():
        return 0
    return len([e for e in content.split("\n§\n") if e.strip()])

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

def clean_avatar(value):
    if not isinstance(value, dict): return None
    if value.get("path") != ${JSON.stringify(AGENT_AVATAR_FILE_NAME)}: return None
    if value.get("contentType") != ${JSON.stringify(AGENT_AVATAR_CONTENT_TYPE)}: return None
    updated_at = value.get("updatedAt")
    if not isinstance(updated_at, str) or not updated_at.strip(): return None
    avatar = {"path": ${JSON.stringify(AGENT_AVATAR_FILE_NAME)}, "contentType": ${JSON.stringify(AGENT_AVATAR_CONTENT_TYPE)}, "updatedAt": updated_at.strip()}
    byte_length = value.get("byteLength")
    if isinstance(byte_length, int) and byte_length > 0 and byte_length <= ${AGENT_AVATAR_MAX_BYTES}:
        avatar["byteLength"] = byte_length
    return avatar

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
        metadata = {
            "displayName": data.get("displayName") if isinstance(data.get("displayName"), str) and data.get("displayName").strip() else None,
            "description": data.get("description") if isinstance(data.get("description"), str) and data.get("description").strip() else None,
            "selectedPackIds": [x for x in (data.get("selectedPackIds") or []) if isinstance(x, str)],
            "docsPointers": pointers,
        }
        avatar = clean_avatar(data.get("avatar"))
        if avatar: metadata["avatar"] = avatar
        return metadata
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
        "installedSkillKeys": collect_skill_keys(path),
        "memoryCount": count_memory(path),
        "gatewayRunning": gw_running(path),
        "displayName": "Mercury" if is_default else (metadata.get("displayName") or name),
        "kind": "builtin" if is_default else "custom",
        "immutable": True if is_default else False,
        "deletable": False if is_default else True,
        "selectedPackIds": metadata.get("selectedPackIds") or [],
        "docsPointers": metadata.get("docsPointers") or [],
    }
    if metadata.get("description"): profile["description"] = metadata.get("description")
    if not is_default and metadata.get("avatar"): profile["avatar"] = metadata.get("avatar")
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
    const raw = JSON.parse(out.trim() || "[]") as Array<
      SshProfileInfo & { installedSkillKeys?: string[] }
    >;
    return raw.map(({ installedSkillKeys, ...profile }) => ({
      ...profile,
      skillPackCount: deriveAgentSkillPackCount(
        new Set(installedSkillKeys ?? []),
      ),
      memoryCount: profile.memoryCount ?? 0,
    }));
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
        skillPackCount: 0,
        memoryCount: 0,
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

def clean_avatar(value):
    if not isinstance(value, dict): return None
    if value.get("path") != ${JSON.stringify(AGENT_AVATAR_FILE_NAME)}: return None
    if value.get("contentType") != ${JSON.stringify(AGENT_AVATAR_CONTENT_TYPE)}: return None
    updated_at = clean_string(value.get("updatedAt"))
    if not updated_at: return None
    avatar = {"path": ${JSON.stringify(AGENT_AVATAR_FILE_NAME)}, "contentType": ${JSON.stringify(AGENT_AVATAR_CONTENT_TYPE)}, "updatedAt": updated_at}
    byte_length = value.get("byteLength")
    if isinstance(byte_length, int) and byte_length > 0 and byte_length <= ${AGENT_AVATAR_MAX_BYTES}:
        avatar["byteLength"] = byte_length
    return avatar

try:
    normalized = {"version": 1}
    display_name = clean_string(metadata.get("displayName"))
    description = clean_string(metadata.get("description"))
    if display_name: normalized["displayName"] = display_name
    if description: normalized["description"] = description
    normalized["selectedPackIds"] = [x for x in (metadata.get("selectedPackIds") or []) if isinstance(x, str)]
    normalized["docsPointers"] = [p for p in [clean_pointer(x) for x in (metadata.get("docsPointers") or [])] if p]
    avatar = clean_avatar(metadata.get("avatar"))
    if avatar and profile != "default": normalized["avatar"] = avatar
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

type SshAvatarScriptMutationResult =
  | { success: true; avatar: unknown }
  | Exclude<AgentAvatarMutationResult, { success: true }>;

type RawSshAvatarScriptResult = {
  success?: boolean;
  code?: unknown;
  error?: unknown;
  avatar?: unknown;
  dataUrl?: unknown;
};

export async function sshSetAgentAvatar(
  config: SshConfig,
  profile: string,
  imageDataUrl: string,
): Promise<AgentAvatarMutationResult> {
  if (!isValidProfileName(profile)) {
    return sshAvatarMutationFailure("validation-error", "Invalid agent profile name.");
  }
  if (profile === "default") {
    return sshAvatarMutationFailure(
      "immutable-agent",
      "Mercury/default is immutable and cannot have a custom avatar.",
    );
  }

  const preflightError = sshAvatarDataUrlSizePreflight(imageDataUrl);
  if (preflightError) {
    return sshAvatarMutationFailure("validation-error", preflightError);
  }

  const script = `
import base64, datetime, json, os, sys, traceback, uuid
payload = json.load(sys.stdin)
profile = payload.get("profile") or ""
image_data_url = payload.get("imageDataUrl") or ""
PREFIX = ${JSON.stringify(`data:${AGENT_AVATAR_CONTENT_TYPE};base64,`)}
AVATAR_FILE = ${JSON.stringify(AGENT_AVATAR_FILE_NAME)}
CONTENT_TYPE = ${JSON.stringify(AGENT_AVATAR_CONTENT_TYPE)}
MAX_BYTES = ${AGENT_AVATAR_MAX_BYTES}
PNG_MAGIC = b"\\x89PNG\\r\\n\\x1a\\n"
hermes_home = os.path.expanduser("~/.hermes")
profile_home = os.path.join(hermes_home, "profiles", profile)
desktop_dir = os.path.join(profile_home, "desktop")
metadata_path = os.path.join(desktop_dir, "profile-agent.json")
avatar_path = os.path.join(desktop_dir, AVATAR_FILE)

def finish(result):
    print(json.dumps(result))
    sys.exit(0)

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

def clean_avatar(value):
    if not isinstance(value, dict): return None
    if value.get("path") != AVATAR_FILE: return None
    if value.get("contentType") != CONTENT_TYPE: return None
    updated_at = clean_string(value.get("updatedAt"))
    if not updated_at: return None
    avatar = {"path": AVATAR_FILE, "contentType": CONTENT_TYPE, "updatedAt": updated_at}
    byte_length = value.get("byteLength")
    if isinstance(byte_length, int) and byte_length > 0 and byte_length <= MAX_BYTES:
        avatar["byteLength"] = byte_length
    return avatar

def normalize_metadata(data):
    if not isinstance(data, dict): data = {}
    normalized = {"version": 1}
    display_name = clean_string(data.get("displayName"))
    description = clean_string(data.get("description"))
    if display_name: normalized["displayName"] = display_name
    if description: normalized["description"] = description
    normalized["selectedPackIds"] = [x for x in (data.get("selectedPackIds") or []) if isinstance(x, str)]
    normalized["docsPointers"] = [p for p in [clean_pointer(x) for x in (data.get("docsPointers") or [])] if p]
    avatar = clean_avatar(data.get("avatar"))
    if avatar: normalized["avatar"] = avatar
    return normalized

def read_metadata():
    try:
        with open(metadata_path) as f:
            return normalize_metadata(json.load(f))
    except Exception:
        return normalize_metadata({})

def write_metadata(metadata):
    os.makedirs(desktop_dir, exist_ok=True)
    tmp = os.path.join(desktop_dir, ".profile-agent.%s.tmp" % uuid.uuid4().hex)
    with open(tmp, "w") as f:
        json.dump(normalize_metadata(metadata), f, indent=2)
        f.write("\\n")
    os.replace(tmp, metadata_path)

try:
    if profile == "default":
        finish({"success": False, "code": "immutable-agent", "error": "Mercury/default is immutable and cannot have a custom avatar."})
    if not os.path.isdir(profile_home):
        finish({"success": False, "code": "not-found", "error": "Agent profile '%s' was not found." % profile})
    if not image_data_url.startswith(PREFIX):
        finish({"success": False, "code": "validation-error", "error": "Agent avatar must be a PNG data URL."})
    encoded = image_data_url[len(PREFIX):]
    if not encoded.strip():
        finish({"success": False, "code": "validation-error", "error": "Agent avatar PNG is empty."})
    try:
        png = base64.b64decode(encoded, validate=True)
    except Exception:
        finish({"success": False, "code": "validation-error", "error": "Agent avatar data is not valid base64."})
    if len(png) == 0:
        finish({"success": False, "code": "validation-error", "error": "Agent avatar PNG is empty."})
    if len(png) > MAX_BYTES:
        finish({"success": False, "code": "validation-error", "error": "Agent avatar PNG must be %d bytes or smaller." % MAX_BYTES})
    if len(png) < len(PNG_MAGIC) or png[:len(PNG_MAGIC)] != PNG_MAGIC:
        finish({"success": False, "code": "validation-error", "error": "Agent avatar data is not a valid PNG file."})

    os.makedirs(desktop_dir, exist_ok=True)
    nonce = "%s.%s" % (os.getpid(), uuid.uuid4().hex)
    tmp_avatar = os.path.join(desktop_dir, ".avatar.%s.tmp" % nonce)
    backup_avatar = os.path.join(desktop_dir, ".avatar.%s.bak" % nonce)
    backup_created = False
    avatar_replaced = False
    committed = False
    with open(tmp_avatar, "wb") as f:
        f.write(png)
    try:
        try:
            os.replace(avatar_path, backup_avatar)
            backup_created = True
        except FileNotFoundError:
            pass
        os.replace(tmp_avatar, avatar_path)
        avatar_replaced = True
        avatar = {"path": AVATAR_FILE, "contentType": CONTENT_TYPE, "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "byteLength": len(png)}
        metadata = read_metadata()
        metadata["avatar"] = avatar
        write_metadata(metadata)
        committed = True
    finally:
        if committed:
            if backup_created:
                try: os.remove(backup_avatar)
                except Exception: pass
        else:
            try: os.remove(tmp_avatar)
            except Exception: pass
            if avatar_replaced:
                try: os.remove(avatar_path)
                except Exception: pass
            if backup_created:
                try: os.replace(backup_avatar, avatar_path)
                except Exception: pass
    finish({"success": True, "avatar": avatar})
except Exception as exc:
    finish({"success": False, "code": "write-failed", "error": str(exc) or traceback.format_exc()})
`;

  const result = await runSshAvatarMutationScript(config, script, {
    profile,
    imageDataUrl,
  });
  if (!result.success) return result;
  const avatar = normalizeSshAvatarMetadata(result.avatar);
  if (!avatar) {
    return sshAvatarMutationFailure("write-failed", "SSH avatar write returned invalid metadata.");
  }
  return {
    success: true,
    agent: await sshAvatarAgent(config, profile, avatar),
    avatar,
  };
}

export async function sshClearAgentAvatar(
  config: SshConfig,
  profile: string,
): Promise<AgentAvatarMutationResult> {
  if (!isValidProfileName(profile)) {
    return sshAvatarMutationFailure("validation-error", "Invalid agent profile name.");
  }
  if (profile === "default") {
    return sshAvatarMutationFailure(
      "immutable-agent",
      "Mercury/default is immutable and cannot have a custom avatar.",
    );
  }

  const script = `
import json, os, sys, traceback, uuid
payload = json.load(sys.stdin)
profile = payload.get("profile") or ""
AVATAR_FILE = ${JSON.stringify(AGENT_AVATAR_FILE_NAME)}
CONTENT_TYPE = ${JSON.stringify(AGENT_AVATAR_CONTENT_TYPE)}
MAX_BYTES = ${AGENT_AVATAR_MAX_BYTES}
hermes_home = os.path.expanduser("~/.hermes")
profile_home = os.path.join(hermes_home, "profiles", profile)
desktop_dir = os.path.join(profile_home, "desktop")
metadata_path = os.path.join(desktop_dir, "profile-agent.json")
avatar_path = os.path.join(desktop_dir, AVATAR_FILE)

def finish(result):
    print(json.dumps(result))
    sys.exit(0)

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

def clean_avatar(value):
    if not isinstance(value, dict): return None
    if value.get("path") != AVATAR_FILE: return None
    if value.get("contentType") != CONTENT_TYPE: return None
    updated_at = clean_string(value.get("updatedAt"))
    if not updated_at: return None
    avatar = {"path": AVATAR_FILE, "contentType": CONTENT_TYPE, "updatedAt": updated_at}
    byte_length = value.get("byteLength")
    if isinstance(byte_length, int) and byte_length > 0 and byte_length <= MAX_BYTES:
        avatar["byteLength"] = byte_length
    return avatar

def normalize_metadata(data):
    if not isinstance(data, dict): data = {}
    normalized = {"version": 1}
    display_name = clean_string(data.get("displayName"))
    description = clean_string(data.get("description"))
    if display_name: normalized["displayName"] = display_name
    if description: normalized["description"] = description
    normalized["selectedPackIds"] = [x for x in (data.get("selectedPackIds") or []) if isinstance(x, str)]
    normalized["docsPointers"] = [p for p in [clean_pointer(x) for x in (data.get("docsPointers") or [])] if p]
    avatar = clean_avatar(data.get("avatar"))
    if avatar: normalized["avatar"] = avatar
    return normalized

def read_metadata():
    try:
        with open(metadata_path) as f:
            return normalize_metadata(json.load(f))
    except Exception:
        return normalize_metadata({})

def write_metadata(metadata):
    os.makedirs(desktop_dir, exist_ok=True)
    tmp = os.path.join(desktop_dir, ".profile-agent.%s.tmp" % uuid.uuid4().hex)
    with open(tmp, "w") as f:
        json.dump(normalize_metadata(metadata), f, indent=2)
        f.write("\\n")
    os.replace(tmp, metadata_path)

try:
    if profile == "default":
        finish({"success": False, "code": "immutable-agent", "error": "Mercury/default is immutable and cannot have a custom avatar."})
    if not os.path.isdir(profile_home):
        finish({"success": False, "code": "not-found", "error": "Agent profile '%s' was not found." % profile})
    metadata = read_metadata()
    if "avatar" not in metadata:
        finish({"success": True, "avatar": None})
    metadata.pop("avatar", None)
    write_metadata(metadata)
    try:
        os.remove(avatar_path)
    except FileNotFoundError:
        pass
    except Exception:
        pass
    finish({"success": True, "avatar": None})
except Exception as exc:
    finish({"success": False, "code": "write-failed", "error": str(exc) or traceback.format_exc()})
`;

  const result = await runSshAvatarMutationScript(config, script, { profile });
  if (!result.success) return result;
  return {
    success: true,
    agent: await sshAvatarAgent(config, profile, null),
    avatar: null,
  };
}

export async function sshGetAgentAvatarDataUrl(
  config: SshConfig,
  profile: string,
): Promise<AgentAvatarDataUrlResult> {
  if (!isValidProfileName(profile)) {
    return sshAvatarReadFailure("validation-error", "Invalid agent profile name.");
  }
  if (profile === "default") {
    return { success: true, dataUrl: null };
  }

  const script = `
import base64, json, os, sys, traceback
payload = json.load(sys.stdin)
profile = payload.get("profile") or ""
AVATAR_FILE = ${JSON.stringify(AGENT_AVATAR_FILE_NAME)}
CONTENT_TYPE = ${JSON.stringify(AGENT_AVATAR_CONTENT_TYPE)}
MAX_BYTES = ${AGENT_AVATAR_MAX_BYTES}
PNG_MAGIC = b"\\x89PNG\\r\\n\\x1a\\n"
hermes_home = os.path.expanduser("~/.hermes")
profile_home = os.path.join(hermes_home, "profiles", profile)
metadata_path = os.path.join(profile_home, "desktop", "profile-agent.json")
avatar_path = os.path.join(profile_home, "desktop", AVATAR_FILE)

def finish(result):
    print(json.dumps(result))
    sys.exit(0)

def clean_string(value):
    return value.strip() if isinstance(value, str) and value.strip() else None

def clean_avatar(value):
    if not isinstance(value, dict): return None
    if value.get("path") != AVATAR_FILE: return None
    if value.get("contentType") != CONTENT_TYPE: return None
    updated_at = clean_string(value.get("updatedAt"))
    if not updated_at: return None
    avatar = {"path": AVATAR_FILE, "contentType": CONTENT_TYPE, "updatedAt": updated_at}
    byte_length = value.get("byteLength")
    if isinstance(byte_length, int) and byte_length > 0 and byte_length <= MAX_BYTES:
        avatar["byteLength"] = byte_length
    return avatar

try:
    if profile == "default":
        finish({"success": True, "dataUrl": None})
    if not os.path.isdir(profile_home):
        finish({"success": False, "code": "not-found", "error": "Agent profile '%s' was not found." % profile})
    try:
        with open(metadata_path) as f:
            metadata = json.load(f)
    except Exception:
        finish({"success": True, "dataUrl": None})
    avatar = clean_avatar(metadata.get("avatar") if isinstance(metadata, dict) else None)
    if not avatar:
        finish({"success": True, "dataUrl": None})
    try:
        with open(avatar_path, "rb") as f:
            png = f.read(MAX_BYTES + 1)
    except FileNotFoundError:
        finish({"success": True, "dataUrl": None, "avatar": avatar})
    if len(png) == 0 or len(png) > MAX_BYTES or len(png) < len(PNG_MAGIC) or png[:len(PNG_MAGIC)] != PNG_MAGIC:
        finish({"success": True, "dataUrl": None, "avatar": avatar})
    finish({"success": True, "dataUrl": "data:%s;base64,%s" % (CONTENT_TYPE, base64.b64encode(png).decode("ascii")), "avatar": avatar})
except Exception as exc:
    finish({"success": False, "code": "read-failed", "error": str(exc) or traceback.format_exc()})
`;

  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile }),
      30000,
    );
    const raw = JSON.parse(
      out.trim() || '{"success":false,"code":"read-failed","error":"SSH avatar read returned no result"}',
    ) as RawSshAvatarScriptResult;
    if (!raw.success) {
      return sshAvatarReadFailure(
        readFailureCode(raw.code),
        typeof raw.error === "string" && raw.error.trim()
          ? raw.error
          : "SSH avatar read failed",
      );
    }
    const avatar = normalizeSshAvatarMetadata(raw.avatar);
    return {
      success: true,
      dataUrl: typeof raw.dataUrl === "string" ? raw.dataUrl : null,
      ...(avatar ? { avatar } : {}),
    };
  } catch (error) {
    return sshAvatarReadFailure(
      "read-failed",
      error instanceof Error ? error.message : "SSH avatar read failed",
    );
  }
}

async function runSshAvatarMutationScript(
  config: SshConfig,
  script: string,
  payload: unknown,
): Promise<SshAvatarScriptMutationResult> {
  try {
    const out = await sshPython(config, script, pythonJsonInput(payload), 30000);
    const raw = JSON.parse(
      out.trim() || '{"success":false,"code":"write-failed","error":"SSH avatar mutation returned no result"}',
    ) as RawSshAvatarScriptResult;
    if (!raw.success) {
      return sshAvatarMutationFailure(
        mutationFailureCode(raw.code),
        typeof raw.error === "string" && raw.error.trim()
          ? raw.error
          : "SSH avatar mutation failed",
      );
    }
    return { success: true, avatar: raw.avatar };
  } catch (error) {
    return sshAvatarMutationFailure(
      "write-failed",
      error instanceof Error ? error.message : "SSH avatar mutation failed",
    );
  }
}

async function sshAvatarAgent(
  config: SshConfig,
  profile: string,
  avatar: ProfileAvatarMetadata | null,
): Promise<ProfileInfo> {
  try {
    const profiles = await sshListProfiles(config);
    const found = profiles.find((entry) => entry.name === profile);
    if (found) {
      if (avatar) return { ...found, avatar };
      const { avatar: _avatar, ...withoutAvatar } = found;
      return withoutAvatar;
    }
  } catch {
    // Fall back to a minimal custom-agent projection below.
  }
  return fallbackSshAvatarAgent(profile, avatar);
}

function fallbackSshAvatarAgent(
  profile: string,
  avatar: ProfileAvatarMetadata | null,
): ProfileInfo {
  return {
    name: profile,
    path: `~/.hermes/profiles/${profile}`,
    isDefault: false,
    isActive: false,
    model: "",
    provider: "auto",
    hasEnv: false,
    hasSoul: false,
    skillCount: 0,
    skillPackCount: 0,
    memoryCount: 0,
    gatewayRunning: false,
    displayName: profile,
    kind: "custom",
    immutable: false,
    deletable: true,
    selectedPackIds: [],
    docsPointers: [],
    ...(avatar ? { avatar } : {}),
  };
}

function sshAvatarDataUrlSizePreflight(imageDataUrl: string): string | null {
  const prefix = `data:${AGENT_AVATAR_CONTENT_TYPE};base64,`;
  if (!imageDataUrl.startsWith(prefix)) return null;
  const encodedLength = imageDataUrl.length - prefix.length;
  if (encodedLength <= 0) return "Agent avatar PNG is empty.";
  const maxBase64Length = Math.ceil(AGENT_AVATAR_MAX_BYTES / 3) * 4;
  if (encodedLength > maxBase64Length) {
    return `Agent avatar PNG must be ${AGENT_AVATAR_MAX_BYTES} bytes or smaller.`;
  }
  return null;
}

function normalizeSshAvatarMetadata(value: unknown): ProfileAvatarMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const avatar = value as Record<string, unknown>;
  if (avatar.path !== AGENT_AVATAR_FILE_NAME) return null;
  if (avatar.contentType !== AGENT_AVATAR_CONTENT_TYPE) return null;
  if (typeof avatar.updatedAt !== "string" || !avatar.updatedAt.trim()) return null;
  return {
    path: AGENT_AVATAR_FILE_NAME,
    contentType: AGENT_AVATAR_CONTENT_TYPE,
    updatedAt: avatar.updatedAt.trim(),
    ...(typeof avatar.byteLength === "number" &&
    Number.isInteger(avatar.byteLength) &&
    avatar.byteLength > 0 &&
    avatar.byteLength <= AGENT_AVATAR_MAX_BYTES
      ? { byteLength: avatar.byteLength }
      : {}),
  };
}

function mutationFailureCode(
  code: unknown,
): Exclude<AgentAvatarMutationResult, { success: true }>["code"] {
  return code === "not-found" ||
    code === "immutable-agent" ||
    code === "unsupported-remote-mode" ||
    code === "validation-error" ||
    code === "write-failed"
    ? code
    : "write-failed";
}

function readFailureCode(
  code: unknown,
): Exclude<AgentAvatarDataUrlResult, { success: true }>["code"] {
  return code === "not-found" ||
    code === "unsupported-remote-mode" ||
    code === "validation-error" ||
    code === "read-failed"
    ? code
    : "read-failed";
}

function sshAvatarMutationFailure(
  code: Exclude<AgentAvatarMutationResult, { success: true }>["code"],
  error: string,
): AgentAvatarMutationResult {
  return { success: false, code, error };
}

function sshAvatarReadFailure(
  code: Exclude<AgentAvatarDataUrlResult, { success: true }>["code"],
  error: string,
): AgentAvatarDataUrlResult {
  return { success: false, code, error };
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
