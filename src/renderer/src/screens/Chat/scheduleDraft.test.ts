import { describe, expect, it } from "vitest";
import { buildScheduleDraftFromConversation } from "./scheduleDraft";

describe("buildScheduleDraftFromConversation", () => {
  it("packages current chat context without inventing a schedule prompt", () => {
    const draft = buildScheduleDraftFromConversation({
      createdAt: 1_777_000_000_000,
      sessionId: "session-123",
      sessionTitle: "Release planning",
      profile: "work",
      messages: [
        { id: "u1", role: "user", content: "Can you check the release plan?" },
        { id: "a1", role: "agent", content: "The plan has three blockers." },
        { id: "blank", role: "agent", content: "   " },
      ],
    });

    expect(draft).not.toHaveProperty("prompt");
    expect(draft.sourceSessionId).toBe("session-123");
    expect(draft.context).toMatchObject({
      source: "chat",
      sessionId: "session-123",
      conversationId: "session-123",
      title: "Release planning",
      excerpt: "Can you check the release plan?",
      profile: "work",
      createdAt: 1_777_000_000_000,
      messageCount: 2,
    });
    expect(draft.context.messages).toEqual([
      { index: 0, role: "user", content: "Can you check the release plan?" },
      { index: 1, role: "agent", content: "The plan has three blockers." },
    ]);
    expect(draft.conversation).toBe(draft.context);
    expect(draft.metadata).toEqual({
      source: "chat",
      createdAt: 1_777_000_000_000,
      profile: "work",
    });
  });
});
