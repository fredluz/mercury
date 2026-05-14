# Contract Tests

This document maps Mercury's current contract tests to the behavior they protect. Keep it updated when IPC/preload contracts, shared schemas, persistence behavior, or high-risk subsystem tests change.

## Source anchors

- IPC/preload parity: `tests/ipc-handlers.test.ts`
- Preload API surface: `tests/preload-api-surface.test.ts`
- Trace-store skill-training derivation: `tests/trace-store.test.ts`
- Manual Markdown skill import: `tests/skills-import.test.ts`
- Session cache sync: `tests/session-cache-sync.test.ts`
- Related docs: [Architecture overview](../architecture/overview.md), [IPC and preload contract](../contracts/ipc-preload.md)

## When to run contract tests

Run contract tests when a change touches any of these areas:

- `src/main/ipc/**`, `src/main/index.ts` updater/menu IPC, or any `ipcMain.handle(...)` channel.
- `src/preload/index.ts`, `src/preload/index.d.ts`, or `src/preload/api/**`.
- Shared cross-process types under `src/shared/*`.
- Trace persistence, trace event schema, skill-training derivation, or real-app Trace Lab harness expectations.
- Manual Markdown skill import behavior.
- Session cache sync, generated session titles, session cache persistence, or session search inputs.
- Persistent files/profile behavior that affects renderer-visible data.

For docs-only changes, manually verify links and file references. Full test runs are optional unless the docs change alongside source behavior.

## Test responsibilities

### `tests/ipc-handlers.test.ts`

Protects the main/preload IPC channel contract.

Current assertions:

- Main process registers more than 30 `ipcMain.handle(...)` channels.
- Preload invokes more than 30 `ipcRenderer.invoke(...)` channels.
- Every preload invoke channel has a matching main handler.
- Every main handler has a matching preload invoke.
- Every `src/main/ipc/*.ts` module, except `index.ts` and `types.ts`, exports a `register*Ipc(...)` function and is wired by `src/main/ipc/index.ts`.
- Specific newer channels remain present: `run-hermes-backup`, `run-hermes-import`, `read-logs`, `run-hermes-dump`, `list-mcp-servers`, `discover-memory-providers`, `import-skill-markdown`, and `record-local-chat-trace`.
- Legacy channels such as `check-install`, `start-install`, `send-message`, `abort-chat`, `start-gateway`, `list-sessions`, `list-profiles`, `create-cron-job`, and `open-external` remain registered.

Run this test when changing:

- `src/main/ipc/index.ts`
- Any `src/main/ipc/*.ts` file
- `src/main/index.ts` updater/version handlers
- Any preload invoke channel in `src/preload/api/*.ts`

### `tests/preload-api-surface.test.ts`

Protects the `window.hermesAPI` implementation/type surface.

Current assertions:

- Split preload API fragments expose more than 30 methods.
- `interface HermesAPI` in `src/preload/index.d.ts` declares more than 30 methods.
- Every preload method has a type declaration.
- Every type declaration has a preload implementation.
- Every split preload API fragment in `src/preload/api/*.ts` is imported and spread from `src/preload/api/index.ts`.
- Newer APIs such as backup/import, log viewer, debug dump, MCP server list, memory provider discovery, Markdown skill import, and local chat trace recording exist in both implementation and types.
- Required legacy APIs remain present in implementation and types.
- `ipcRenderer.invoke(...)` and `ipcRenderer.on(...)` channels use quoted kebab-case string channel names.

Run this test when changing:

- `src/preload/api/*.ts`
- `src/preload/api/index.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- Renderer code that starts using a new `window.hermesAPI` method

### `tests/trace-store.test.ts`

Protects trace-store skill-training derivation and focused trace persistence behavior.

Current assertions:

- A `skill.eval` trace event with skill metadata is exposed through `listSkillTrainingRuns()` with linked run id, `needs-review` status, parsed score, skill name, and summary.
- A `skill.promoted` event with score metadata above the trust range is clamped to `1`.
- Structured event types such as tool/delegation/artifact/transport/local command events persist through the trace store without requiring a store version bump.
- `createLocalChatTrace()` creates a completed run with `slash.local`, optional local response preview, and sanitized metadata.

Run this test when changing:

- `src/shared/traces.ts`
- `src/main/trace-store.ts`
- Trace event writes in `src/main/ipc/chat.ts`
- Trace Lab assumptions about skill-training runs

### `tests/skills-import.test.ts`

Protects manual Markdown skill import behavior.

Current assertions:

- Import writes normalized `SKILL.md` into the default profile skill directory.
- Import writes to a named profile's skills directory.
- Traversal profile names are rejected.
- Invalid skill names and categories are rejected.
- Duplicate skills are rejected unless `overwrite` is enabled.
- Existing frontmatter is normalized while the Markdown body is preserved.
- Inline dashes inside frontmatter values are not treated as the closing delimiter.

Run this test when changing:

- `src/main/skills.ts`
- `src/main/skills/importer.ts`
- `src/shared/skills.ts`
- `src/main/ipc/knowledge.ts` Markdown import handling
- `src/preload/api/knowledge.ts` or `src/preload/index.d.ts` import request/result types
- SSH skill import behavior if local and SSH semantics are intentionally kept aligned

### `tests/session-cache-sync.test.ts`

Protects session cache correctness and performance.

Current assertions:

- Sync returns an empty list when no database exists.
- First sync ingests sessions, generates titles, sorts by `startedAt` descending, and creates the desktop cache file.
- Existing sessions update without duplication.
- Subsequent syncs append new sessions without losing old ones.
- A large existing cache sync avoids the previous quadratic blowup by completing the regression case under the test threshold.

Run this test when changing:

- `src/main/session-cache.ts`
- Session cache handlers in `src/main/ipc/sessions.ts`
- Session title generation behavior
- Session persistence or session cache file layout

## Real-app Trace Lab hardening harness

`scripts/e2e-trace-lab-hardening.mjs` is a Playwright/Electron harness for release-style Trace Lab validation. It launches the built Mercury app (`out/main/index.js`) with an isolated temporary `HERMES_HOME`, symlinks the locally installed Hermes agent, drives chat scenarios through the renderer UI and preload APIs, verifies `desktop-traces.json`, opens Trace Lab, and writes:

- `docs/labs-e2e/trace-lab-hardening-report.md`
- `docs/labs-e2e/trace-lab-hardening-summary.json`
- `docs/labs-e2e/trace-lab-hardening.png`

Run it after a build when real credentials are available:

```bash
npm run build
npm run e2e:trace-lab-hardening
```

Credential discovery is intentionally explicit and stops with an actionable blocker rather than creating fake traces. Configure one of:

- Codex/Hermes OAuth: `hermes auth codex`, an existing `~/.hermes/auth.json` `openai-codex` provider, or an existing `~/.codex/auth.json` ChatGPT/Codex login. This is preferred for the hardening harness.
- `opencode auth login` or `OPENCODE_GO_API_KEY`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `ANTHROPIC_API_KEY`
- `TRACE_LAB_E2E_PROVIDER + TRACE_LAB_E2E_MODEL + TRACE_LAB_E2E_API_KEY` or `TRACE_LAB_E2E_API_KEY_ENV`

The image-generation scenario is enabled by default when the `image_gen` toolset is enabled. For Codex-backed runs, the harness configures `image_gen.provider: openai-codex`, which uses Hermes' bundled OpenAI Codex image backend (`gpt-image-2` through the Codex app-server/Responses `image_generation` tool) and does not require `FAL_KEY`. `FAL_KEY` is passed through only when present as an optional credential for non-Codex image backends. Use `TRACE_LAB_E2E_SKIP_IMAGE=1` only for a reduced local validation, not for release hardening.

The harness expects the richer trace contract now emitted by the app path, including `session.resumed`, `message.history.loaded`, structured `tool.*`, `delegation.*`, `artifact.created`, `transport.error`, and `slash.local` evidence where the scenario applies. Existing coarse run lifecycle evidence remains a hard requirement. The image-generation scenario only passes when a completed run contains `artifact.created` image evidence; traced provider/tool-unavailable failures are reported as `DEPENDENCY`, not image success. Page/context closures, manual app closes, timeouts, and other harness interruptions are reported as `FAIL` harness failures.

## Recommended commands

Run targeted contract tests during focused changes:

```bash
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run test -- tests/trace-store.test.ts tests/skills-import.test.ts tests/session-cache-sync.test.ts
```

Run the real-app hardening harness when a change touches Trace Lab coverage across the app path and credentials are available:

```bash
npm run build
npm run e2e:trace-lab-hardening
```

Run the broader project checks before submitting source changes that affect contracts:

```bash
npm run test
npm run typecheck
npm run check:loc
```

`npm run lint` is also desirable when source changes are involved, but treat unrelated pre-existing lint failures separately from the contract change being validated.

## Update policy

When adding or changing a contract test:

1. Name the source files and behavior the test protects.
2. Add the test to this document if it guards IPC/preload, shared schemas, persistence, connection modes, user-visible workflows, or high-risk regressions.
3. Link the test from the relevant evergreen architecture, contract, or subsystem doc.
4. Keep historical reports and investigations as evidence only; do not rely on them as the current test map.
