# Contract Tests

This document maps Mercury's current contract tests and deterministic contract checks to the behavior they protect. Keep it updated when IPC/preload contracts, shared schemas, persistence behavior, profile/session behavior, trace normalization, docs guard rules, or high-risk subsystem tests change.

## Source anchors

- IPC/preload parity: `tests/ipc-handlers.test.ts`
- Preload API surface: `tests/preload-api-surface.test.ts`
- Local perf telemetry safety: `tests/perf-telemetry.test.ts`
- Chat IPC lifecycle: `tests/chat-ipc-lifecycle.test.ts`
- Profile runtime management: `tests/hermes-runtime.test.ts`, `tests/reliable-profile-runtime-contract.test.ts`
- Model configuration and Hermes inventory: `tests/model-roles.test.ts`, `tests/hermes-model-inventory.test.ts`, `tests/chat-role-runtime.test.ts`
- Codex auth recovery detection: `tests/codex-auth-recovery.test.ts`
- Chat metadata helpers: `tests/chat-metadata.test.ts`
- Chat title generation: `tests/hermes-title.test.ts`
- Hermes trace-event normalization: `tests/hermes-trace-events.test.ts`
- Knowledge and toolset service contracts: `tests/knowledge-service.test.ts`, `tests/toolsets-config.test.ts`
- System runtime revalidation: `tests/system-service.test.ts`
- Trace-store persistence and skill-training derivation: `tests/trace-store.test.ts`
- Manual Markdown skill import: `tests/skills-import.test.ts`
- Skills renderer draft/save UX: `src/renderer/src/screens/Skills/Skills.test.tsx`
- Skill batch mutation: `tests/skills-mutation.test.ts`
- Session cache sync: `tests/session-cache-sync.test.ts`
- Profile discovery: `tests/profiles.test.ts`
- Profile-aware local sessions: `tests/sessions-profile-db.test.ts`
- Reliable profile runtime contract: `tests/reliable-profile-runtime-contract.test.ts`
- SSH remote config validation: `tests/ssh-remote.test.ts`
- Performance benchmark entrypoints: `scripts/e2e-startup-perf.mjs`, `scripts/perf-build-snapshot.mjs`, `scripts/e2e-chat-render-latency.mjs`, `scripts/e2e-sessions-latency.mjs`, `scripts/e2e-ssh-remote-latency.mjs`, plus opt-in bench tests.
- Docs freshness guard: `scripts/check-docs.mjs`, with evaluator coverage in `tests/docs-guard.test.ts`, via `npm run check:docs`
- CLI contract and parity: `tests/cli-parser.test.ts`, `tests/cli-output-contract.test.ts`, `tests/cli-entrypoint.test.ts`, `tests/cli-read-only-commands.test.ts`, `tests/cli-mutating-commands.test.ts`, `tests/cli-chat-commands.test.ts`, `tests/cli-parity.test.ts`, via `npm run test:cli`
- Related docs: [Architecture overview](../architecture/overview.md), [IPC and preload contract](../contracts/ipc-preload.md), [CLI contract](../contracts/cli.md), [Trace schema](../contracts/trace-schema.md), [Performance benchmarks](performance-benchmarks.md), and subsystem docs under `docs/subsystems/`.

## When to run contract tests

Run contract tests when a change touches any of these areas:

- `src/main/ipc/**`, `src/main/index.ts` updater/menu IPC, or any `ipcMain.handle(...)` channel.
- `src/preload/index.ts`, `src/preload/index.d.ts`, or `src/preload/api/**`.
- Shared cross-process types under `src/shared/*`.
- Local performance telemetry helpers under `src/main/perf/**`, `src/renderer/src/perf.ts`, and `src/shared/perf.ts`.
- Chat IPC lifecycle, generated-title persistence, stream completion/error delivery, or trace side effects.
- Model role schema, role resolution, Hermes provider inventory, or chat runtime model selection.
- Chat metadata helpers, context-window inference, context usage display inputs, or generated-title request validation.
- Hermes stream trace event normalization, artifact extraction, or legacy progress parsing.
- Trace persistence, trace event schema, skill-training derivation, or real-app Trace Lab harness expectations.
- Manual Markdown skill import behavior.
- Session cache sync, generated session titles, session cache persistence, local session DB reads, or session search inputs.
- Persistent files/profile behavior that affects renderer-visible data.
- Runtime diagnostics, `ProfileRuntimeManager`, profile runtime handles, profile-aware gateway/chat/title/cron execution, or fail-closed local/SSH/remote profile runtime behavior.
- Runtime revalidation status, chat-backend preparation probes, or user-facing runtime recovery paths.
- SSH config writes, SSH profile command routing, SSH tunnel identity, or remote connection-mode validation.
- Knowledge-service mutation routing, memory/SOUL/skill/toolset profile behavior, or toolset YAML serialization.
- Codex OAuth/auth error classification or recovery actions surfaced from chat failures.
- Package perf scripts, benchmark harnesses, or docs that describe performance artifacts.
- Docs guard rules or the mapped evergreen docs they require.
- CLI command dispatch, output envelopes, streaming events, chat automation, or CLI parity coverage against the preload surface.

For docs-only changes, manually verify links and file references. Run `npm run check:docs` when the change set includes mapped high-risk code/test/script paths, or when updating the guard itself. Run `npm run test:cli` when touching `src/cli/**`, `docs/contracts/cli.md`, or CLI-specific tests. Full test runs are optional unless the docs change alongside source behavior.

## Test responsibilities

### `tests/ipc-handlers.test.ts`

Protects the main/preload IPC channel contract.

Current assertions:

- Main process registers more than 30 `ipcMain.handle(...)` channels.
- Preload invokes more than 30 `ipcRenderer.invoke(...)` channels.
- Every preload invoke channel has a matching main handler.
- Every main handler has a matching preload invoke.
- Every `src/main/ipc/*.ts` module, except `index.ts` and `types.ts`, exports a `register*Ipc(...)` function and is wired by `src/main/ipc/index.ts`.
- Specific newer channels remain present: `run-hermes-backup`, `run-hermes-import`, `read-logs`, `run-hermes-dump`, `list-mcp-servers`, `discover-memory-providers`, `mutate-skills`, `import-skill-markdown`, and `record-local-chat-trace`.
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
- Newer APIs such as backup/import, log viewer, debug dump, MCP server list, memory provider discovery, `mutateSkills`, Markdown skill import, and local chat trace recording exist in both implementation and types.
- Required legacy APIs remain present in implementation and types.
- `ipcRenderer.invoke(...)` and `ipcRenderer.on(...)` channels use quoted kebab-case string channel names.

Run this test when changing:

- `src/preload/api/*.ts`
- `src/preload/api/index.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- Renderer code that starts using a new `window.hermesAPI` method

### CLI contract tests

Protect the CLI entrypoint, parser, output envelopes, command adapters, chat automation, and documented parity with major `window.hermesAPI` domains. The suite is intentionally run through `npm run test:cli` so CLI behavior can be validated without a full Electron test pass.

Current responsibilities by file:

- `tests/cli-parser.test.ts` protects global flags, command token parsing, profile/output defaults, environment defaults such as `MERCURY_PROFILE` and `MERCURY_OUTPUT`, literal `--` handling, help/version paths, and usage errors.
- `tests/cli-output-contract.test.ts` protects JSON success/error envelopes, text rendering expectations, and NDJSON line formatting for stream/progress events.
- `tests/cli-errors.test.ts` protects normalized CLI error codes and exit-code mapping, including usage, unsupported, runtime verification, install, connection, not-found, validation, generic, and interrupted cases.
- `tests/cli-entrypoint.test.ts` protects `runCli(...)` help/version behavior, domain dispatch, and reserved/unsupported domain failures.
- `tests/cli-read-only-commands.test.ts` protects read-only service routing for profiles/agents, sessions, memory, soul, tools, skills, models, credentials, cron, traces, runtime diagnostics, logs, MCP, memory providers, dump, connection, gateway, install, and Hermes status commands.
- `tests/cli-mutating-commands.test.ts` protects mutation routing and side effects for profiles/agents, session cache/title, env/config/model config, connection/SSH settings, gateway, memory/user profile/SOUL/tools, skills, models, credentials, cron, backup/import, runtime revalidation, install/update, Claw migration, and SSH tunnel commands.
- `tests/cli-chat-commands.test.ts` protects `mercury chat send` and `mercury chat title`: positional/`--message`/stdin input, history and messages files, profile/session forwarding, text streaming, `--json` final-only output, `--ndjson` `start`/`chunk`/`trace`/`tool`/`usage`/`done`/`error` events, service error propagation, API-runtime verification failure envelopes/exit `4`, and SIGINT abort exit `130` with mocked chat services.
- `tests/cli-parity.test.ts` protects major preload-domain reservation/documentation in [CLI contract](../contracts/cli.md), chat automation sentinel phrases, and the required NDJSON event names.

Run `npm run test:cli` when changing:

- `src/cli/**`
- `src/main/services/*` behavior consumed by CLI commands
- `src/main/ipc/*` or `src/preload/index.d.ts` in a way that changes a CLI parity decision
- `docs/contracts/cli.md`
- Adjacent docs that describe CLI architecture, subsystem behavior, command examples, output envelopes, or test responsibilities
- CLI docs guard rules or tests

`npm run check:docs` complements the CLI test suite: the `cli-contract` docs guard rule maps `src/cli/**` and `tests/cli-*.test.ts` changes to `docs/contracts/cli.md` and `docs/testing/contract-tests.md`. If the comprehensive CLI reference ever moves outside `docs/contracts/cli.md`, update `scripts/check-docs.mjs` and `tests/docs-guard.test.ts` in the same change.

### `tests/perf-telemetry.test.ts`

Protects local opt-in performance telemetry safety.

Current assertions:

- Generic perf telemetry is disabled by default and does not create files.
- `MERCURY_PERF_DIAG=1` reports enabled config and writes valid NDJSON with the current run id/sample config.
- Legacy `MERCURY_SESSIONS_DIAG=1` still enables session-scoped telemetry for compatibility.
- Secret-like keys and prompt/response/message content fields are redacted before writing.
- Failed timed spans are recorded but the original operation error is rethrown.

Run this test when changing:

- `src/main/perf/telemetry.ts`
- `src/shared/perf.ts`
- Renderer perf helpers or metadata sent through `record-perf-event`
- IPC/preload perf telemetry channels in `src/main/ipc/system.ts`, `src/preload/api/app.ts`, or `src/preload/index.d.ts`

### `tests/chat-ipc-lifecycle.test.ts`

Protects chat IPC lifecycle hardening across streaming, trace side effects, and generated-title persistence.

Current assertions:

- Completion side-effect failures, such as trace finalization errors, do not prevent `chat-done` delivery or handler resolution.
- Pre-send trace setup failures still allow transport startup and stream completion.
- Trace-run creation failures still allow transport startup and stream completion.
- `generate-chat-title` trims request fields, calls the title generator, and persists generated titles with the selected profile.
- Error side-effect failures still deliver a single `chat-error` and reject the handler once.
- Runtime setup failures before transport dispatch surface a visible `chat-error`, reject with the original structured runtime error, and do not install an active chat run.
- Chat sends forward the selected text role into the shared chat service; missing or invalid role inputs normalize to Chat.
- Successful chat completion updates the selected profile's session cache only when Hermes returns a durable session id.
- Missing durable session ids on new API sends emit diagnostics, warning logs, and sanitized `transport.error` trace evidence without creating false session/profile persistence.
- An unmanaged local gateway is stopped and restarted before chat runtime resolution.
- Structured Codex auth recovery metadata is forwarded to the renderer and stored in traces without persisting the raw token error text.

Run this test when changing:

- `src/main/ipc/chat.ts`
- `src/main/services/chat-service.ts`
- `src/main/hermes/runtime.ts`
- `src/main/hermes/title.ts`
- `src/shared/codex-auth-recovery.ts`
- Chat trace setup/finalization behavior in `src/main/trace-store.ts`
- Session title/profile update behavior in `src/main/session-cache.ts`

### `tests/model-roles.test.ts`

Protects the model capability helpers and direct model no-fallback behavior.

Current assertions:

- The stable role set is Chat, Plan, Code, Explore, Research, Review, Design, and Image.
- Every role's resolution chain is self-only.
- Saved model capabilities default to text and do not infer image generation from generic metadata.
- Malformed `config.yaml` returns empty role state instead of throwing.
- Profile overrides shadow global defaults for the same role.
- Missing saved model references can still resolve from their stored provider/model snapshot.
- Chat remains unresolved without a Chat assignment even when legacy `config.yaml` has provider/default fields.
- Code does not resolve from Chat when Code is unassigned.
- Explore does not resolve from Code or Chat when Explore is unassigned.
- Image does not resolve through a text fallback and only reports Codex image capability state.

Run this test when changing:

- `src/shared/models.ts`
- `src/main/hermes/chat-model.ts`
- `src/main/services/config-service.ts`
- `src/main/models.ts`
- Role storage paths, normalization, or fallback semantics

### `tests/hermes-model-inventory.test.ts`

Protects Hermes-backed provider model inventory and the integration between inventory and role listing.

Current assertions:

- Hermes provider/model option payloads map into stable selectable descriptors.
- Providers without models do not create selectable entries.
- Local metadata fallback is configured with Hermes venv Python, Hermes repo cwd, enhanced PATH, `HERMES_HOME`, and `HERMES_AGENT_HOME`.
- When the runtime API is unavailable, local inventory fallback runs through the Hermes venv and selected profile home.
- provider inventory returns Hermes models without reading `models.json` as the catalog.
- Inventory failures return structured unavailable state and do not seed defaults.
- SSH role listing can load model availability from remote Hermes metadata.

Run this test when changing:

- `src/main/services/hermes-model-inventory-service.ts`
- `src/main/services/models-service.ts`
- `src/main/hermes/connection.ts`
- `src/main/install/paths.ts`
- SSH metadata/inventory helpers

### `tests/hermes-runtime.test.ts`

Protects `ProfileRuntimeManager` behavior for profile-scoped Hermes API runtimes.

Current assertions:

- Local profile runtime resolution rejects profile mismatches instead of returning an unverified handle.
- Remote HTTP mode rejects profile-scoped runtime requests.
- SSH mode returns profile-bound API runtime handles.
- Managed local API startup waits briefly for readiness before resolving.
- Runtime diagnostics expose unavailable/stale/mismatch identity state.
- Managed local API ownership verification waits for `gateway.pid` evidence to settle before classifying the runtime.
- Stale or corrupt managed PID evidence remains unavailable when it never settles and does not probe the API as verified.
- Killed managed local gateway children fail closed even when PID evidence matches.

Run this test when changing:

- `src/main/hermes/runtime.ts`
- `src/main/hermes/types.ts`
- `src/shared/runtime.ts`
- Gateway PID ownership evidence, profile-home layout, local API readiness checks, or SSH/remote runtime resolution behavior

### `tests/chat-role-runtime.test.ts`

Protects runtime use of direct agent model config.

Current assertions:

- Direct profile config resolves to provider/model.
- Missing direct model config fails with setup guidance before transport.
- API chat and title requests use the direct agent model.
- API chat captures string and array-shaped `x-hermes-session-id` headers and trims them before completion.
- Successful new API sends without a returned session id emit a missing-session-id diagnostic.
- Resumed API sends use the resumed session id when the response omits the session-id header.

Run this test when changing:

- `src/main/hermes/chat-model.ts`
- `src/main/hermes/chat-api.ts`
- `src/main/hermes/gateway.ts`
- Chat runtime model resolution and direct model dispatch
- API response header/session-id handling or missing-session diagnostics

### `tests/codex-auth-recovery.test.ts`

Protects shared detection of Codex OAuth refresh-token failures that can be recovered through device auth.

Current assertions:

- Known consumed Codex refresh-token errors produce a user-facing refresh message and `codex-auth` recovery action.
- Invalid, expired, revoked, and `invalid_grant` refresh-token variants map to specific recovery reasons for the `openai-codex` provider.
- The same refresh-token text is ignored for non-Codex providers.
- Generic auth failures such as unauthorized, invalid API key, plain `invalid_grant`, or missing authentication are not classified as Codex auth recovery.

Run this test when changing:

- `src/shared/codex-auth-recovery.ts`
- Chat transport error metadata that surfaces Codex auth recovery to renderer or trace events

### `tests/chat-remediation.test.ts`

Protects structured chat remediation classification and redaction.

Current assertions:

- Codex refresh-token run failures classify as assisted `codex-auth` remediation.
- Run failures classify as `debug-prompt` remediations.
- Debug prompts and diagnostics redact bearer tokens, API keys, and secret-shaped strings.
- Runtime invalid-gateway-key and missing-capability setup errors classify as instruction remediations.

Run this test when changing:

- `src/shared/chat-remediation.ts`
- Chat transport error metadata or run failure classification
- Redaction behavior for debug prompts

### `tests/chat-metadata.test.ts`

Protects shared chat metadata helpers used by renderer context usage and generated-title flows.

Current assertions:

- Known model/provider pairs infer expected context-window sizes.
- Explicit context windows take precedence over inferred defaults.
- Unknown models fall back to the default context window.
- Context usage percentages handle normal, zero-window, and negative-token inputs safely.
- Model-generated titles are sanitized and truncated near word boundaries.
- Generated-title request validation accepts supported roles and rejects invalid request shapes.

Run this test when changing:

- `src/shared/chat-metadata.ts`
- Renderer context usage display logic that depends on these helpers
- Main/preload generated-title request or response validation
- Saved model context-window behavior that relies on inference defaults

### `tests/hermes-title.test.ts`

Protects the main-process chat-title generation fallback contract.

Current assertions:

- Existing persisted session titles are sanitized and returned before the model path is attempted.
- Model-call failures after a verified API runtime fall back to a sanitized heuristic title generated from the first user message.
- Runtime verification failures such as unavailable, unverified, or mismatched profile runtimes reject instead of silently persisting a heuristic title.
- Empty message lists fall back to the default heuristic title without requiring runtime setup.

Run this test when changing:

- `src/main/hermes/title.ts`
- `src/main/sessions.ts` title lookup behavior
- `src/main/session-cache.ts` heuristic title generation
- Model config, runtime verification, or gateway connection code used by title generation

### `tests/hermes-trace-events.test.ts`

Protects normalization of Hermes stream events, legacy CLI-style activity/progress labels, and artifact evidence before trace storage. CLI-style normalization is retained for backward-compatibility fixtures and imported text patterns; current chat execution does not use a local CLI fallback transport.

Current assertions:

- Failed image tool progress becomes structured `tool.failed` evidence with sensitive metadata removed.
- Image artifact events are extracted only when assistant text contains image references or supported generated image paths.
- Standalone legacy API progress labels are split from assistant prose without treating ordinary inline code as progress.
- Standalone legacy CLI-style activity lines are suppressible while natural prose remains visible.
- Codex app-server image paths emit both `tool.progress` and `artifact.created` evidence when normalized from legacy CLI-style progress text.

Run this test when changing:

- `src/main/hermes/trace-events.ts`
- `src/shared/traces.ts` event type names used by normalization
- Chat stream parsing that forwards structured trace events to the renderer or trace store
- Trace Lab expectations around artifact evidence or legacy progress compatibility

### `tests/trace-store.test.ts`

Protects focused trace-store persistence behavior and skill-training derivation. It directly covers selected structured event types and sanitization paths; broader stream/CLI normalization, delegation, and transport event-shape coverage lives in `tests/hermes-trace-events.test.ts` and app-level harnesses.

Current assertions:

- Selected structured events (`tool.started` and `artifact.created`) persist through the trace store with secret metadata and detail text redacted.
- `createLocalChatTrace()` creates a completed slash-command run with `run.started`, `message.user`, `slash.local`, optional response preview as `message.agent.delta`, `run.completed`, and sanitized metadata.
- A `skill.eval` trace event with skill metadata is exposed through `listSkillTrainingRuns()` with linked run id, `needs-review` status, parsed score, skill name, and summary.
- A `skill.promoted` event with score metadata above the trust range is clamped to `1`.

Run this test when changing:

- `src/shared/traces.ts`
- `src/main/trace-store.ts`
- Local slash-command trace creation in `src/main/ipc/chat.ts`
- Trace Lab assumptions about skill-training runs

### `src/renderer/src/screens/Skills/Skills.test.tsx`

Protects the Skills screen draft/save UX contract.

Current assertions:

- Skills render grouped by category and category sections collapse.
- Row/category enable/disable actions stage pending changes without immediate backend mutation.
- Save emits one flat ordered `mutateSkills(targets, profile?)` batch.
- Discard clears pending draft state and returns to installed truth.
- Partial batch failures clear successful reflected changes and retain failed changes.
- Thrown save errors retain pending changes.
- Duplicate display-name cases target by directory/path identity rather than display name alone.
- Detail view loads Markdown/metadata/Agents-using-skill and detail Disable stages an uninstall target.
- Refresh/reload rebases pending state against installed truth.
- Manual Markdown import saves pending changes first and aborts import when that pending save fails.

Run this test when changing:

- `src/renderer/src/screens/Skills/Skills.tsx`
- `src/renderer/src/screens/Skills/components/SkillCategorySection.tsx`
- `src/renderer/src/screens/Skills/components/SkillDetailPanel.tsx`
- `src/renderer/src/screens/Skills/components/SkillModals.tsx`
- `src/renderer/src/assets/styles/skills.css`
- `src/shared/i18n/locales/*/skills.ts`
- Renderer-visible behavior of `mutateSkills`, `listInstalledSkills`, `listBundledSkills`, `getSkillContent`, `getSkillMetadata`, or `importSkillMarkdown`

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
- Local `getSkillMetadata()` discovers immediate `scripts/` and `references/` entries used by the Skills detail panel.
- The import path remains compatible with the renderer flow that saves pending enable/disable drafts before import.

Run this test when changing:

- `src/main/skills.ts`
- `src/main/skills/importer.ts`
- `src/shared/skills.ts`
- `src/main/ipc/knowledge.ts` Markdown import handling
- `src/preload/api/knowledge.ts` or `src/preload/index.d.ts` import request/result types
- SSH skill import behavior if local and SSH semantics are intentionally kept aligned

### `tests/knowledge-service.test.ts`

Protects service-level mutation policy for profile knowledge and toolset operations.

Current assertions:

- Local toolset toggles are treated as next-message config writes and do not mark the profile runtime stale or query gateway status.
- SSH toolset toggles follow the same next-message config-write policy and do not mark the profile runtime stale or query gateway status.
- Profile memory mutations still mark the selected profile runtime stale.
- Skill batch mutations run through the per-profile service queue.
- Skill batch mutations mark the selected profile runtime stale once when at least one target changes.
- Partial skill failures are preserved in the ordered batch result.
- Empty, all-failure, and all-no-op skill batches do not mark runtime stale.
- Pure remote HTTP skill mutation fails closed without local/SSH side effects.
- SSH skill batches route through `sshMutateSkills`.

Run this test when changing:

- `src/main/services/knowledge-service.ts`
- `src/main/tools.ts`
- `src/main/memory.ts`
- `src/main/ssh-remote.ts` knowledge/toolset routing
- Runtime stale-marking policy for memory, SOUL, skills, or toolset mutations

### `tests/toolsets-config.test.ts`

Protects local and SSH serialization of Hermes platform toolset configuration.

Current assertions:

- Disabling a local toolset writes explicit empty arrays for both `platform_toolsets.cli` and `platform_toolsets.api_server`.
- Disabling an SSH toolset writes the same explicit empty arrays through the SSH config path.
- Empty toolset arrays are not serialized as dangling YAML keys.

Run this test when changing:

- `src/main/tools.ts`
- `src/main/ssh/config.ts`
- Toolset config YAML parsing/serialization or local/SSH toolset toggle behavior

### `tests/system-service.test.ts`

Protects runtime revalidation failure handling in the system service.

Current assertions:

- Runtime revalidation returns `false` instead of rejecting when chat backend preparation fails.
- Runtime revalidation returns `false` instead of rejecting when the API probe fails.

Run this test when changing:

- `src/main/services/system-service.ts`
- `src/main/services/chat-service.ts` runtime preparation behavior
- `src/main/hermes/chat-api.ts` API probing behavior
- Runtime diagnostics or revalidation UI flows that depend on boolean failure results

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

### `tests/profiles.test.ts`

Protects profile discovery and active-profile marking.

Current assertions:

- Current implementation: profile creation passes upstream Hermes `--no-skills`; clone/config-copy mode copies only default config/API key files and excludes skills. Treat this as current regression coverage, not a long-term product invariant; future default-category skill seeding for new Agents should update these assertions and docs together.
- Profile directories are listed even when they have neither `config.yaml` nor `.env`.
- Profiles with only `.env` expose `hasEnv`.
- Profiles with only `config.yaml` expose parsed provider/model metadata.
- Dotfiles, dot-directories, and non-directory files under the profiles directory are ignored.
- The default profile is returned even when the profiles directory is empty.
- `<HERMES_HOME>/active_profile` marks the active named profile and clears the default active marker.

Run this test when changing:

- `src/main/profiles.ts`
- `src/main/services/sessions-service.ts` profile create/delete/use mode routing
- `src/main/installer.ts` `HERMES_HOME` handling that affects profile paths
- Profile list handlers in `src/main/ipc/config.ts`
- Storage/profile docs that describe active-profile behavior

### `tests/sessions-profile-db.test.ts`

Protects profile-aware local session database reads.

Current assertions:

- `listSessions()` aggregates default and named profile databases, annotates each session with its profile, sorts newest first, and can filter to one profile.
- `searchSessions()` searches the requested profile database, annotates results, and aggregates default plus named profiles when no profile is selected.
- `getSessionMessages()` reads from the profile-specific database when duplicate session ids exist across profiles.

Run this test when changing:

- `src/main/sessions.ts`
- `src/main/ssh/sessions-profiles.ts` if local and SSH profile session semantics are intentionally aligned
- Session list/search/message IPC handlers in `src/main/ipc/sessions.ts`
- Storage/profile docs that describe profile-aware session data

### `tests/reliable-profile-runtime-contract.test.ts`

Protects the reliable profile runtime contract across runtime diagnostics, profile isolation, verified runtime handles, gateway lifecycle, chat/title/cron execution, and fail-closed SSH/remote behavior. This is a sentinel-style contract test: it checks that high-risk source paths still contain the expected runtime integration points and that direct API chat execution refuses unverified runtime handles.

Current assertions:

- The shared runtime diagnostic surface includes selected/requested/actual profile identity, verification source, API/port/process paths, auth fingerprint/source, verification timestamp, stale reason, mismatch reason, and unsupported reason fields.
- Main-process runtime types expose `ProfileRuntimeRequest`, `RuntimeIdentity`, `ProfileRuntimeHandle`, `ProfileRuntimeError`, and the profile-runtime error codes for mismatch, unverified runtime, and unsupported remote profile behavior.
- `ProfileRuntimeManager` keeps per-profile runtime state, can create unverified external identities, marks one or all runtimes stale, exposes diagnostics, and models unsupported pure remote profile behavior.
- Gateway lifecycle stays profile-aware from renderer calls through preload IPC into main local/SSH handlers, including profile-aware gateway status/start/stop/restart and remote-mode fail-closed behavior.
- Chat startup, gateway chat sending, title generation, and cron execution route through verified `ProfileRuntimeHandle` instances rather than ad-hoc API URL/auth lookup.
- API-only runtime sentinels prevent fallback reintroduction: production runtime/gateway code must not re-add `sendMessageViaCli`, `src/main/hermes/chat-cli.ts`, `createCliRuntimeHandle`, `preferTransport === "cli"`, `"cli-args"`, or executable `transport: "cli"` paths for chat/title/cron.
- API chat transport requires a verified runtime handle and uses the handle's API base URL and auth headers.
- SSH runtime, config, skills, and tunnel helpers remain profile-bound; pure remote HTTP mode rejects profile-specific runtime verification instead of silently using the wrong profile.
- Runtime diagnostics and stale-state warnings surface through IPC, preload, Layout, Gateway, Chat, Settings, and the runtime diagnostic notice component.
- Storage-isolation documentation remains explicitly separated from runtime-isolation documentation.

Run this test when changing:

- `src/shared/runtime.ts`
- `src/main/hermes/types.ts`
- `src/main/hermes/runtime.ts`
- `src/main/hermes/gateway.ts`
- `src/main/hermes/chat-api.ts`
- `src/main/hermes/title.ts`
- `src/main/cronjobs.ts`
- `src/main/ipc/chat.ts`, `src/main/ipc/gateway.ts`, `src/main/ipc/config.ts`, `src/main/ipc/system.ts`, or `src/main/ipc/knowledge.ts`
- `src/main/ssh/runtime.ts`, `src/main/ssh/config.ts`, `src/main/ssh/skills.ts`, or `src/main/ssh-tunnel.ts`
- `src/preload/api/navigation.ts`, `src/preload/api/app.ts`, or `src/preload/index.d.ts`
- Renderer runtime diagnostic surfaces in Layout, Chat, Gateway, Settings, or `src/renderer/src/components/RuntimeDiagnosticNotice.tsx`
- Documentation that describes profile runtime isolation, runtime diagnostics, or reliable profile runtime behavior

### `tests/ssh-remote.test.ts`

Protects SSH remote config-write validation and profile/skill command safety before shelling out to the remote host.

Current assertions:

- `sshSetConfigValue()` rejects quote, backslash, newline, and carriage-return values before issuing remote config writes.
- SSH profile creation uses singular `hermes profile create`, currently passes `--no-skills`, and does not hide failures behind a `mkdir -p` fallback. Future default-category skill seeding should remain an explicit post-create behavior, not an implicit profile-create fallback.
- SSH skill mutations preserve profile-aware command routing and exact-target uninstall safety.

Run this test when changing:

- `src/main/ssh-remote.ts`
- `src/main/ssh-tunnel.ts` config types used by remote writes
- Connection-mode docs that describe SSH remote config updates

## Deterministic docs guard

`npm run check:docs` runs `scripts/check-docs.mjs`, which maps high-risk code/test/script paths to evergreen docs. `tests/docs-guard.test.ts` covers the exported evaluator rules, evergreen-doc matching, historical-doc rejection, explicit acknowledgements, and unmapped-file behavior. The guard checks unstaged, staged, and untracked files by default, supports `--staged` to narrow to staged changes only, and supports `--base <ref>` with optional `--head <ref>` for range checks.

When a mapped high-risk file changes, the preferred fix is to update at least one mapped evergreen doc in the same change set. If no doc update is needed, acknowledge deliberately with a short reason:

```bash
node scripts/check-docs.mjs --ack "internal refactor, documented contract unchanged"
MERCURY_DOCS_GUARD_ACK="internal refactor, documented contract unchanged" npm run check:docs
```

Historical investigations under `docs/investigations/**` are evidence and do not satisfy the guard unless a rule explicitly maps them.

## Opt-in performance benchmarks

Performance benchmarks are intentionally threshold-free unless a test documents a specific regression guard. They are local artifact producers, not always-on CI checks.

- `npm run perf:build` runs a production build and writes a bundle snapshot through `scripts/perf-build-snapshot.mjs`.
- `npm run perf:startup` runs a production build and launches the built Electron app through `scripts/e2e-startup-perf.mjs` with `MERCURY_PERF_DIAG=1`.
- `npm run perf:chat-render` uses the env-gated synthetic chat stream and writes chat render/jank artifacts.
- `npm run perf:sessions:bench` enables `tests/sessions-local-latency.bench.test.ts` with `MERCURY_SESSIONS_BENCH=1`.
- `npm run perf:sessions:e2e` drives the built Sessions UI and labels the 300ms search debounce in artifacts.
- `npm run perf:trace-store` enables `tests/trace-store-stress.bench.test.ts` with `MERCURY_TRACE_STORE_BENCH=1`.
- `npm run perf:ssh-remote` is external-network-dependent and should report skipped/dependency status when credentials or reachable hosts are unavailable.

See [Performance benchmarks](performance-benchmarks.md) for environment flags, artifact paths, and measured-evidence reporting rules.

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

The image-generation scenario is enabled by default when the `image_gen` toolset is enabled. For Codex-backed runs, the harness configures `image_gen.provider: openai-codex`, which uses Hermes' bundled Codex image path and does not require `FAL_KEY` or `OPENAI_API_KEY`. `FAL_KEY` is passed through only when present as an optional credential for non-Codex image backends. Use `TRACE_LAB_E2E_SKIP_IMAGE=1` only for a reduced local validation, not for release hardening. See [Codex image generation](../subsystems/codex-image-generation.md) for the canonical `image_gen` / `$imagegen` usage rules, artifact handling, and troubleshooting guidance.

The harness expects the richer trace contract now emitted by the app path, including `session.resumed`, `message.history.loaded`, structured `tool.*`, `delegation.*`, `artifact.created`, `transport.error`, and `slash.local` evidence where the scenario applies. Existing coarse run lifecycle evidence remains a hard requirement. The image-generation scenario only passes when a completed run contains `artifact.created` image evidence; traced provider/tool-unavailable failures are reported as `DEPENDENCY`, not image success. Page/context closures, manual app closes, timeouts, and other harness interruptions are reported as `FAIL` harness failures.

## Recommended commands

Run targeted contract tests during focused changes:

```bash
npm run test -- tests/perf-telemetry.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run test -- tests/chat-ipc-lifecycle.test.ts tests/chat-metadata.test.ts tests/hermes-title.test.ts tests/hermes-trace-events.test.ts
npm run test -- tests/chat-role-runtime.test.ts tests/codex-auth-recovery.test.ts tests/system-service.test.ts
npm run test -- tests/trace-store.test.ts tests/skills-import.test.ts tests/knowledge-service.test.ts tests/toolsets-config.test.ts
npm run test -- tests/session-cache-sync.test.ts tests/profiles.test.ts tests/sessions-profile-db.test.ts
npm run test -- tests/hermes-runtime.test.ts tests/reliable-profile-runtime-contract.test.ts tests/ssh-remote.test.ts
```

Run the docs guard when mapped high-risk code/test/script paths change, and for CLI documentation sweeps that should prove the guarded `docs/contracts/cli.md` anchor remains sufficient:

```bash
npm run check:docs
```

Run the CLI suite when the CLI contract/reference, adjacent CLI docs, CLI dispatchers, or shared services consumed by the CLI change:

```bash
npm run test:cli
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
npm run check:docs
npm run check:loc

# Local perf artifacts when practical
npm run perf:build
npm run perf:startup
```

`npm run lint` is also desirable when source changes are involved, but treat unrelated pre-existing lint failures separately from the contract change being validated.

## Update policy

When adding or changing a contract test or docs guard rule:

1. Name the source files and behavior the test or guard rule protects.
2. Add the test or guard rule to this document if it covers IPC/preload, shared schemas, persistence, connection modes, user-visible workflows, docs freshness, or high-risk regressions.
3. Link the test or guard from the relevant evergreen architecture, contract, subsystem, or contributor doc.
4. Keep historical reports and investigations as evidence only; do not rely on them as the current test map.
