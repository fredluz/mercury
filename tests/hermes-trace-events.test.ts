import { describe, expect, it } from "vitest";

import {
  extractArtifactEventsFromText,
  normalizeCliProgressLine,
  normalizeHermesStreamEvent,
} from "../src/main/hermes/trace-events";

describe("Hermes trace event normalization", () => {
  it("records image tool failures as structured tool.failed evidence", () => {
    const events = normalizeHermesStreamEvent("hermes.tool.progress", {
      tool: "image_generate",
      status: "failed",
      message: "Image generation provider unavailable for this account.",
      apiKey: "must-not-persist",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool.failed",
      title: "Tool failed: image_generate",
      detail: "Image generation provider unavailable for this account.",
      metadata: expect.objectContaining({
        tool: "image_generate",
        toolName: "image_generate",
        streamEvent: "hermes.tool.progress",
      }),
    });
    expect(events[0].metadata).not.toHaveProperty("apiKey");
  });

  it("only extracts artifact.created evidence when response text includes an image reference", () => {
    expect(
      extractArtifactEventsFromText("I made a small blue circle concept, but no file was created."),
    ).toEqual([]);

    const events = extractArtifactEventsFromText(
      "Created the image: ![blue circle](file:///tmp/blue-circle.png)",
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "artifact.created",
      metadata: expect.objectContaining({ artifactType: "image" }),
    });
  });

  it("extracts image artifacts from Codex app-server tool progress paths", () => {
    const path = "/tmp/hermes/cache/images/openai_codex_gpt-image-2-low_20260514.png";

    expect(extractArtifactEventsFromText(`Image tool returned: ${path}`)).toMatchObject([
      {
        type: "artifact.created",
        metadata: expect.objectContaining({
          artifactType: "image",
          path,
        }),
      },
    ]);

    const events = normalizeCliProgressLine(`- Image tool returned: ${path}`);
    expect(events.map((event) => event.type)).toEqual(["tool.progress", "artifact.created"]);
    expect(events[1].metadata).toMatchObject({ artifactType: "image", path });
  });
});
