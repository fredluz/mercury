import { describe, expect, it } from "vitest";
import {
  calculateContextUsage,
  inferContextWindow,
  isGenerateChatTitleRequest,
  sanitizeChatTitle,
} from "../src/shared/chat-metadata";

describe("chat metadata helpers", () => {
  it("infers known context windows", () => {
    expect(
      inferContextWindow("openrouter", "anthropic/claude-sonnet-4-20250514"),
    ).toEqual({ tokens: 200_000, source: "known-model" });
    expect(inferContextWindow("openai", "gpt-4.1")).toEqual({
      tokens: 1_047_576,
      source: "known-model",
    });
    expect(inferContextWindow("openrouter", "openai/gpt-4.1")).toEqual({
      tokens: 1_047_576,
      source: "known-model",
    });
  });

  it("prefers explicit context windows", () => {
    expect(inferContextWindow("custom", "my-model", 42_000)).toEqual({
      tokens: 42_000,
      source: "explicit",
    });
  });

  it("falls back for unknown models", () => {
    expect(inferContextWindow("custom", "unknown")).toEqual({
      tokens: 128_000,
      source: "fallback",
    });
  });

  it("calculates context percentage safely", () => {
    expect(calculateContextUsage(64_000, 128_000)).toBe(50);
    expect(calculateContextUsage(10, 0)).toBe(0);
    expect(calculateContextUsage(-1, 128_000)).toBe(0);
  });

  it("sanitizes model-generated titles", () => {
    expect(sanitizeChatTitle('## Title: "Build Chat Header Metadata."')).toBe(
      "Build Chat Header Metadata",
    );
    expect(
      sanitizeChatTitle(
        "This is a very long generated chat title that should stop cleanly near a word boundary",
        40,
      ),
    ).toBe("This is a very long generated chat title");
  });

  it("validates title-generation request shape", () => {
    expect(
      isGenerateChatTitleRequest({
        profile: "default",
        sessionId: "s1",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).toBe(true);
    expect(
      isGenerateChatTitleRequest({ messages: [{ role: "system", content: "nope" }] }),
    ).toBe(false);
  });
});
