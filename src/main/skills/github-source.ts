import type {
  ParsedSkillSource,
  SkillSourceCandidate,
  SkillSourceCandidateId,
  SkillSourceFailureCode,
  SkillSourceImportRequest,
} from "../../shared/skills";
import { prepareSkillMarkdownImport } from "./importer";
import { fetchBytes, fetchJson, fetchText, HttpFetchError } from "./http-fetch";

export type GitHubSourceOverrides = Pick<
  SkillSourceImportRequest,
  "skillSelector" | "name" | "category" | "description" | "directoryName"
>;

export type GitHubSkillSourceFile = {
  relativePath: string;
  contentBase64: string;
};

export type GitHubSkillDirectoryResult =
  | {
      success: true;
      candidate: SkillSourceCandidate;
      files: GitHubSkillSourceFile[];
    }
  | GitHubSourceFailure;

export type GitHubCandidateResult =
  | { success: true; candidates: SkillSourceCandidate[] }
  | GitHubSourceFailure;

type GitHubSourceFailure = {
  success: false;
  code: Extract<
    SkillSourceFailureCode,
    | "invalid-source"
    | "fetch-failed"
    | "rate-limited"
    | "source-too-large"
    | "not-found"
    | "multiple-candidates"
    | "invalid-markdown"
  >;
  error: string;
  candidates?: SkillSourceCandidate[];
};

type GitHubRef = {
  ref: string;
  object: { sha: string; type: string };
};

type GitHubRepo = { default_branch?: string };

type GitHubCommit = {
  sha: string;
  tree?: { sha: string };
  commit?: { tree?: { sha: string } };
};

type GitHubTag = { object?: { sha: string; type: string } };

type GitHubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit" | string;
  sha: string;
  size?: number;
};

type GitHubTree = {
  sha: string;
  truncated?: boolean;
  tree: GitHubTreeEntry[];
};

type ResolvedGitHubSource = {
  owner: string;
  repo: string;
  commitSha: string;
  treeSha: string;
  path?: string;
  pathKind: ParsedSkillSource["pathKind"];
};

const API_ROOT = "https://api.github.com/repos";
const RAW_ROOT = "https://raw.githubusercontent.com";
const SKILL_MARKDOWN_MAX_BYTES = 200_000;
const MAX_SKILL_FILES = 100;
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const CATEGORY_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COMMIT_SHA_RE = /^[a-f0-9]{40}$/i;
const KNOWN_CONTAINERS = [
  "skills",
  ".agents/skills",
  ".claude/skills",
  ".github/skills",
] as const;

export async function resolveGitHubSkillCandidates(
  parsed: ParsedSkillSource,
  overrides: GitHubSourceOverrides = {},
): Promise<GitHubCandidateResult> {
  const resolved = await resolveGitHubSource(parsed);
  if (!resolved.success) return resolved;

  const discovered = await discoverSkillPaths(
    resolved.source,
    overrides.skillSelector ?? parsed.skillSelector,
  );
  if (!discovered.success) return discovered;

  const candidates: SkillSourceCandidate[] = [];
  for (const skillPath of discovered.paths) {
    const markdown = await fetchRawSkillMarkdown(
      resolved.source.owner,
      resolved.source.repo,
      resolved.source.commitSha,
      skillPath,
    );
    if (!markdown.success) return markdown;
    candidates.push(
      buildCandidate(resolved.source, skillPath, markdown.markdown, overrides),
    );
  }

  if (candidates.length === 0) {
    return {
      success: false,
      code: "not-found",
      error: "No SKILL.md files were found for this GitHub source.",
    };
  }

  return { success: true, candidates };
}

export async function fetchPinnedGitHubSkillDirectory(
  owner: string,
  repo: string,
  commitSha: string,
  skillPath: string,
  overrides: GitHubSourceOverrides = {},
): Promise<GitHubSkillDirectoryResult> {
  if (!COMMIT_SHA_RE.test(commitSha) || !isSkillMarkdownPath(skillPath)) {
    return {
      success: false,
      code: "invalid-source",
      error: "Candidate id must pin a commit SHA and SKILL.md path.",
    };
  }

  const commit = await fetchGitCommit(owner, repo, commitSha);
  if (!commit.success) return commit;

  const markdown = await fetchRawSkillMarkdown(owner, repo, commit.sha, skillPath);
  if (!markdown.success) return markdown;

  const resolved: ResolvedGitHubSource = {
    owner,
    repo,
    commitSha: commit.sha,
    treeSha: commit.treeSha,
    path: skillPath,
    pathKind: "blob",
  };
  const candidate = buildCandidate(resolved, skillPath, markdown.markdown, overrides);
  if (!candidate.valid) {
    return {
      success: false,
      code: "invalid-markdown",
      error: candidate.error ?? "Selected candidate is not a valid skill.",
    };
  }

  const files = await fetchDirectoryFiles(resolved, skillPath);
  if (!files.success) return files;
  return { success: true, candidate, files: files.files };
}

export function parseGitHubCandidateId(candidateId: string):
  | {
      success: true;
      owner: string;
      repo: string;
      commitSha: string;
      skillPath: string;
    }
  | { success: false; error: string } {
  const match = candidateId.match(/^github:([^/]+)\/([^@]+)@([a-f0-9]{40}):(.+)$/i);
  if (!match || !isSkillMarkdownPath(match[4])) {
    return {
      success: false,
      error: "Candidate id must have the form github:owner/repo@<commitSha>:<path>/SKILL.md.",
    };
  }
  return {
    success: true,
    owner: match[1],
    repo: match[2],
    commitSha: match[3],
    skillPath: normalizeGitPath(match[4]),
  };
}

async function resolveGitHubSource(parsed: ParsedSkillSource): Promise<
  | { success: true; source: ResolvedGitHubSource }
  | GitHubSourceFailure
> {
  if (parsed.kind !== "github") {
    return {
      success: false,
      code: "invalid-source",
      error: "Only GitHub skill sources are supported.",
    };
  }

  if (parsed.pathKind === "repo") {
    const defaultBranch = await fetchDefaultBranch(parsed.owner, parsed.repo);
    if (!defaultBranch.success) return defaultBranch;
    const commit = await fetchCommitish(parsed.owner, parsed.repo, defaultBranch.ref);
    if (!commit.success) return commit;
    return {
      success: true,
      source: {
        owner: parsed.owner,
        repo: parsed.repo,
        commitSha: commit.sha,
        treeSha: commit.treeSha,
        pathKind: parsed.pathKind,
      },
    };
  }

  const split = await resolveRawRefAndPath(parsed);
  if (!split.success) return split;
  const commit = await fetchCommitFromRefObject(
    parsed.owner,
    parsed.repo,
    split.ref,
  );
  if (!commit.success) return commit;

  return {
    success: true,
    source: {
      owner: parsed.owner,
      repo: parsed.repo,
      commitSha: commit.sha,
      treeSha: commit.treeSha,
      path: split.path,
      pathKind: parsed.pathKind,
    },
  };
}

async function resolveRawRefAndPath(parsed: ParsedSkillSource): Promise<
  | { success: true; ref: GitHubRef; path: string }
  | GitHubSourceFailure
> {
  const raw = parsed.rawRefAndPath ?? [];
  if (raw.length < 2) {
    return {
      success: false,
      code: "invalid-source",
      error: "GitHub tree/blob/raw sources must include a ref and path.",
    };
  }

  if (COMMIT_SHA_RE.test(raw[0])) {
    const path = normalizeGitPath(raw.slice(1).join("/"));
    if (!isValidResolvedPath(parsed.pathKind, path)) {
      return invalidResolvedPath(parsed.pathKind);
    }
    return {
      success: true,
      ref: { ref: raw[0], object: { sha: raw[0], type: "commit" } },
      path,
    };
  }

  const firstSegment = raw[0];
  const [heads, tags] = await Promise.all([
    fetchMatchingRefs(parsed.owner, parsed.repo, "heads", firstSegment),
    fetchMatchingRefs(parsed.owner, parsed.repo, "tags", firstSegment),
  ]);
  if (!heads.success) return heads;
  if (!tags.success) return tags;

  const headMatches = matchingRawTailRefs(heads.refs, "refs/heads/", raw);
  const tagMatches = matchingRawTailRefs(tags.refs, "refs/tags/", raw);
  const bestHead = headMatches[0];
  const bestTag = tagMatches[0];
  if (!bestHead && !bestTag) {
    return {
      success: false,
      code: "not-found",
      error: "Could not resolve the GitHub URL ref. Use a direct branch/tag path or pinned commit URL.",
    };
  }

  if (bestHead && bestTag && bestHead.segmentCount === bestTag.segmentCount) {
    return {
      success: false,
      code: "invalid-source",
      error: "GitHub source is ambiguous because a branch and tag match the same ref path.",
    };
  }

  const best = bestHead && (!bestTag || bestHead.segmentCount > bestTag.segmentCount)
    ? bestHead
    : bestTag!;
  const path = normalizeGitPath(raw.slice(best.segmentCount).join("/"));
  if (!isValidResolvedPath(parsed.pathKind, path)) {
    return invalidResolvedPath(parsed.pathKind);
  }

  return { success: true, ref: best.ref, path };
}

function matchingRawTailRefs(
  refs: GitHubRef[],
  prefix: "refs/heads/" | "refs/tags/",
  raw: string[],
): Array<{ ref: GitHubRef; segmentCount: number }> {
  return refs
    .map((ref) => {
      const name = ref.ref.startsWith(prefix) ? ref.ref.slice(prefix.length) : "";
      const segments = name.split("/").filter(Boolean);
      const matches =
        segments.length > 0 &&
        segments.length < raw.length &&
        segments.every((segment, index) => segment === raw[index]);
      return matches ? { ref, segmentCount: segments.length } : null;
    })
    .filter((value): value is { ref: GitHubRef; segmentCount: number } => Boolean(value))
    .sort((a, b) => b.segmentCount - a.segmentCount);
}

async function discoverSkillPaths(
  source: ResolvedGitHubSource,
  skillSelector?: string,
): Promise<{ success: true; paths: string[] } | GitHubSourceFailure> {
  const selector = skillSelector?.trim();
  if (source.pathKind === "blob" || source.pathKind === "raw") {
    const path = source.path ? normalizeGitPath(source.path) : "";
    if (!isSkillMarkdownPath(path)) return invalidResolvedPath(source.pathKind);
    if (selector && !skillPathMatchesSelector(path, selector, source.repo)) {
      return {
        success: false,
        code: "not-found",
        error: `No SKILL.md file matched selector '${selector}'.`,
      };
    }
    return { success: true, paths: [path] };
  }

  const tree = await fetchGitTree(source.owner, source.repo, source.treeSha, true);
  if (!tree.success) return tree;

  if (tree.truncated) {
    return discoverFromTruncatedTree(source, selector);
  }

  const paths = collectSkillPaths(tree.tree, source.path, selector, source.repo);
  return { success: true, paths };
}

async function discoverFromTruncatedTree(
  source: ResolvedGitHubSource,
  selector?: string,
): Promise<{ success: true; paths: string[] } | GitHubSourceFailure> {
  if (source.path) {
    const scoped = await discoverFromScopedPath(source, source.path, selector);
    if (!scoped.success) return scoped;
    return scoped;
  }

  const root = await fetchGitTree(source.owner, source.repo, source.treeSha, false);
  if (!root.success) return root;

  const paths = new Set<string>();
  if (root.tree.some((entry) => entry.type === "blob" && entry.path === "SKILL.md")) {
    if (!selector || skillPathMatchesSelector("SKILL.md", selector, source.repo)) {
      paths.add("SKILL.md");
    }
  }

  for (const container of KNOWN_CONTAINERS) {
    const found = await scanKnownContainer(source, root.tree, container, selector);
    if (!found.success) return found;
    for (const path of found.paths) paths.add(path);
  }

  return { success: true, paths: [...paths].sort() };
}

async function discoverFromScopedPath(
  source: ResolvedGitHubSource,
  scopedPath: string,
  selector?: string,
): Promise<{ success: true; paths: string[] } | GitHubSourceFailure> {
  const normalized = normalizeGitPath(scopedPath);
  if (isSkillMarkdownPath(normalized)) return { success: true, paths: [normalized] };

  const subtree = await fetchSubtree(source, normalized);
  if (!subtree.success) return subtree;
  const recursive = await fetchGitTree(source.owner, source.repo, subtree.treeSha, true);
  if (!recursive.success) return recursive;
  if (recursive.truncated) {
    return {
      success: false,
      code: "source-too-large",
      error: "Selected GitHub skill subtree is too large to scan safely.",
    };
  }
  const prefixed = recursive.tree.map((entry) => ({
    ...entry,
    path: joinGitPath(normalized, entry.path),
  }));
  return { success: true, paths: collectSkillPaths(prefixed, normalized, selector, source.repo) };
}

async function scanKnownContainer(
  source: ResolvedGitHubSource,
  rootTree: GitHubTreeEntry[],
  container: string,
  selector?: string,
): Promise<{ success: true; paths: string[] } | GitHubSourceFailure> {
  const containerTree = await findSubtreeFromRoot(source, rootTree, container);
  if (!containerTree.success) {
    if (containerTree.code === "not-found") return { success: true, paths: [] };
    return containerTree;
  }

  const paths: string[] = [];
  const firstLevel = await fetchGitTree(
    source.owner,
    source.repo,
    containerTree.treeSha,
    false,
  );
  if (!firstLevel.success) return firstLevel;

  for (const entry of firstLevel.tree) {
    if (entry.type !== "tree") continue;
    const skillMd = await treeHasSkillMarkdown(source, entry.sha);
    if (!skillMd.success) return skillMd;
    if (skillMd.hasSkillMarkdown) {
      const path = joinGitPath(container, entry.path, "SKILL.md");
      if (!selector || skillPathMatchesSelector(path, selector, source.repo)) {
        paths.push(path);
      }
      continue;
    }

    if (container !== "skills") continue;
    const categoryTree = await fetchGitTree(source.owner, source.repo, entry.sha, false);
    if (!categoryTree.success) return categoryTree;
    for (const skillEntry of categoryTree.tree) {
      if (skillEntry.type !== "tree") continue;
      const nestedSkillMd = await treeHasSkillMarkdown(source, skillEntry.sha);
      if (!nestedSkillMd.success) return nestedSkillMd;
      if (nestedSkillMd.hasSkillMarkdown) {
        const path = joinGitPath(container, entry.path, skillEntry.path, "SKILL.md");
        if (!selector || skillPathMatchesSelector(path, selector, source.repo)) {
          paths.push(path);
        }
      }
    }
  }

  return { success: true, paths };
}

async function treeHasSkillMarkdown(
  source: ResolvedGitHubSource,
  treeSha: string,
): Promise<{ success: true; hasSkillMarkdown: boolean } | GitHubSourceFailure> {
  const tree = await fetchGitTree(source.owner, source.repo, treeSha, false);
  if (!tree.success) return tree;
  return {
    success: true,
    hasSkillMarkdown: tree.tree.some(
      (entry) => entry.type === "blob" && entry.path === "SKILL.md",
    ),
  };
}

function collectSkillPaths(
  entries: GitHubTreeEntry[],
  scopedPath: string | undefined,
  selector: string | undefined,
  repo: string,
): string[] {
  const scope = scopedPath ? normalizeGitPath(scopedPath) : "";
  const paths = entries
    .filter((entry) => entry.type === "blob" && isAllowedBlobMode(entry.mode))
    .map((entry) => normalizeGitPath(entry.path))
    .filter((path) => isCandidateSkillPath(path))
    .filter((path) => pathMatchesScope(path, scope))
    .filter((path) => !selector || skillPathMatchesSelector(path, selector, repo));
  return [...new Set(paths)].sort();
}

function pathMatchesScope(path: string, scope: string): boolean {
  if (!scope) return true;
  if (isSkillMarkdownPath(scope)) return path === scope;
  return path === joinGitPath(scope, "SKILL.md") || path.startsWith(`${scope}/`);
}

function isCandidateSkillPath(path: string): boolean {
  if (path === "SKILL.md") return true;
  const segments = path.split("/");
  if (segments.at(-1) !== "SKILL.md") return false;
  if (segments[0] === "skills") {
    return segments.length === 3 || segments.length === 4;
  }
  if (
    (segments[0] === ".agents" || segments[0] === ".claude" || segments[0] === ".github") &&
    segments[1] === "skills"
  ) {
    return segments.length === 4;
  }
  return false;
}

function buildCandidate(
  source: ResolvedGitHubSource,
  skillPath: string,
  markdown: string,
  overrides: GitHubSourceOverrides,
): SkillSourceCandidate {
  const category = inferCategory(skillPath, overrides.category);
  const prepared = prepareSkillMarkdownImport({
    markdown,
    name: overrides.name,
    category,
    description: overrides.description,
  });

  const parentBasename = basenameGitPath(dirnameGitPath(skillPath));
  const overrideDirectory = overrides.directoryName?.trim();
  const directoryName =
    overrideDirectory && SKILL_SLUG_RE.test(overrideDirectory)
      ? overrideDirectory
      : skillPath !== "SKILL.md" && SKILL_SLUG_RE.test(parentBasename)
        ? parentBasename
        : prepared.success
          ? prepared.prepared.name
          : parentBasename || source.repo;

  const valid = prepared.success && SKILL_SLUG_RE.test(directoryName);
  const error = !prepared.success
    ? prepared.error
    : !SKILL_SLUG_RE.test(directoryName)
      ? "Skill directory name must be a slug: 2-64 lowercase letters, numbers, underscores, or hyphens."
      : undefined;

  return {
    candidateId: candidateId(source.owner, source.repo, source.commitSha, skillPath),
    name: prepared.success ? prepared.prepared.name : overrides.name?.trim() || parentBasename || source.repo,
    category: prepared.success ? prepared.prepared.category : category,
    directoryName,
    description: prepared.success ? prepared.prepared.description : "",
    skillPath,
    sourceLabel: `${source.owner}/${source.repo}:${skillPath}`,
    commitSha: source.commitSha,
    treeSha: source.treeSha,
    valid,
    markdown: prepared.success ? prepared.prepared.markdown : markdown,
    ...(error ? { error } : {}),
  };
}

async function fetchDirectoryFiles(
  source: ResolvedGitHubSource,
  skillPath: string,
): Promise<{ success: true; files: GitHubSkillSourceFile[] } | GitHubSourceFailure> {
  const directory = dirnameGitPath(skillPath);
  const tree = await fetchTreeForDirectory(source, directory);
  if (!tree.success) return tree;

  const prefix = directory ? `${directory}/` : "";
  const entries = tree.tree
    .map((entry) => ({ ...entry, path: tree.prefix ? joinGitPath(tree.prefix, entry.path) : entry.path }))
    .filter((entry) => pathIsInDirectory(entry.path, directory));

  const unsafe = entries.find(
    (entry) => entry.type === "commit" || entry.mode === "120000" || entry.type === "tree",
  );
  if (unsafe?.type === "commit" || unsafe?.mode === "120000") {
    return {
      success: false,
      code: "source-too-large",
      error: "GitHub skill directories cannot include submodules or symlinks.",
    };
  }

  const fileEntries = entries.filter(
    (entry) => entry.type === "blob" && isAllowedBlobMode(entry.mode),
  );
  if (!fileEntries.some((entry) => entry.path === skillPath)) {
    return {
      success: false,
      code: "not-found",
      error: "Selected GitHub skill directory does not contain SKILL.md.",
    };
  }
  if (fileEntries.length > MAX_SKILL_FILES) {
    return {
      success: false,
      code: "source-too-large",
      error: `Skill directory contains more than ${MAX_SKILL_FILES} files.`,
    };
  }
  const totalSize = fileEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  if (totalSize > MAX_SKILL_BYTES) {
    return {
      success: false,
      code: "source-too-large",
      error: `Skill directory is larger than ${MAX_SKILL_BYTES} bytes.`,
    };
  }

  const files: GitHubSkillSourceFile[] = [];
  for (const entry of fileEntries.sort((a, b) => {
    if (a.path === skillPath) return -1;
    if (b.path === skillPath) return 1;
    return a.path.localeCompare(b.path);
  })) {
    const bytes = await fetchRawBytes(
      source.owner,
      source.repo,
      source.commitSha,
      entry.path,
      Math.min(MAX_SKILL_BYTES, entry.size ?? MAX_SKILL_BYTES),
    );
    if (!bytes.success) return bytes;
    files.push({
      relativePath: prefix ? entry.path.slice(prefix.length) : entry.path,
      contentBase64: Buffer.from(bytes.bytes).toString("base64"),
    });
  }

  return { success: true, files };
}

async function fetchTreeForDirectory(
  source: ResolvedGitHubSource,
  directory: string,
): Promise<
  | { success: true; tree: GitHubTreeEntry[]; prefix?: string }
  | GitHubSourceFailure
> {
  const tree = await fetchGitTree(source.owner, source.repo, source.treeSha, true);
  if (!tree.success) return tree;
  if (!tree.truncated) return { success: true, tree: tree.tree };

  if (!directory) {
    return {
      success: false,
      code: "source-too-large",
      error: "Repository tree is too large to download the root skill safely.",
    };
  }

  const subtree = await fetchSubtree(source, directory);
  if (!subtree.success) return subtree;
  const scoped = await fetchGitTree(source.owner, source.repo, subtree.treeSha, true);
  if (!scoped.success) return scoped;
  if (scoped.truncated) {
    return {
      success: false,
      code: "source-too-large",
      error: "Selected GitHub skill directory is too large to download safely.",
    };
  }
  return { success: true, tree: scoped.tree, prefix: directory };
}

function pathIsInDirectory(path: string, directory: string): boolean {
  if (!directory) return !path.includes("/") || path.startsWith("");
  return path.startsWith(`${directory}/`);
}

async function fetchSubtree(
  source: ResolvedGitHubSource,
  path: string,
): Promise<{ success: true; treeSha: string } | GitHubSourceFailure> {
  return findSubtree(source.owner, source.repo, source.treeSha, path);
}

async function findSubtreeFromRoot(
  source: ResolvedGitHubSource,
  rootTree: GitHubTreeEntry[],
  path: string,
): Promise<{ success: true; treeSha: string } | GitHubSourceFailure> {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return { success: true, treeSha: source.treeSha };
  const first = rootTree.find(
    (entry) => entry.type === "tree" && entry.path === segments[0],
  );
  if (!first) {
    return { success: false, code: "not-found", error: "Subtree not found." };
  }
  if (segments.length === 1) return { success: true, treeSha: first.sha };
  return findSubtree(source.owner, source.repo, first.sha, segments.slice(1).join("/"));
}

async function findSubtree(
  owner: string,
  repo: string,
  rootTreeSha: string,
  path: string,
): Promise<{ success: true; treeSha: string } | GitHubSourceFailure> {
  const segments = normalizeGitPath(path).split("/").filter(Boolean);
  let currentTreeSha = rootTreeSha;
  for (const segment of segments) {
    const tree = await fetchGitTree(owner, repo, currentTreeSha, false);
    if (!tree.success) return tree;
    const next = tree.tree.find(
      (entry) => entry.type === "tree" && entry.path === segment,
    );
    if (!next) {
      return {
        success: false,
        code: "not-found",
        error: `GitHub path '${path}' was not found as a directory.`,
      };
    }
    currentTreeSha = next.sha;
  }
  return { success: true, treeSha: currentTreeSha };
}

function inferCategory(skillPath: string, explicitCategory?: string): string {
  if (explicitCategory?.trim()) return explicitCategory.trim();
  const segments = skillPath.split("/");
  if (
    segments[0] === "skills" &&
    segments.length === 4 &&
    CATEGORY_SLUG_RE.test(segments[1]) &&
    SKILL_SLUG_RE.test(segments[2])
  ) {
    return segments[1];
  }
  return "custom";
}

function skillPathMatchesSelector(path: string, selector: string, repo: string): boolean {
  const normalized = selector.trim().toLowerCase();
  if (!normalized) return true;
  const parent = basenameGitPath(dirnameGitPath(path)).toLowerCase();
  return parent === normalized || (path === "SKILL.md" && repo.toLowerCase() === normalized);
}

function candidateId(
  owner: string,
  repo: string,
  commitSha: string,
  skillPath: string,
): SkillSourceCandidateId {
  return `github:${owner}/${repo}@${commitSha}:${skillPath}` as SkillSourceCandidateId;
}

function isValidResolvedPath(
  pathKind: ParsedSkillSource["pathKind"],
  path: string,
): boolean {
  if (!path || path.includes("\0") || path.split("/").includes("..")) return false;
  return pathKind === "tree" || isSkillMarkdownPath(path);
}

function invalidResolvedPath(pathKind: ParsedSkillSource["pathKind"]): GitHubSourceFailure {
  return {
    success: false,
    code: "invalid-source",
    error:
      pathKind === "tree"
        ? "GitHub tree source must resolve to a valid repository path."
        : "GitHub blob/raw source must resolve to a SKILL.md file.",
  };
}

function isSkillMarkdownPath(path: string): boolean {
  return path === "SKILL.md" || path.endsWith("/SKILL.md");
}

function isAllowedBlobMode(mode: string): boolean {
  return mode === "100644" || mode === "100755";
}

function dirnameGitPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basenameGitPath(path: string): string {
  const normalized = normalizeGitPath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function joinGitPath(...parts: string[]): string {
  return parts.map(normalizeGitPath).filter(Boolean).join("/");
}

function normalizeGitPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

async function fetchDefaultBranch(
  owner: string,
  repo: string,
): Promise<{ success: true; ref: string } | GitHubSourceFailure> {
  const repoResult = await fetchGitHubJson<GitHubRepo>(`${apiRepo(owner, repo)}`);
  if (!repoResult.success) return repoResult;
  if (!repoResult.value.default_branch) {
    return {
      success: false,
      code: "not-found",
      error: "GitHub repository does not expose a default branch.",
    };
  }
  return { success: true, ref: repoResult.value.default_branch };
}

async function fetchMatchingRefs(
  owner: string,
  repo: string,
  namespace: "heads" | "tags",
  firstSegment: string,
): Promise<{ success: true; refs: GitHubRef[] } | GitHubSourceFailure> {
  const result = await fetchGitHubJson<GitHubRef[]>(
    `${apiRepo(owner, repo)}/git/matching-refs/${namespace}/${encodeURIComponent(firstSegment)}`,
  );
  if (!result.success) {
    if (result.code === "not-found") return { success: true, refs: [] };
    return result;
  }
  return { success: true, refs: result.value };
}

async function fetchCommitish(
  owner: string,
  repo: string,
  ref: string,
): Promise<{ success: true; sha: string; treeSha: string } | GitHubSourceFailure> {
  const result = await fetchGitHubJson<GitHubCommit>(
    `${apiRepo(owner, repo)}/commits/${encodeURIComponent(ref)}`,
  );
  if (!result.success) return result;
  const treeSha = result.value.commit?.tree?.sha ?? result.value.tree?.sha;
  if (!result.value.sha || !treeSha) {
    return {
      success: false,
      code: "fetch-failed",
      error: "GitHub commit response did not include a commit SHA and tree SHA.",
    };
  }
  return { success: true, sha: result.value.sha, treeSha };
}

async function fetchCommitFromRefObject(
  owner: string,
  repo: string,
  ref: GitHubRef,
): Promise<{ success: true; sha: string; treeSha: string } | GitHubSourceFailure> {
  let commitSha = ref.object.sha;
  if (ref.object.type === "tag") {
    const tag = await fetchGitHubJson<GitHubTag>(
      `${apiRepo(owner, repo)}/git/tags/${encodeURIComponent(ref.object.sha)}`,
    );
    if (!tag.success) return tag;
    if (!tag.value.object?.sha) {
      return {
        success: false,
        code: "fetch-failed",
        error: "GitHub tag response did not include a target commit.",
      };
    }
    commitSha = tag.value.object.sha;
  }
  return fetchGitCommit(owner, repo, commitSha);
}

async function fetchGitCommit(
  owner: string,
  repo: string,
  commitSha: string,
): Promise<{ success: true; sha: string; treeSha: string } | GitHubSourceFailure> {
  const result = await fetchGitHubJson<GitHubCommit>(
    `${apiRepo(owner, repo)}/git/commits/${encodeURIComponent(commitSha)}`,
  );
  if (!result.success) return result;
  const treeSha = result.value.tree?.sha;
  if (!result.value.sha || !treeSha) {
    return {
      success: false,
      code: "fetch-failed",
      error: "GitHub git commit response did not include a commit SHA and tree SHA.",
    };
  }
  return { success: true, sha: result.value.sha, treeSha };
}

async function fetchGitTree(
  owner: string,
  repo: string,
  treeSha: string,
  recursive: boolean,
): Promise<({ success: true } & GitHubTree) | GitHubSourceFailure> {
  const suffix = recursive ? "?recursive=1" : "";
  const result = await fetchGitHubJson<GitHubTree>(
    `${apiRepo(owner, repo)}/git/trees/${encodeURIComponent(treeSha)}${suffix}`,
  );
  if (!result.success) return result;
  return { success: true, ...result.value };
}

async function fetchRawSkillMarkdown(
  owner: string,
  repo: string,
  commitSha: string,
  skillPath: string,
): Promise<{ success: true; markdown: string } | GitHubSourceFailure> {
  const result = await fetchGitHubText(rawUrl(owner, repo, commitSha, skillPath), {
    maxBytes: SKILL_MARKDOWN_MAX_BYTES,
    accept: "text/markdown, text/plain, */*;q=0.8",
  });
  if (!result.success) return result;
  return { success: true, markdown: result.text };
}

async function fetchRawBytes(
  owner: string,
  repo: string,
  commitSha: string,
  path: string,
  maxBytes: number,
): Promise<{ success: true; bytes: Uint8Array } | GitHubSourceFailure> {
  try {
    const bytes = await fetchBytes(rawUrl(owner, repo, commitSha, path), {
      maxBytes,
      accept: "application/octet-stream, */*;q=0.8",
      githubAuth: false,
    });
    return { success: true, bytes };
  } catch (err) {
    return mapFetchError(err, "GitHub raw file fetch failed.");
  }
}

async function fetchGitHubJson<T>(
  url: string,
): Promise<{ success: true; value: T } | GitHubSourceFailure> {
  try {
    const value = await fetchJson<T>(url, { githubAuth: true });
    return { success: true, value };
  } catch (err) {
    return mapFetchError(err, "GitHub API request failed.");
  }
}

async function fetchGitHubText(
  url: string,
  options: { maxBytes: number; accept: string },
): Promise<{ success: true; text: string } | GitHubSourceFailure> {
  try {
    const text = await fetchText(url, {
      maxBytes: options.maxBytes,
      accept: options.accept,
      githubAuth: false,
    });
    return { success: true, text };
  } catch (err) {
    return mapFetchError(err, "GitHub raw file fetch failed.");
  }
}

function mapFetchError(err: unknown, fallback: string): GitHubSourceFailure {
  if (err instanceof HttpFetchError) {
    if (err.code === "rate-limited") {
      return {
        success: false,
        code: "rate-limited",
        error: err.retryAfter
          ? `GitHub rate limit exceeded. Retry after ${err.retryAfter}.`
          : "GitHub rate limit exceeded.",
      };
    }
    if (err.code === "source-too-large") {
      return { success: false, code: "source-too-large", error: err.message };
    }
    if (err.status === 404) {
      return { success: false, code: "not-found", error: err.message };
    }
    return { success: false, code: "fetch-failed", error: err.message || fallback };
  }
  return { success: false, code: "fetch-failed", error: (err as Error).message || fallback };
}

function apiRepo(owner: string, repo: string): string {
  return `${API_ROOT}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function rawUrl(owner: string, repo: string, commitSha: string, path: string): string {
  return `${RAW_ROOT}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(commitSha)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
