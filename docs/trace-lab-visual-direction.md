# Trace Lab Visual Direction

Date: 2026-05-12

## Goal

Make Mercury feel like a first-class AI agent dashboard rather than a terminal wrapper. Trace Lab should explain what the agent did, why it mattered, and how the run feeds future skill learning.

## GPT Image 2 References

- Dashboard concept: [trace-lab-gpt-image-2-concept.png](assets/trace-lab-gpt-image-2-concept.png)
- User-facing explainer: [trace-lab-explainer-gpt-image-2.png](assets/trace-lab-explainer-gpt-image-2.png)

The generated concepts pushed the implemented direction toward:

- A visible "Agent Run Map" instead of a raw event list first.
- Plain-language explanation cards for "What happened" and "Why it matters".
- A stronger skill evaluation panel, ready for scores and review status.
- Restrained blue, green, and amber status language with a white macOS productivity feel.

## Pi/Kimi Visual Explainer Notes

Pi was run with `opencode-go/kimi-k2.6` and the installed Visual Explainer skill. The useful recommendations were:

- Preserve the existing three-pane workbench, but make the center pane more explanatory.
- Treat `TraceRun`, `TraceEvent`, and `SkillTrainingRun` as distinct visual entities.
- Keep existing selectors/classes stable for tests and future automation.
- Represent the self-improvement loop as status, score, linked trace, and review text rather than as raw metadata.

## Implemented Surface

- Header reframed as "Agent Intelligence" with Run Map and Skill Evaluation badges.
- Center detail now opens with a six-stage run map: Ask, Planning, Tool Calls, Files Edited, Skill Notes, Answer.
- Inspector now translates selected events into "What happened" and "Why it matters".
- Skill Evaluation now has a scored-card visual treatment and a clearer empty state.
- Existing trace list, timeline, and inspector selectors remain intact for all-trace E2E coverage.
- Sessions is now the entry point for trace review: session rows launch a session-scoped Trace Lab detail without the internal Recent activity list, while the Sessions Trace Activity action preserves an all-trace fallback for orphan/non-session traces.
