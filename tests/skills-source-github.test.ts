import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewSkillSource, fetchSkillSourceDirectory } from "../src/main/skills/source-service";

const COMMIT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(body: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain", ...headers },
  });
}

type Route = {
  match: string | RegExp | ((url: string) => boolean);
  response: Response | (() => Response);
};

function installFetchRoutes(routes: Route[]): { fetchMock: ReturnType<typeof vi.fn>; urls: string[] } {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const route = routes.find((candidate) => {
      if (typeof candidate.match === "string") return url === candidate.match;
      if (candidate.match instanceof RegExp) return candidate.match.test(url);
      return candidate.match(url);
    });
    if (!route) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    return typeof route.response === "function" ? route.response() : route.response.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, urls };
}

function repoRoutes(extra: Route[] = []): Route[] {
  return [
    {
      match: "https://api.github.com/repos/owner/repo",
      response: jsonResponse({ default_branch: "main" }),
    },
    {
      match: "https://api.github.com/repos/owner/repo/commits/main",
      response: jsonResponse({ sha: COMMIT_A, commit: { tree: { sha: "tree-a" } } }),
    },
    ...extra,
  ];
}

function skillMarkdown(name: string, description = `${name} description`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub skill source preview", () => {
  it("discovers a repo-root SKILL.md candidate and pins it to the resolved commit", async () => {
    installFetchRoutes(
      repoRoutes([
        {
          match: "https://api.github.com/repos/owner/repo/git/trees/tree-a?recursive=1",
          response: jsonResponse({ sha: "tree-a", truncated: false, tree: [
            { path: "SKILL.md", type: "blob", mode: "100644", sha: "skill", size: 80 },
          ] }),
        },
        {
          match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/SKILL.md`,
          response: textResponse(skillMarkdown("root-skill", "Root skill")),
        },
      ]),
    );

    const result = await previewSkillSource({ source: "owner/repo" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        candidateId: `github:owner/repo@${COMMIT_A}:SKILL.md`,
        commitSha: COMMIT_A,
        name: "root-skill",
        category: "custom",
        directoryName: "root-skill",
        skillPath: "SKILL.md",
        valid: true,
      }),
    ]);
  });

  it("discovers monorepo candidates and infers category only from skills/<category>/<skill>", async () => {
    installFetchRoutes(
      repoRoutes([
        {
          match: "https://api.github.com/repos/owner/repo/git/trees/tree-a?recursive=1",
          response: jsonResponse({ sha: "tree-a", truncated: false, tree: [
            { path: "skills/pdf/SKILL.md", type: "blob", mode: "100644", sha: "pdf", size: 100 },
            { path: "skills/writing/blog/SKILL.md", type: "blob", mode: "100644", sha: "blog", size: 100 },
          ] }),
        },
        {
          match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/skills/pdf/SKILL.md`,
          response: textResponse(skillMarkdown("pdf-skill")),
        },
        {
          match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/skills/writing/blog/SKILL.md`,
          response: textResponse(skillMarkdown("blog-skill")),
        },
      ]),
    );

    const result = await previewSkillSource({ source: "owner/repo" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.candidates).toEqual([
      expect.objectContaining({ skillPath: "skills/pdf/SKILL.md", category: "custom", directoryName: "pdf" }),
      expect.objectContaining({ skillPath: "skills/writing/blog/SKILL.md", category: "writing", directoryName: "blog" }),
    ]);
  });

  it("defaults .agents/skills candidates to custom", async () => {
    installFetchRoutes(
      repoRoutes([
        {
          match: "https://api.github.com/repos/owner/repo/git/trees/tree-a?recursive=1",
          response: jsonResponse({ sha: "tree-a", truncated: false, tree: [
            { path: ".agents/skills/typescript-expert/SKILL.md", type: "blob", mode: "100644", sha: "ts", size: 100 },
          ] }),
        },
        {
          match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/.agents/skills/typescript-expert/SKILL.md`,
          response: textResponse(skillMarkdown("typescript-expert")),
        },
      ]),
    );

    const result = await previewSkillSource({ source: "owner/repo" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.candidates[0]).toMatchObject({
      category: "custom",
      directoryName: "typescript-expert",
      skillPath: ".agents/skills/typescript-expert/SKILL.md",
    });
  });

  it("resolves branch names with slashes and narrows tree URLs to that directory", async () => {
    installFetchRoutes([
      {
        match: "https://api.github.com/repos/owner/repo/git/matching-refs/heads/feature",
        response: jsonResponse([
          { ref: "refs/heads/feature/branch", object: { sha: COMMIT_A, type: "commit" } },
        ]),
      },
      {
        match: "https://api.github.com/repos/owner/repo/git/matching-refs/tags/feature",
        response: jsonResponse([]),
      },
      {
        match: `https://api.github.com/repos/owner/repo/git/commits/${COMMIT_A}`,
        response: jsonResponse({ sha: COMMIT_A, tree: { sha: "tree-a" } }),
      },
      {
        match: "https://api.github.com/repos/owner/repo/git/trees/tree-a?recursive=1",
        response: jsonResponse({ sha: "tree-a", truncated: false, tree: [
          { path: "skills/pdf/SKILL.md", type: "blob", mode: "100644", sha: "pdf", size: 100 },
          { path: "skills/other/SKILL.md", type: "blob", mode: "100644", sha: "other", size: 100 },
        ] }),
      },
      {
        match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/skills/pdf/SKILL.md`,
        response: textResponse(skillMarkdown("pdf-skill")),
      },
    ]);

    const result = await previewSkillSource({
      source: "https://github.com/owner/repo/tree/feature/branch/skills/pdf",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ skillPath: "skills/pdf/SKILL.md" });
  });

  it("resolves blob and raw SKILL.md URLs to a single candidate", async () => {
    installFetchRoutes([
      {
        match: "https://api.github.com/repos/owner/repo/git/matching-refs/heads/main",
        response: jsonResponse([
          { ref: "refs/heads/main", object: { sha: COMMIT_A, type: "commit" } },
        ]),
      },
      {
        match: "https://api.github.com/repos/owner/repo/git/matching-refs/tags/main",
        response: jsonResponse([]),
      },
      {
        match: `https://api.github.com/repos/owner/repo/git/commits/${COMMIT_A}`,
        response: jsonResponse({ sha: COMMIT_A, tree: { sha: "tree-a" } }),
      },
      {
        match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/skills/pdf/SKILL.md`,
        response: textResponse(skillMarkdown("pdf-skill")),
      },
    ]);

    const blob = await previewSkillSource({
      source: "https://github.com/owner/repo/blob/main/skills/pdf/SKILL.md",
    });
    const raw = await previewSkillSource({
      source: "https://raw.githubusercontent.com/owner/repo/main/skills/pdf/SKILL.md",
    });

    expect(blob.success).toBe(true);
    expect(raw.success).toBe(true);
    if (!blob.success || !raw.success) throw new Error("expected success");
    expect(blob.candidates).toHaveLength(1);
    expect(raw.candidates).toHaveLength(1);
    expect(blob.candidates[0].candidateId).toBe(`github:owner/repo@${COMMIT_A}:skills/pdf/SKILL.md`);
    expect(raw.candidates[0].candidateId).toBe(`github:owner/repo@${COMMIT_A}:skills/pdf/SKILL.md`);
  });

  it("maps GitHub 403 rate limits to rate-limited", async () => {
    installFetchRoutes([
      {
        match: "https://api.github.com/repos/owner/repo",
        response: jsonResponse(
          { message: "API rate limit exceeded" },
          403,
          { "x-ratelimit-remaining": "0" },
        ),
      },
    ]);

    const result = await previewSkillSource({ source: "owner/repo" });

    expect(result).toMatchObject({ success: false, code: "rate-limited" });
  });

  it("falls back to a bounded known-container scan when the recursive repo tree is truncated", async () => {
    installFetchRoutes(
      repoRoutes([
        {
          match: "https://api.github.com/repos/owner/repo/git/trees/tree-a?recursive=1",
          response: jsonResponse({ sha: "tree-a", truncated: true, tree: [
            { path: "partial/SKILL.md", type: "blob", mode: "100644", sha: "partial", size: 100 },
          ] }),
        },
        {
          match: "https://api.github.com/repos/owner/repo/git/trees/tree-a",
          response: jsonResponse({ sha: "tree-a", truncated: false, tree: [
            { path: "skills", type: "tree", mode: "040000", sha: "skills-tree" },
          ] }),
        },
        {
          match: "https://api.github.com/repos/owner/repo/git/trees/skills-tree",
          response: jsonResponse({ sha: "skills-tree", truncated: false, tree: [
            { path: "pdf", type: "tree", mode: "040000", sha: "pdf-tree" },
          ] }),
        },
        {
          match: "https://api.github.com/repos/owner/repo/git/trees/pdf-tree",
          response: jsonResponse({ sha: "pdf-tree", truncated: false, tree: [
            { path: "SKILL.md", type: "blob", mode: "100644", sha: "pdf-md", size: 100 },
          ] }),
        },
        {
          match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/skills/pdf/SKILL.md`,
          response: textResponse(skillMarkdown("pdf-skill")),
        },
      ]),
    );

    const result = await previewSkillSource({ source: "owner/repo" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ skillPath: "skills/pdf/SKILL.md" });
  });

  it("fetches the selected directory from the preview-pinned commit even if the branch later moves", async () => {
    const previewFetch = installFetchRoutes(
      repoRoutes([
        {
          match: "https://api.github.com/repos/owner/repo/git/trees/tree-a?recursive=1",
          response: jsonResponse({ sha: "tree-a", truncated: false, tree: [
            { path: "skills/pdf/SKILL.md", type: "blob", mode: "100644", sha: "pdf", size: 100 },
          ] }),
        },
        {
          match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/skills/pdf/SKILL.md`,
          response: textResponse(skillMarkdown("pdf-skill")),
        },
      ]),
    );

    const preview = await previewSkillSource({ source: "owner/repo" });
    expect(preview.success).toBe(true);
    if (!preview.success) throw new Error(preview.error);
    const candidateId = preview.candidates[0].candidateId;
    expect(previewFetch.urls).toContain(`https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/skills/pdf/SKILL.md`);

    const directoryFetch = installFetchRoutes([
      {
        match: `https://api.github.com/repos/owner/repo/git/commits/${COMMIT_A}`,
        response: jsonResponse({ sha: COMMIT_A, tree: { sha: "tree-a" } }),
      },
      {
        match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/skills/pdf/SKILL.md`,
        response: textResponse(skillMarkdown("pdf-skill")),
      },
      {
        match: "https://api.github.com/repos/owner/repo/git/trees/tree-a?recursive=1",
        response: jsonResponse({ sha: "tree-a", truncated: false, tree: [
          { path: "skills/pdf/SKILL.md", type: "blob", mode: "100644", sha: "pdf", size: 100 },
          { path: "skills/pdf/references/guide.md", type: "blob", mode: "100644", sha: "guide", size: 12 },
        ] }),
      },
      {
        match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/skills/pdf/references/guide.md`,
        response: textResponse("# Guide"),
      },
      {
        match: `https://api.github.com/repos/owner/repo/commits/main`,
        response: jsonResponse({ sha: COMMIT_B, commit: { tree: { sha: "tree-b" } } }),
      },
      {
        match: `https://raw.githubusercontent.com/owner/repo/${COMMIT_B}/skills/pdf/SKILL.md`,
        response: textResponse(skillMarkdown("wrong-branch")),
      },
    ]);

    const fetched = await fetchSkillSourceDirectory({
      source: "owner/repo",
      candidateId,
    });

    expect(fetched.success).toBe(true);
    if (!fetched.success) throw new Error(fetched.error);
    expect(directoryFetch.urls).not.toContain("https://api.github.com/repos/owner/repo/commits/main");
    expect(directoryFetch.urls).not.toContain(`https://raw.githubusercontent.com/owner/repo/${COMMIT_B}/skills/pdf/SKILL.md`);
    expect(fetched.candidate.commitSha).toBe(COMMIT_A);
    expect(fetched.files).toEqual([
      { relativePath: "SKILL.md", contentBase64: Buffer.from(skillMarkdown("pdf-skill")).toString("base64") },
      { relativePath: "references/guide.md", contentBase64: Buffer.from("# Guide").toString("base64") },
    ]);
  });
});
