import { describe, expect, it } from "vitest";
import { normalizeModelCapabilities } from "../src/shared/models";

describe("model capability helpers", () => {
  it("defaults saved model capabilities to text without inferring image generation", () => {
    expect(normalizeModelCapabilities(undefined)).toEqual(["text"]);
    expect(
      normalizeModelCapabilities(["image_input", "codex_image_gen", "bad"]),
    ).toEqual(["image_input", "codex_image_gen"]);
  });
});
