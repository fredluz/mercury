import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const preloadTypes = readFileSync(join(ROOT, "src/preload/index.d.ts"), "utf-8");
const cliEntrypoint = readFileSync(join(ROOT, "src/cli/index.ts"), "utf-8");
const cliDocs = readFileSync(join(ROOT, "docs/contracts/cli.md"), "utf-8");

const DOMAIN_SENTINELS: Record<string, string[]> = {
  chat: ["sendMessage", "generateChatTitle", "abortChat"],
  sessions: ["listSessions", "getSessionMessages", "searchSessions", "syncSessionCache"],
  profiles: ["listProfiles", "createProfile", "deleteProfile", "setActiveProfile"],
  memory: ["readMemory", "addMemoryEntry", "writeUserProfile"],
  soul: ["readSoul", "writeSoul", "resetSoul"],
  tools: ["getToolsets", "setToolsetEnabled"],
  skills: ["listInstalledSkills", "installSkill", "importSkillMarkdown"],
  models: ["listModels", "addModel", "updateModel"],
  credentials: ["getCredentialPool", "setCredentialPool"],
  cron: ["listCronJobs", "createCronJob", "triggerCronJob"],
  traces: ["listTraceRuns", "getTraceRun", "recordLocalChatTrace"],
  runtime: ["getRuntimeDiagnostic"],
  gateway: ["startGateway", "gatewayStatus", "setPlatformEnabled"],
  install: ["checkInstall", "startInstall", "verifyInstall"],
  hermes: ["getHermesVersion", "runHermesDoctor", "runHermesUpdate"],
  config: ["getConfig", "setConfig", "getModelConfig", "setModelConfig"],
  env: ["getEnv", "setEnv"],
  connection: ["getConnectionConfig", "setConnectionConfig", "testSshConnection"],
  ssh: ["isSshTunnelActive", "startSshTunnel", "stopSshTunnel"],
  system: ["runHermesBackup", "runHermesImport", "runHermesDump", "listMcpServers"],
};

function preloadDeclares(method: string): boolean {
  return new RegExp(`\\b${method}\\s*:`).test(preloadTypes);
}

describe("CLI parity guardrail", () => {
  it("documents and reserves every major preload command domain", () => {
    for (const [domain, methods] of Object.entries(DOMAIN_SENTINELS)) {
      expect(methods.some(preloadDeclares), `${domain} has a preload sentinel`).toBe(true);
      expect(cliEntrypoint, `${domain} is reserved by the CLI entrypoint`).toContain(`"${domain}"`);
      expect(cliDocs, `${domain} is documented in the CLI contract`).toContain(`| \`${domain}\``);
    }
  });

  it("documents chat automation events and command coverage", () => {
    for (const eventType of ["start", "chunk", "trace", "tool", "usage", "done", "error"]) {
      expect(cliDocs).toContain(`\"${eventType}\"`);
    }
    expect(cliDocs).toContain("mercury chat send");
    expect(cliDocs).toContain("mercury chat title");
    expect(cliDocs).toContain("SIGINT");
  });
});
