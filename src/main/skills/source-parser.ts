import type { ParsedSkillSource } from "../../shared/skills";

export type SkillSourceParseErrorCode = "invalid-source" | "unsupported-source";

export type SkillSourceParseResult =
  | { success: true; source: ParsedSkillSource }
  | { success: false; code: SkillSourceParseErrorCode; error: string };

type CommandSplitResult =
  | { success: true; tokens: string[] }
  | { success: false; error: string };

const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]+$/;
const IGNORED_BOOLEAN_FLAGS = new Set([
  "-g",
  "--global",
  "-y",
  "--yes",
  "--copy",
  "--symlink",
]);
const IGNORED_VALUE_FLAGS = new Set(["-a", "--agent"]);

export function splitSkillSourceCommand(input: string): CommandSplitResult {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (char === "\\") {
      if (i + 1 < input.length) {
        current += input[i + 1];
        i += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    return { success: false, error: "Command contains an unterminated quote." };
  }

  if (current) tokens.push(current);
  return { success: true, tokens };
}

export function parseSkillSource(input: string): SkillSourceParseResult {
  const originalSource = input.trim();
  if (!originalSource) {
    return {
      success: false,
      code: "invalid-source",
      error: "A GitHub skill source or supported install command is required.",
    };
  }

  if (/^(?:npx|gh)(?:\s|$)/.test(originalSource)) {
    return parseInstallCommand(originalSource);
  }

  return parseGitHubSource(originalSource, originalSource);
}

function parseInstallCommand(command: string): SkillSourceParseResult {
  const split = splitSkillSourceCommand(command);
  if (!split.success) {
    return { success: false, code: "invalid-source", error: split.error };
  }

  const { tokens } = split;
  if (tokens[0] === "npx") return parseNpxSkillsAdd(tokens, command);
  if (tokens[0] === "gh") return parseGhSkillInstall(tokens, command);

  return unsupportedSource();
}

function parseNpxSkillsAdd(
  tokens: string[],
  originalSource: string,
): SkillSourceParseResult {
  const skillsIndex = tokens.indexOf("skills", 1);
  if (skillsIndex < 0 || tokens[skillsIndex + 1] !== "add") {
    return unsupportedSource(
      "Only pasted `npx skills add <source>` commands are supported.",
    );
  }

  const npxFlags = tokens.slice(1, skillsIndex);
  if (!npxFlags.every((token) => token === "-y" || token === "--yes")) {
    return unsupportedSource(
      "Only `-y`/`--yes` npx flags are supported before `skills add`.",
    );
  }

  const parsed = extractNpxAddArguments(tokens.slice(skillsIndex + 2));
  if (!parsed.success) return parsed;
  if (!parsed.source) {
    return {
      success: false,
      code: "invalid-source",
      error: "The npx skills add command is missing a source.",
    };
  }

  const result = parseGitHubSource(parsed.source, originalSource);
  if (!result.success) return result;

  return {
    success: true,
    source: {
      ...result.source,
      skillSelector: parsed.skillSelector ?? result.source.skillSelector,
    },
  };
}

function parseGhSkillInstall(
  tokens: string[],
  originalSource: string,
): SkillSourceParseResult {
  if (tokens[1] !== "skill" || tokens[2] !== "install") {
    return unsupportedSource(
      "Only pasted `gh skill install OWNER/REPO SKILL` commands are supported.",
    );
  }

  const positionals = tokens.slice(3).filter((token) => !token.startsWith("-"));
  if (positionals.length < 1) {
    return {
      success: false,
      code: "invalid-source",
      error: "The gh skill install command is missing an OWNER/REPO source.",
    };
  }
  if (positionals.length > 2) {
    return unsupportedSource(
      "The gh skill install command contains extra positional arguments.",
    );
  }

  const result = parseGitHubSource(positionals[0], originalSource);
  if (!result.success) return result;

  return {
    success: true,
    source: {
      ...result.source,
      skillSelector: positionals[1] ?? result.source.skillSelector,
    },
  };
}

function extractNpxAddArguments(
  args: string[],
):
  | { success: true; source?: string; skillSelector?: string }
  | { success: false; code: SkillSourceParseErrorCode; error: string } {
  let source: string | undefined;
  let skillSelector: string | undefined;
  const extras: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === "--skill") {
      if (!args[i + 1]) {
        return {
          success: false,
          code: "invalid-source",
          error: "--skill requires a value.",
        };
      }
      skillSelector = args[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--skill=")) {
      const value = token.slice("--skill=".length);
      if (!value) {
        return {
          success: false,
          code: "invalid-source",
          error: "--skill requires a value.",
        };
      }
      skillSelector = value;
      continue;
    }

    if (IGNORED_BOOLEAN_FLAGS.has(token)) continue;

    if (IGNORED_VALUE_FLAGS.has(token)) {
      if (!args[i + 1]) {
        return {
          success: false,
          code: "invalid-source",
          error: `${token} requires a value.`,
        };
      }
      i += 1;
      continue;
    }

    if (token.startsWith("--agent=")) continue;

    if (token.startsWith("-")) {
      return unsupportedSource(`Unsupported npx skills flag: ${token}`);
    }

    if (!source) source = token;
    else extras.push(token);
  }

  if (extras.length > 0) {
    return unsupportedSource(
      "The npx skills add command contains extra positional arguments.",
    );
  }

  return { success: true, source, skillSelector };
}

function parseGitHubSource(
  source: string,
  originalSource: string,
): SkillSourceParseResult {
  const ssh = source.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (ssh) {
    return buildRepoSource(
      ssh[1],
      stripGitSuffix(ssh[2]),
      originalSource,
      "repo",
    );
  }

  // owner/repo, optionally followed by a skill subpath (e.g. owner/repo/tdd or
  // owner/repo/skills/tdd). The final path segment is treated as the skill
  // selector, matching the `skills` CLI's `npx skills add owner/repo/skill` form.
  const shorthand = source.match(/^([^/\s:]+)\/([^/\s]+)(?:\/([^\s]+))?$/);
  if (shorthand && !source.includes("://") && GITHUB_OWNER_RE.test(shorthand[1])) {
    const built = buildRepoSource(
      shorthand[1],
      stripGitSuffix(shorthand[2]),
      originalSource,
      "repo",
    );
    if (!built.success) return built;

    const subpath = shorthand[3]?.split("/").filter(Boolean) ?? [];
    const selector = subpath.at(-1);
    if (!selector) return built;

    return {
      success: true,
      source: { ...built.source, skillSelector: selector },
    };
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return unsupportedSource(
      "Only GitHub repository sources and supported install commands are supported.",
    );
  }

  if (url.protocol !== "https:") {
    return unsupportedSource("Only HTTPS GitHub sources are supported.");
  }

  if (url.hostname === "github.com" || url.hostname === "www.github.com") {
    return parseGitHubWebUrl(url, originalSource);
  }

  if (url.hostname === "raw.githubusercontent.com") {
    return parseRawGitHubUrl(url, originalSource);
  }

  return unsupportedSource(
    "Only github.com and raw.githubusercontent.com sources are supported.",
  );
}

function parseGitHubWebUrl(
  url: URL,
  originalSource: string,
): SkillSourceParseResult {
  const segments = pathSegments(url);
  if (segments.length < 2) return invalidGitHubSource();

  const [owner, repoSegment, mode, ...rest] = segments;
  const repo = stripGitSuffix(repoSegment);

  if (!mode) return buildRepoSource(owner, repo, originalSource, "repo");

  if ((mode === "tree" || mode === "blob") && rest.length > 0) {
    const built = buildRepoSource(owner, repo, originalSource, mode);
    if (!built.success) return built;
    return {
      success: true,
      source: {
        ...built.source,
        rawRefAndPath: rest,
      },
    };
  }

  return unsupportedSource(
    "GitHub URLs must point to a repository, tree, blob, or raw SKILL.md source.",
  );
}

function parseRawGitHubUrl(
  url: URL,
  originalSource: string,
): SkillSourceParseResult {
  const segments = pathSegments(url);
  if (segments.length < 4) return invalidGitHubSource();

  const [owner, repo, ...rawRefAndPath] = segments;
  const built = buildRepoSource(
    owner,
    stripGitSuffix(repo),
    originalSource,
    "raw",
  );
  if (!built.success) return built;

  return {
    success: true,
    source: {
      ...built.source,
      rawRefAndPath,
    },
  };
}

function buildRepoSource(
  owner: string,
  repo: string,
  originalSource: string,
  pathKind: ParsedSkillSource["pathKind"],
): SkillSourceParseResult {
  if (!GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_RE.test(repo)) {
    return invalidGitHubSource();
  }

  return {
    success: true,
    source: {
      kind: "github",
      owner,
      repo,
      originalSource,
      pathKind,
    },
  };
}

function pathSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function stripGitSuffix(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

type SkillSourceParseFailure = Extract<
  SkillSourceParseResult,
  { success: false }
>;

function invalidGitHubSource(): SkillSourceParseFailure {
  return {
    success: false,
    code: "invalid-source",
    error: "GitHub source must include a valid owner and repository name.",
  };
}

function unsupportedSource(
  error = "This skill source is not supported yet.",
): SkillSourceParseFailure {
  return { success: false, code: "unsupported-source", error };
}
