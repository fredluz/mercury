#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const DOCS_GUARD_RULES = [
  {
    id: "ipc-preload-contract",
    description:
      "IPC handlers and preload bridge changes should keep the IPC/preload contract current.",
    codePatterns: ["src/main/ipc/**", "src/preload/**"],
    docPatterns: [
      "docs/contracts/ipc-preload.md",
      "docs/architecture/overview.md",
      "docs/testing/contract-tests.md",
    ],
  },
  {
    id: "chat-and-tracing",
    description:
      "Chat, Hermes stream, trace, and Trace Lab changes should keep chat/tracing docs current.",
    codePatterns: [
      "src/main/ipc/chat.ts",
      "src/main/hermes/**",
      "src/main/trace-store.ts",
      "src/shared/traces.ts",
      "src/shared/chat-metadata.ts",
      "src/renderer/src/screens/Chat/**",
      "src/renderer/src/screens/TraceLab/**",
    ],
    docPatterns: [
      "docs/subsystems/chat-and-tracing.md",
      "docs/contracts/trace-schema.md",
      "docs/testing/contract-tests.md",
    ],
  },
  {
    id: "storage-and-profiles",
    description:
      "Storage, profile, model, session, memory, and soul changes should keep storage/profile docs current.",
    codePatterns: [
      "src/main/config.ts",
      "src/main/profiles.ts",
      "src/main/models.ts",
      "src/main/default-models.ts",
      "src/main/sessions.ts",
      "src/main/session-cache.ts",
      "src/main/memory.ts",
      "src/main/soul.ts",
      "src/main/ipc/config.ts",
      "src/main/ipc/sessions.ts",
      "src/main/ipc/models.ts",
      "src/main/ipc/system.ts",
      "src/main/ssh/config.ts",
      "src/main/ssh/sessions-profiles.ts",
      "src/main/ssh/memory-soul.ts",
    ],
    docPatterns: [
      "docs/subsystems/storage-and-profiles.md",
      "docs/testing/contract-tests.md",
    ],
  },
  {
    id: "connection-modes",
    description:
      "Local, SSH, gateway, and connection-mode changes should keep connection docs current.",
    codePatterns: [
      "src/main/hermes/connection.ts",
      "src/main/hermes/gateway.ts",
      "src/main/ssh-tunnel.ts",
      "src/main/ssh-remote.ts",
      "src/main/ssh/runtime.ts",
      "src/main/ssh/transport.ts",
      "src/main/ipc/config.ts",
      "src/main/ipc/gateway.ts",
      "src/main/ipc/install.ts",
      "src/main/ipc/chat.ts",
      "src/main/ipc/knowledge.ts",
      "src/main/ipc/sessions.ts",
      "src/main/ipc/models.ts",
      "src/main/ipc/system.ts",
      "src/renderer/src/App.tsx",
      "src/renderer/src/screens/Layout/**",
      "src/renderer/src/screens/Gateway/**",
    ],
    docPatterns: [
      "docs/subsystems/connection-modes.md",
      "docs/architecture/overview.md",
    ],
  },
  {
    id: "skills-subsystem",
    description:
      "Skill import, install, preload, shared schema, and UI changes should keep skill docs current.",
    codePatterns: [
      "src/main/skills.ts",
      "src/main/skills/**",
      "src/main/ssh/skills.ts",
      "src/main/ipc/knowledge.ts",
      "src/preload/api/knowledge.ts",
      "src/shared/skills.ts",
      "src/renderer/src/screens/Skills/**",
    ],
    docPatterns: [
      "docs/subsystems/skills.md",
      "docs/contracts/ipc-preload.md",
      "docs/testing/contract-tests.md",
    ],
  },
  {
    id: "cli-contract",
    description:
      "CLI command, output, and parity changes should keep the CLI contract current.",
    codePatterns: ["src/cli/**", "tests/cli-*.test.ts"],
    docPatterns: ["docs/contracts/cli.md", "docs/testing/contract-tests.md"],
  },
  {
    id: "contract-tests",
    description:
      "Contract-like test changes should keep the contract-test map current.",
    codePatterns: [
      "tests/ipc-handlers.test.ts",
      "tests/preload-api-surface.test.ts",
      "tests/trace-store.test.ts",
      "tests/skills-import.test.ts",
      "tests/session-cache-sync.test.ts",
      "tests/chat-ipc-lifecycle.test.ts",
      "tests/chat-metadata.test.ts",
      "tests/hermes-title.test.ts",
      "tests/hermes-trace-events.test.ts",
      "tests/profiles.test.ts",
      "tests/sessions-profile-db.test.ts",
      "tests/ssh-remote.test.ts",
      "vitest.config.ts",
    ],
    docPatterns: ["docs/testing/contract-tests.md"],
  },
  {
    id: "brand-docs",
    description:
      "Brand source and asset-generation changes should keep brand docs current.",
    codePatterns: [
      "brand/source/**",
      "scripts/generate-brand-assets.mjs",
      "electron-builder.yml",
    ],
    docPatterns: ["brand/README.md", "docs/architecture/overview.md"],
  },
  {
    id: "docs-guard",
    description:
      "Docs guard implementation and tests should keep guard expectations documented.",
    codePatterns: ["scripts/check-docs.mjs", "tests/docs-guard.test.ts"],
    docPatterns: ["docs/testing/contract-tests.md", "CONTRIBUTING.md"],
  },
];

export function normalizeRepoPath(file) {
  return String(file ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function compareCodeUnits(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function uniqueSorted(files) {
  return [...new Set(files.map(normalizeRepoPath).filter(Boolean))].sort(
    compareCodeUnits,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesPattern(file, pattern) {
  const normalizedFile = normalizeRepoPath(file);
  const normalizedPattern = normalizeRepoPath(pattern);

  if (!normalizedFile || !normalizedPattern) return false;
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
  }
  if (!normalizedPattern.includes("*")) {
    return normalizedFile === normalizedPattern;
  }

  const regexPattern = normalizedPattern
    .split("/")
    .map((segment) => escapeRegExp(segment).replace(/\*/g, "[^/]*"))
    .join("/");
  return new RegExp(`^${regexPattern}$`).test(normalizedFile);
}

export function matchesAnyPattern(file, patterns) {
  return patterns.some((pattern) => matchesPattern(file, pattern));
}

function normalizeAckReason(ackReason) {
  const normalized = String(ackReason ?? "").trim();
  return normalized.length > 0 ? normalized : "";
}

export function evaluateDocsGuard(changedFiles, options = {}) {
  const rules = options.rules ?? DOCS_GUARD_RULES;
  const normalizedFiles = uniqueSorted(changedFiles);
  const ackReason = normalizeAckReason(options.ackReason);

  const triggered = rules
    .map((rule) => {
      const changedCodeFiles = normalizedFiles.filter((file) =>
        matchesAnyPattern(file, rule.codePatterns),
      );
      const matchingDocFiles = normalizedFiles.filter((file) =>
        matchesAnyPattern(file, rule.docPatterns),
      );
      return {
        ruleId: rule.id,
        description: rule.description,
        changedCodeFiles,
        matchingDocFiles,
        requiredDocPatterns: [...rule.docPatterns],
        satisfied: matchingDocFiles.length > 0,
      };
    })
    .filter((ruleResult) => ruleResult.changedCodeFiles.length > 0);

  const failures = triggered
    .filter((ruleResult) => !ruleResult.satisfied)
    .map((ruleResult) => ({
      ruleId: ruleResult.ruleId,
      changedCodeFiles: [...ruleResult.changedCodeFiles],
      requiredDocPatterns: [...ruleResult.requiredDocPatterns],
    }));

  const acknowledged = failures.length > 0 && ackReason.length > 0;

  return {
    ok: failures.length === 0 || acknowledged,
    acknowledged,
    ackReason,
    changedFiles: normalizedFiles,
    triggered,
    failures,
  };
}

export function parseArgs(args) {
  const options = {
    staged: false,
    base: "",
    head: "",
    ackReason: "",
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--staged") {
      options.staged = true;
    } else if (arg === "--base") {
      options.base = readRequiredArgValue(args, (index += 1), "--base");
    } else if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
    } else if (arg === "--head") {
      options.head = readRequiredArgValue(args, (index += 1), "--head");
    } else if (arg.startsWith("--head=")) {
      options.head = arg.slice("--head=".length);
    } else if (arg === "--ack") {
      options.ackReason = readRequiredArgValue(args, (index += 1), "--ack");
    } else if (arg.startsWith("--ack=")) {
      options.ackReason = arg.slice("--ack=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.staged && options.base) {
    throw new Error("Use either --staged or --base, not both.");
  }
  if (options.head && !options.base) {
    throw new Error("--head requires --base <ref>.");
  }

  return options;
}

function readRequiredArgValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

export function getChangedFiles(options = {}) {
  if (options.staged) {
    return uniqueSorted(
      runGit(["diff", "--cached", "--name-only", "-z", "--"]),
    );
  }

  if (options.base) {
    const head = options.head || "HEAD";
    return uniqueSorted(
      runGit(["diff", "--name-only", "-z", `${options.base}...${head}`, "--"]),
    );
  }

  return uniqueSorted([
    ...runGit(["diff", "--name-only", "-z", "--"]),
    ...runGit(["diff", "--cached", "--name-only", "-z", "--"]),
    ...runGit(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
}

function printHelp() {
  console.log(
    `Usage: node scripts/check-docs.mjs [options]\n\nOptions:\n  --staged              Check staged changes only.\n  --base <ref>          Check changes from merge-base against a base ref.\n  --head <ref>          Head ref to compare with --base (default: HEAD).\n  --ack <reason>        Acknowledge that triggered docs updates are not needed.\n  -h, --help            Show this help.\n\nAcknowledgement can also be supplied with MERCURY_DOCS_GUARD_ACK.`,
  );
}

function formatList(items) {
  return items.map((item) => `    - ${item}`).join("\n");
}

function printReport(result, sourceDescription) {
  console.log(
    `Docs guard checked ${result.changedFiles.length} changed file(s) from ${sourceDescription}.`,
  );

  if (result.changedFiles.length === 0) {
    console.log("No changed files detected.");
    return;
  }

  if (result.triggered.length === 0) {
    console.log("No high-risk docs rules triggered.");
    return;
  }

  console.log("\nTriggered docs rules:");
  for (const ruleResult of result.triggered) {
    const marker = ruleResult.satisfied ? "✓" : result.acknowledged ? "!" : "✗";
    console.log(`  ${marker} ${ruleResult.ruleId} — ${ruleResult.description}`);
    console.log("    Changed code/test/script files:");
    console.log(formatList(ruleResult.changedCodeFiles));

    if (ruleResult.matchingDocFiles.length > 0) {
      console.log("    Matching evergreen docs changed:");
      console.log(formatList(ruleResult.matchingDocFiles));
    } else {
      console.log("    Required evergreen docs (one or more):");
      console.log(formatList(ruleResult.requiredDocPatterns));
    }
  }

  if (result.failures.length === 0) {
    console.log("\nDocs guard passed.");
    return;
  }

  if (result.acknowledged) {
    console.warn(`\nDocs guard acknowledged: ${result.ackReason}`);
    console.warn(
      "Triggered rules are allowed because an explicit acknowledgement was provided.",
    );
    return;
  }

  console.error("\nDocs guard failed.");
  console.error(
    'Update a matching evergreen doc, or acknowledge with --ack "reason" / MERCURY_DOCS_GUARD_ACK if no doc update is needed.',
  );
  console.error(
    "Historical docs under docs/investigations/** do not satisfy rules unless a rule explicitly maps them.",
  );
}

function describeSource(options) {
  if (options.staged) return "staged changes";
  if (options.base) return `${options.base}...${options.head || "HEAD"}`;
  return "unstaged, staged, and untracked files";
}

function main() {
  try {
    const cliOptions = parseArgs(process.argv.slice(2));
    if (cliOptions.help) {
      printHelp();
      return;
    }

    const ackReason =
      cliOptions.ackReason || process.env.MERCURY_DOCS_GUARD_ACK || "";
    const changedFiles = getChangedFiles(cliOptions);
    const result = evaluateDocsGuard(changedFiles, { ackReason });
    printReport(result, describeSource(cliOptions));

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (currentFile === invokedFile) {
  main();
}
