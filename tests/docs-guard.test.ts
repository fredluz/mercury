import { describe, expect, it } from "vitest";

// @ts-expect-error - .mjs has no type declarations; we test the exported JS evaluator directly.
import { evaluateDocsGuard } from "../scripts/check-docs.mjs";

describe("evaluateDocsGuard", () => {
  it("fails high-risk code-only edits", () => {
    const result = evaluateDocsGuard(["src/preload/api/chat.ts"]);

    expect(result.ok).toBe(false);
    expect(result.acknowledged).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "ipc-preload-contract",
          changedCodeFiles: ["src/preload/api/chat.ts"],
        }),
      ]),
    );
  });

  it("passes when a matching evergreen doc changes", () => {
    const result = evaluateDocsGuard([
      "src/preload/api/chat.ts",
      "docs/contracts/ipc-preload.md",
    ]);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.triggered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "ipc-preload-contract",
          matchingDocFiles: ["docs/contracts/ipc-preload.md"],
          satisfied: true,
        }),
      ]),
    );
  });

  it("does not allow historical investigation docs to satisfy evergreen requirements", () => {
    const result = evaluateDocsGuard([
      "src/main/ipc/chat.ts",
      "docs/investigations/example.md",
    ]);

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.ruleId)).toEqual([
      "ipc-preload-contract",
      "chat-and-tracing",
      "connection-modes",
    ]);
    expect(
      result.triggered.every(
        (ruleResult) => ruleResult.matchingDocFiles.length === 0,
      ),
    ).toBe(true);
  });

  it("passes with an explicit acknowledgement and records the acknowledgement", () => {
    const result = evaluateDocsGuard(["src/main/models.ts"], {
      ackReason: "model refactor; documented storage contract unchanged",
    });

    expect(result.ok).toBe(true);
    expect(result.acknowledged).toBe(true);
    expect(result.ackReason).toBe(
      "model refactor; documented storage contract unchanged",
    );
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "storage-and-profiles" }),
      ]),
    );
  });

  it("does not trigger for unmapped files", () => {
    const result = evaluateDocsGuard([".github/workflows/release.yml"]);

    expect(result.ok).toBe(true);
    expect(result.triggered).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("requires contract-test documentation for mapped contract-test changes", () => {
    const codeOnly = evaluateDocsGuard(["tests/chat-metadata.test.ts"]);
    const withDocs = evaluateDocsGuard([
      "tests/chat-metadata.test.ts",
      "docs/testing/contract-tests.md",
    ]);

    expect(codeOnly.ok).toBe(false);
    expect(codeOnly.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "contract-tests" }),
      ]),
    );
    expect(withDocs.ok).toBe(true);
    expect(withDocs.failures).toEqual([]);
    expect(withDocs.triggered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "contract-tests",
          matchingDocFiles: ["docs/testing/contract-tests.md"],
        }),
      ]),
    );
  });
});
