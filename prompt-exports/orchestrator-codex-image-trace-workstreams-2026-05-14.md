# Codex Image Generation + Trace Lab Workstreams

## Context

Mercury has a new Trace Lab hardening effort in progress. Current relevant files:

- `scripts/e2e-trace-lab-hardening.mjs` — real-app Playwright/Electron harness. It now prefers Codex/Hermes OAuth (`openai-codex`) and writes temp Hermes config with `image_gen.provider: openai-codex`.
- `src/main/hermes/trace-events.ts` — structured trace event normalization/sanitization/artifact extraction.
- `src/main/ipc/chat.ts` — main chat send/abort/error trace lifecycle.
- `src/main/trace-store.ts`, `src/shared/traces.ts` — trace persistence/schema.
- `src/renderer/src/screens/TraceLab/*` — Trace Lab UI rendering.
- `tests/trace-store.test.ts`, `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts` — focused trace/preload/IPC tests.

Local environment evidence already observed:

- Hermes has Codex OAuth in `~/.hermes/auth.json` under provider `openai-codex`.
- `~/.codex/auth.json` also exists with ChatGPT/Codex tokens.
- Installed Hermes has bundled plugin `~/.hermes/hermes-agent/plugins/image_gen/openai-codex/` whose plugin.yaml describes: OpenAI image generation backed by ChatGPT/Codex OAuth, `gpt-image-2` via Codex Responses `image_generation` tool, no API key required.
- The plugin implementation calls Codex backend `https://chatgpt.com/backend-api/codex` with Responses `tools: [{ type: "image_generation", model: "gpt-image-2", ... }]`.

Recent run results:

- `npm run e2e:trace-lab-hardening` ran with `openai-codex/gpt-5.5`.
- Normal conversation passed with usage.
- Resumed/history passed with `session.resumed` and `message.history.loaded`.
- Tool call passed with `tool.started` / `tool.completed`.
- Delegation passed with `delegation.started` / `delegation.completed`.
- Image generation did not produce a visible blue circle or `artifact.created`; likely Hermes/model reported missing access to the image tool, or the prompt/harness did not capture the failure path correctly.
- A later run was manually closed during image generation; the harness recorded page/context closed while waiting for `TRACE_HARDEN_IMAGE_OK`.

## Work items

- [x] Item 1: Make Codex app-server image generation actually work
  - Goal: Diagnose and fix the Mercury/Hermes path so image generation uses the bundled `openai-codex` image backend / Codex app-server `image_generation` tool and returns an actual image artifact through the app.
  - Done when: a real app-path run can request an image through Mercury chat and produce a visible/saved image artifact; Trace Lab records image/tool/artifact evidence (`tool.*` and/or `artifact.created`) for the run; if the blocker is outside Mercury, produce a precise patch/command/setup step and make Mercury/harness surface it clearly.
  - Key files/modules: `scripts/e2e-trace-lab-hardening.mjs`, Mercury config/toolset code under `src/main/tools.ts` / config APIs if needed, trace normalization, and external Hermes plugin files for investigation only unless a local patch is clearly required.
  - Dependencies: none.
  - Size: large.

- [x] Item 2: Stabilize tests and harness failure semantics
  - Goal: Fix focused tests and harness assertions so failures are accurate: image generation must not pass without artifact evidence, expected tool-unavailable errors should be traceable, and page closures/manual aborts should be reported as clear harness failures rather than misleading dependency passes.
  - Done when: focused tests pass; `node --check scripts/e2e-trace-lab-hardening.mjs` passes; harness result classification distinguishes success, expected provider/tool failure, and harness crash; docs/report text aligns with actual semantics.
  - Key files/modules: tests, `scripts/e2e-trace-lab-hardening.mjs`, `docs/testing/contract-tests.md`, generated `docs/labs-e2e/*` report behavior.
  - Dependencies: can proceed in parallel with Item 1 but avoid core image wiring unless coordinating.
  - Size: medium.

- [x] Item 3: Realistic software-work trace scenario
  - Goal: Add or run a realistic end-to-end scenario where the app performs real software-engineering work (e.g. creates a tiny game/app) and generates image assets for it, so Trace Lab captures conversation, tool calls, file edits/terminal activity, sub-agent/delegation if used, image generation, artifacts, errors, and completion.
  - Done when: there is a reproducible scenario/prompt/script path that drives real Mercury chat through the app, asks for a small concrete build with generated image assets, and verifies Trace Lab can find the resulting run and meaningful events/artifacts. If image generation is still blocked by Item 1, report the scenario as blocked with exact missing evidence rather than faking it.
  - Key files/modules: new or extended harness scenario in `scripts/e2e-trace-lab-hardening.mjs` or a sibling script if cleaner; report outputs under `docs/labs-e2e/`; Trace Lab verification helpers.
  - Dependencies: can design in parallel; full pass depends on Item 1.
  - Size: large.

## Latest coordination update

- Item 3 produced a real software-work scenario and Trace Lab-visible run, but it remains blocked on image tool exposure. Evidence: no `artifact.created`, no `image_generate` / `image_generation` event, no raster asset, and agent response said: “No image generation tool is available in my toolset.”
- This contradicts Item 1's direct plugin/API-server probes, so Item 1 is reopened until the full Mercury chat path exposes the image tool successfully.

## Coordination notes

- Agents should read this file first and keep to their assigned item.
- Avoid overwriting sibling changes. If a file overlap is unavoidable, report back with the needed change rather than pushing a broad rewrite.
- Do not reintroduce a hard `FAL_KEY` requirement for Codex-backed image generation.
- Real token/image runs are allowed but should be bounded to the harness/scenario prompts.
