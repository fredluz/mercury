import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, relative, resolve } from "path";
import Database from "better-sqlite3";
import { HERMES_HOME } from "../install/paths";
import type {
  CandidateActivity,
  CandidateAgent,
  CandidateConfidence,
  CandidateEvidence,
  CandidateAgentOrigin,
  InventoryArtifactKind,
  MigrationInventory,
  MigrationInventoryOptions,
  MigrationInventorySource,
  MigrationSourceKind,
  PrivacyFlag,
} from "../../shared/migration";

const MEMORY_ENTRY_DELIMITER = "\n§\n";
const MAX_LIST_ITEMS = 8;

interface SkillSummary {
  count: number;
  names: string[];
}

interface MemorySummary {
  hasSoul: boolean;
  hasMemory: boolean;
  hasUser: boolean;
  memoryEntries: number;
  memoryChars: number;
  userChars: number;
}

interface SessionSummary {
  count: number;
  messageCount: number;
  lastActive: number | null;
  sources: string[];
  models: string[];
}

interface CronSummary {
  count: number;
  names: string[];
  skills: string[];
  deliverCount: number;
  hasPrompts: boolean;
}

interface ConfigSummary {
  model: string;
  provider: string;
  hasEnv: boolean;
  hasAuth: boolean;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function normalizePath(path: string): string {
  return resolve(expandHome(path));
}

function unique(paths: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    if (!raw) continue;
    const path = normalizePath(raw);
    if (seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readText(path: string, max = 20000): string {
  try {
    return readFileSync(path, "utf-8").slice(0, max);
  } catch {
    return "";
  }
}

function jsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function pathLabel(root: string, path: string): string {
  const rel = relative(root, path);
  return rel && !rel.startsWith("..") ? sanitizePathLabel(rel) : sanitizePathLabel(path);
}

function hash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

function safeIdPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "candidate";
}

const SENSITIVE_LABEL_RE = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|\+?\d[\d\s().-]{7,}\d|\b(?:sk|pk|ghp|gho|xox[baprs])-?[A-Z0-9_-]{8,}\b|\b(?:channel|customer|account|user)[-_: ]+[A-Z0-9._-]{4,}\b)/i;

function hasSensitiveLabel(input: string): boolean {
  return SENSITIVE_LABEL_RE.test(input);
}

function sanitizeLabel(input: string, fallback: string): string {
  const compact = input.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  if (hasSensitiveLabel(compact)) return `${fallback}-${hash(compact)}`;
  return compact.slice(0, 80);
}

function sanitizePathLabel(label: string): string {
  return label
    .split(/[\\/]+/)
    .map((part) => (hasSensitiveLabel(part) ? `redacted-${hash(part)}` : part))
    .join("/");
}

function safePrivateIdPart(input: string, fallback: string): string {
  return safeIdPart(sanitizeLabel(input, fallback));
}

function addEvidence(
  evidence: CandidateEvidence[],
  root: string,
  kind: InventoryArtifactKind,
  path: string,
  label: string,
  count?: number,
  privacyFlags?: PrivacyFlag[],
): void {
  evidence.push({
    kind,
    path: pathLabel(root, path),
    label,
    ...(count !== undefined ? { count } : {}),
    ...(privacyFlags?.length ? { privacyFlags } : {}),
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, MAX_LIST_ITEMS);
}

function privacyFlags(evidence: CandidateEvidence[]): PrivacyFlag[] {
  const flags = new Set<PrivacyFlag>();
  for (const item of evidence) {
    for (const flag of item.privacyFlags || []) flags.add(flag);
  }
  return [...flags];
}

function detectMarkers(root: string, markers: string[]): string[] {
  return markers.filter((marker) => existsSync(join(root, marker)));
}

function sourceRecord(
  kind: MigrationSourceKind,
  path: string,
  label: string,
  markers: string[],
  warnings: string[] = [],
): MigrationInventorySource {
  return {
    kind,
    path,
    label,
    exists: isDirectory(path),
    markers: isDirectory(path) ? detectMarkers(path, markers) : [],
    warnings,
  };
}

function parseConfig(home: string, root: string, evidence: CandidateEvidence[]): ConfigSummary {
  const configPath = join(home, "config.yaml");
  const envPath = join(home, ".env");
  const authPath = join(root, "auth.json");
  const config = readText(configPath, 10000);
  if (config) addEvidence(evidence, root, "config", configPath, "config.yaml");
  if (isFile(envPath)) addEvidence(evidence, root, "env", envPath, ".env present", undefined, ["credentials-present", "secrets-redacted"]);
  if (isFile(authPath)) addEvidence(evidence, root, "auth", authPath, "auth.json present", undefined, ["credentials-present", "secrets-redacted"]);
  const model = config.match(/^\s*default:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim() || "";
  const provider = config.match(/^\s*provider:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim() || "";
  return { model, provider, hasEnv: isFile(envPath), hasAuth: isFile(authPath) };
}

function summarizeMemory(home: string, root: string, evidence: CandidateEvidence[]): MemorySummary {
  const soulPath = join(home, "SOUL.md");
  const memoryPath = join(home, "memories", "MEMORY.md");
  const userPath = join(home, "memories", "USER.md");
  const soul = readText(soulPath);
  const memory = readText(memoryPath);
  const user = readText(userPath);
  if (soul) addEvidence(evidence, root, "persona", soulPath, "SOUL.md present", undefined, ["raw-content-redacted"]);
  if (memory) addEvidence(evidence, root, "memory", memoryPath, "MEMORY.md present", undefined, ["raw-content-redacted"]);
  if (user) addEvidence(evidence, root, "memory", userPath, "USER.md present", undefined, ["raw-content-redacted", "pii-redacted"]);
  const entries = memory.trim()
    ? memory.split(MEMORY_ENTRY_DELIMITER).filter((entry) => entry.trim()).length
    : 0;
  return {
    hasSoul: Boolean(soul),
    hasMemory: Boolean(memory),
    hasUser: Boolean(user),
    memoryEntries: entries,
    memoryChars: memory.length,
    userChars: user.length,
  };
}

function summarizeSkillsAt(skillsDir: string, root: string, evidence: CandidateEvidence[]): SkillSummary {
  if (!isDirectory(skillsDir)) return { count: 0, names: [] };
  const names: string[] = [];
  try {
    for (const category of readdirSync(skillsDir)) {
      const categoryPath = join(skillsDir, category);
      if (!isDirectory(categoryPath)) continue;
      for (const entry of readdirSync(categoryPath)) {
        const skillPath = join(categoryPath, entry);
        const skillFile = join(skillPath, "SKILL.md");
        if (!isDirectory(skillPath) || !isFile(skillFile)) continue;
        const content = readText(skillFile, 4000);
        const name = content.match(/^name:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim() || entry;
        names.push(name);
      }
    }
  } catch {
    // ignore partial skill read failures
  }
  if (names.length) addEvidence(evidence, root, "skill", skillsDir, "Installed skills", names.length);
  return { count: names.length, names: uniqueStrings(names) };
}

function summarizeSessions(dbPath: string, root: string, evidence: CandidateEvidence[]): SessionSummary {
  if (!isFile(dbPath)) return { count: 0, messageCount: 0, lastActive: null, sources: [], models: [] };
  addEvidence(evidence, root, "session", dbPath, "state.db sessions", undefined, ["transcript-derived"]);
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const aggregate = db
        .prepare(
          `SELECT COUNT(*) as count,
                  COALESCE(SUM(message_count), 0) as messageCount,
                  MAX(COALESCE(ended_at, started_at)) as lastActive
             FROM sessions`,
        )
        .get() as { count?: number; messageCount?: number; lastActive?: number | null } | undefined;
      const sources = db
        .prepare("SELECT DISTINCT source FROM sessions WHERE source IS NOT NULL AND source != '' LIMIT 12")
        .all() as Array<{ source: string }>;
      const models = db
        .prepare("SELECT DISTINCT model FROM sessions WHERE model IS NOT NULL AND model != '' LIMIT 12")
        .all() as Array<{ model: string }>;
      return {
        count: aggregate?.count ?? 0,
        messageCount: aggregate?.messageCount ?? 0,
        lastActive: aggregate?.lastActive ?? null,
        sources: uniqueStrings(sources.map((row) => row.source)),
        models: uniqueStrings(models.map((row) => row.model)),
      };
    } finally {
      db.close();
    }
  } catch {
    return { count: 0, messageCount: 0, lastActive: null, sources: [], models: [] };
  }
}

function summarizeCron(cronPath: string, root: string, evidence: CandidateEvidence[]): CronSummary {
  const parsed = jsonFile(cronPath);
  const raw = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { jobs?: unknown }).jobs)
      ? ((parsed as { jobs: unknown[] }).jobs)
      : [];
  if (!raw.length) return { count: 0, names: [], skills: [], deliverCount: 0, hasPrompts: false };
  const names: string[] = [];
  const skills: string[] = [];
  let deliverCount = 0;
  let hasPrompts = false;
  for (const job of raw) {
    if (!job || typeof job !== "object") continue;
    const record = job as Record<string, unknown>;
    if (typeof record.name === "string") names.push(sanitizeLabel(record.name, "job"));
    if (typeof record.prompt === "string" && record.prompt.trim()) hasPrompts = true;
    if (Array.isArray(record.skills)) skills.push(...record.skills.filter((s): s is string => typeof s === "string"));
    if (typeof record.skill === "string") skills.push(record.skill);
    if (Array.isArray(record.deliver)) deliverCount += record.deliver.length;
    else if (record.deliver) deliverCount += 1;
  }
  addEvidence(evidence, root, "cron", cronPath, "cron/jobs.json", raw.length, hasPrompts ? ["transcript-derived", "raw-content-redacted"] : undefined);
  return { count: raw.length, names: uniqueStrings(names), skills: uniqueStrings(skills), deliverCount, hasPrompts };
}

function candidate(
  params: Omit<CandidateAgent, "privacyFlags">,
): CandidateAgent {
  return { ...params, privacyFlags: privacyFlags(params.evidence) };
}

function defaultActivity(overrides: Partial<CandidateActivity> = {}): CandidateActivity {
  return {
    sessionCount: 0,
    messageCount: 0,
    cronJobCount: 0,
    skillCount: 0,
    lastActive: null,
    sources: [],
    models: [],
    ...overrides,
  };
}

function profileMarkers(home: string): string[] {
  return [
    ["config.yaml", isFile(join(home, "config.yaml"))],
    [".env", isFile(join(home, ".env"))],
    ["SOUL.md", isFile(join(home, "SOUL.md"))],
    ["memories/MEMORY.md", isFile(join(home, "memories", "MEMORY.md"))],
    ["memories/USER.md", isFile(join(home, "memories", "USER.md"))],
    ["state.db", isFile(join(home, "state.db"))],
    ["skills/", isDirectory(join(home, "skills"))],
    ["cron/jobs.json", isFile(join(home, "cron", "jobs.json"))],
  ]
    .filter(([, present]) => present)
    .map(([marker]) => marker as string);
}

function scanHermesProfile(root: string, profileName: string, home: string): CandidateAgent[] {
  const markers = profileMarkers(home);
  if (!markers.length) return [];
  const evidence: CandidateEvidence[] = [];
  const config = parseConfig(home, root, evidence);
  const memory = summarizeMemory(home, root, evidence);
  const skills = summarizeSkillsAt(join(home, "skills"), root, evidence);
  const sessions = summarizeSessions(join(home, "state.db"), root, evidence);
  const cron = summarizeCron(join(home, "cron", "jobs.json"), root, evidence);

  const profileLabel = sanitizeLabel(profileName, "profile");
  const targetProfile = profileName === "default" ? "default" : safePrivateIdPart(profileName, "profile");
  const displayName = profileName === "default" ? "Hermes default profile" : `Hermes profile: ${profileLabel}`;
  const personaParts = [
    memory.hasSoul ? "SOUL present" : "no SOUL",
    memory.hasMemory ? `${memory.memoryEntries} memory entries` : "no MEMORY.md",
    memory.hasUser ? "USER profile present" : "no USER.md",
  ];
  const capabilityParts = [
    skills.count ? `${skills.count} skills (${skills.names.join(", ")})` : "no installed skills found",
    cron.skills.length ? `cron skills: ${cron.skills.join(", ")}` : "",
    config.model ? `model ${config.model}` : "",
    config.provider ? `provider ${config.provider}` : "",
  ].filter(Boolean);
  const useCaseParts = [
    sessions.count ? `${sessions.count} sessions / ${sessions.messageCount} messages` : "no session DB history found",
    sessions.sources.length ? `sources: ${sessions.sources.join(", ")}` : "",
    cron.count ? `${cron.count} recurring jobs` : "no cron jobs",
  ].filter(Boolean);

  const candidates: CandidateAgent[] = [
    candidate({
      id: `hermes-profile:${hash(home)}:${targetProfile}`,
      sourceKind: "hermes",
      origin: "hermes-profile",
      displayName,
      confidence: markers.length ? "high" : "low",
      sourceRoots: [root],
      sourceProfiles: [profileLabel],
      evidence,
      personaSummary: personaParts.join("; "),
      capabilitySummary: capabilityParts.join("; ") || "No capability evidence found",
      useCaseSummary: useCaseParts.join("; ") || "No use-case evidence found",
      activity: defaultActivity({
        sessionCount: sessions.count,
        messageCount: sessions.messageCount,
        cronJobCount: cron.count,
        skillCount: skills.count,
        lastActive: sessions.lastActive,
        sources: sessions.sources,
        models: sessions.models,
      }),
      proposedTargetProfile: targetProfile,
      warnings: config.hasEnv || config.hasAuth ? ["Credentials or environment files are present and are redacted from inventory output."] : [],
    }),
  ];

  if (cron.count) {
    candidates.push(candidate({
      id: `hermes-cron:${hash(home)}:${targetProfile}`,
      sourceKind: "hermes",
      origin: "cron-cluster",
      displayName: `${displayName} recurring work`,
      confidence: "medium",
      sourceRoots: [root],
      sourceProfiles: [profileLabel],
      evidence: evidence.filter((item) => item.kind === "cron" || item.kind === "skill"),
      personaSummary: "Synthesized from recurring job metadata; prompts redacted by default.",
      capabilitySummary: cron.skills.length ? `Recurring jobs reference skills: ${cron.skills.join(", ")}` : "Recurring jobs found; no skill list found.",
      useCaseSummary: `${cron.count} recurring jobs${cron.names.length ? ` (${cron.names.join(", ")})` : ""}; ${cron.deliverCount} delivery targets`,
      activity: defaultActivity({ cronJobCount: cron.count, skillCount: skills.count }),
      proposedTargetProfile: `${targetProfile}-recurring`,
      warnings: cron.hasPrompts ? ["Cron prompts are transcript-derived and redacted from the default inventory."] : [],
    }));
  }

  if (skills.count >= 3) {
    candidates.push(candidate({
      id: `hermes-skills:${hash(home)}:${targetProfile}`,
      sourceKind: "hermes",
      origin: "skill-bundle",
      displayName: `${displayName} skill bundle`,
      confidence: "medium",
      sourceRoots: [root],
      sourceProfiles: [profileLabel],
      evidence: evidence.filter((item) => item.kind === "skill"),
      personaSummary: "Synthesized from installed skill metadata.",
      capabilitySummary: `${skills.count} installed skills: ${skills.names.join(", ")}`,
      useCaseSummary: "Candidate capability bundle; session/task linkage requires deeper opt-in analysis.",
      activity: defaultActivity({ skillCount: skills.count }),
      proposedTargetProfile: `${targetProfile}-skills`,
      warnings: [],
    }));
  }

  return candidates;
}

function collectHermesRoots(options: MigrationInventoryOptions): string[] {
  return unique([
    options.includeDefaultSources === false ? undefined : HERMES_HOME,
    ...(options.hermesRoots || []),
  ]);
}

function scanHermesRoot(root: string): { source: MigrationInventorySource; candidates: CandidateAgent[] } {
  const source = sourceRecord("hermes", root, "Hermes home", [
    "config.yaml",
    ".env",
    "SOUL.md",
    "memories",
    "skills",
    "state.db",
    "profiles",
    "cron/jobs.json",
    "auth.json",
  ]);
  if (!source.exists) return { source, candidates: [] };

  const candidates: CandidateAgent[] = [];
  candidates.push(...scanHermesProfile(root, "default", root));

  const profilesDir = join(root, "profiles");
  if (isDirectory(profilesDir)) {
    try {
      for (const entry of readdirSync(profilesDir)) {
        if (entry.startsWith(".")) continue;
        const home = join(profilesDir, entry);
        if (isDirectory(home)) candidates.push(...scanHermesProfile(root, entry, home));
      }
    } catch {
      source.warnings.push("Failed to enumerate some Hermes profiles.");
    }
  }

  if (!candidates.length) source.warnings.push("No Hermes profile markers found.");

  return { source, candidates };
}

function listJsonlCount(dir: string): number {
  if (!isDirectory(dir)) return 0;
  try {
    return readdirSync(dir).filter((entry) => entry.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

const OPENCLAW_PERSONA_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
  "DREAMS.md",
];

function collectPersonaEvidence(root: string, dirs: string[], evidence: CandidateEvidence[]): string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    for (const file of OPENCLAW_PERSONA_FILES) {
      const path = join(dir, file);
      if (!isFile(path)) continue;
      found.push(file);
      addEvidence(evidence, root, file === "MEMORY.md" ? "memory" : "persona", path, `${file} present`, undefined, ["raw-content-redacted"]);
    }
    const memoryDir = join(dir, "memory");
    if (isDirectory(memoryDir)) {
      try {
        const notes = readdirSync(memoryDir).filter((entry) => /\.md$/i.test(entry));
        if (notes.length) {
          found.push("memory/*.md");
          addEvidence(evidence, root, "memory", memoryDir, "dated memory notes", notes.length, ["raw-content-redacted"]);
        }
      } catch {
        // ignore
      }
    }
  }
  return uniqueStrings(found);
}

function summarizeOpenClawSkills(root: string, dirs: string[], evidence: CandidateEvidence[]): SkillSummary {
  const names: string[] = [];
  let count = 0;
  for (const dir of dirs) {
    const summary = summarizeSkillsAt(dir, root, evidence);
    count += summary.count;
    names.push(...summary.names);
  }
  return { count, names: uniqueStrings(names) };
}

function sessionsJsonCount(path: string): number {
  const parsed = jsonFile(path);
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.sessions)) return record.sessions.length;
    return Object.keys(record).length;
  }
  return 0;
}

function scanOpenClawAgent(root: string, agentId: string, agentDir: string): CandidateAgent {
  const evidence: CandidateEvidence[] = [];
  const workspaceDirs = [join(agentDir, "agent"), agentDir].filter(isDirectory);
  const personaFiles = collectPersonaEvidence(root, workspaceDirs, evidence);

  const sessionsDir = join(agentDir, "sessions");
  const sessionsJson = join(sessionsDir, "sessions.json");
  const sessionIndexCount = isFile(sessionsJson) ? sessionsJsonCount(sessionsJson) : 0;
  const transcriptCount = listJsonlCount(sessionsDir);
  if (isFile(sessionsJson)) addEvidence(evidence, root, "session", sessionsJson, "sessions.json", sessionIndexCount, ["transcript-derived"]);
  if (transcriptCount) addEvidence(evidence, root, "session", sessionsDir, "session transcripts", transcriptCount, ["transcript-derived", "raw-content-redacted"]);

  const authProfiles = join(agentDir, "auth-profiles.json");
  if (isFile(authProfiles)) addEvidence(evidence, root, "auth", authProfiles, "auth-profiles.json present", undefined, ["credentials-present", "secrets-redacted"]);

  const skills = summarizeOpenClawSkills(root, [join(agentDir, "skills"), join(agentDir, ".agents", "skills"), join(root, "skills"), join(root, ".agents", "skills")], evidence);
  const taskLedger = join(root, "tasks", "runs.sqlite");
  if (isFile(taskLedger)) addEvidence(evidence, root, "task", taskLedger, "task ledger present", undefined, ["transcript-derived"]);
  const cron = summarizeCron(join(root, "cron", "jobs.json"), root, evidence);
  const credentialsDir = join(root, "credentials");
  if (isDirectory(credentialsDir)) addEvidence(evidence, root, "auth", credentialsDir, "credentials directory present", undefined, ["credentials-present", "secrets-redacted"]);

  const sessionCount = Math.max(sessionIndexCount, transcriptCount);
  const confidence: CandidateConfidence = personaFiles.length || sessionCount ? "high" : "medium";
  const agentLabel = sanitizeLabel(agentId, "agent");
  const targetProfile = safePrivateIdPart(agentId, "agent");
  return candidate({
    id: `openclaw-agent:${hash(agentDir)}:${targetProfile}`,
    sourceKind: "openclaw",
    origin: "openclaw-agent",
    displayName: `OpenClaw agent: ${agentLabel}`,
    confidence,
    sourceRoots: [root],
    sourceProfiles: [agentLabel],
    evidence,
    personaSummary: personaFiles.length ? `Persona/memory files: ${personaFiles.join(", ")}` : "No persona files found for this agent.",
    capabilitySummary: skills.count ? `${skills.count} skills: ${skills.names.join(", ")}` : "No agent-specific skills found.",
    useCaseSummary: `${sessionCount} session records/transcripts; ${cron.count} root recurring jobs`,
    activity: defaultActivity({
      sessionCount,
      cronJobCount: cron.count,
      skillCount: skills.count,
    }),
    proposedTargetProfile: targetProfile,
    warnings: ["OpenClaw layouts are inferred from detected files; review evidence before importing."],
  });
}

function scanOpenClawWorkspace(root: string, origin: CandidateAgentOrigin): CandidateAgent | null {
  const evidence: CandidateEvidence[] = [];
  const personaFiles = collectPersonaEvidence(root, [root], evidence);
  const skills = summarizeOpenClawSkills(root, [join(root, "skills"), join(root, ".agents", "skills")], evidence);
  const cron = summarizeCron(join(root, "cron", "jobs.json"), root, evidence);
  const taskLedger = join(root, "tasks", "runs.sqlite");
  if (isFile(taskLedger)) addEvidence(evidence, root, "task", taskLedger, "task ledger present", undefined, ["transcript-derived"]);
  if (!evidence.length) return null;
  const label = sanitizeLabel(basename(root) || "openclaw-workspace", "workspace");
  return candidate({
    id: `openclaw-workspace:${hash(root)}`,
    sourceKind: "openclaw",
    origin,
    displayName: `OpenClaw workspace: ${label}`,
    confidence: personaFiles.length ? "medium" : "low",
    sourceRoots: [root],
    sourceProfiles: [],
    evidence,
    personaSummary: personaFiles.length ? `Workspace persona/memory files: ${personaFiles.join(", ")}` : "Workspace evidence found without persona files.",
    capabilitySummary: skills.count ? `${skills.count} workspace skills: ${skills.names.join(", ")}` : "No workspace skills found.",
    useCaseSummary: `${cron.count} recurring jobs; ${isFile(taskLedger) ? "task ledger present" : "no task ledger found"}`,
    activity: defaultActivity({ cronJobCount: cron.count, skillCount: skills.count }),
    proposedTargetProfile: safePrivateIdPart(label.replace(/^\./, ""), "workspace"),
    warnings: ["Synthesized workspace candidate; confirm before importing."],
  });
}

function collectOpenClawRoots(options: MigrationInventoryOptions): string[] {
  const home = homedir();
  const profileRoots: string[] = [];
  try {
    for (const entry of readdirSync(home)) {
      if (entry.startsWith(".openclaw-") && isDirectory(join(home, entry))) {
        profileRoots.push(join(home, entry));
      }
    }
  } catch {
    // ignore home enumeration failures
  }
  return unique([
    ...(options.includeDefaultSources === false ? [] : [join(home, ".openclaw"), join(home, ".clawdbot"), join(home, ".moldbot")]),
    ...(options.includeDefaultSources === false ? [] : profileRoots),
    process.env.OPENCLAW_STATE_DIR,
    process.env.OPENCLAW_CONFIG_PATH ? dirname(process.env.OPENCLAW_CONFIG_PATH) : undefined,
    ...(options.openClawRoots || []),
  ]);
}

function scanOpenClawRoot(root: string): { source: MigrationInventorySource; candidates: CandidateAgent[] } {
  const source = sourceRecord("openclaw", root, "OpenClaw state", [
    "openclaw.json",
    "agents",
    "credentials",
    "skills",
    ".agents/skills",
    "cron/jobs.json",
    "tasks/runs.sqlite",
    "MEMORY.md",
    "AGENTS.md",
  ]);
  if (!source.exists) return { source, candidates: [] };

  const candidates: CandidateAgent[] = [];
  const agentsDir = join(root, "agents");
  if (isDirectory(agentsDir)) {
    try {
      for (const agentId of readdirSync(agentsDir)) {
        if (agentId.startsWith(".")) continue;
        const agentDir = join(agentsDir, agentId);
        if (isDirectory(agentDir)) candidates.push(scanOpenClawAgent(root, agentId, agentDir));
      }
    } catch {
      source.warnings.push("Failed to enumerate some OpenClaw agents.");
    }
  }

  const workspaceCandidate = scanOpenClawWorkspace(root, candidates.length ? "skill-bundle" : "openclaw-workspace");
  if (workspaceCandidate) candidates.push(workspaceCandidate);
  return { source, candidates };
}

export function buildMigrationInventory(
  options: MigrationInventoryOptions = {},
): MigrationInventory {
  const sources: MigrationInventorySource[] = [];
  const candidates: CandidateAgent[] = [];
  const warnings: string[] = [];

  for (const root of collectHermesRoots(options)) {
    const result = scanHermesRoot(root);
    sources.push(result.source);
    candidates.push(...result.candidates);
  }

  for (const root of collectOpenClawRoots(options)) {
    const result = scanOpenClawRoot(root);
    sources.push(result.source);
    candidates.push(...result.candidates);
  }

  if (!candidates.length) {
    warnings.push("No migration candidate agents were found in detected source roots.");
  }

  return {
    generatedAt: Date.now(),
    sources,
    candidates,
    warnings,
  };
}
