# Investigation: Evergreen Docs Freshness

## Summary
Mercury's evergreen docs are broadly useful but not fully up to date with current source behavior. Confirmed drift is concentrated in cross-boundary changes: chat IPC/preload APIs, live trace activity rendering, generated chat titles, model context-window metadata, active-profile discovery, connection-mode restart nuance, SSH skills behavior, and newer contract-style tests.

## Symptoms
- User asked to investigate the evergreen docs to make sure they are up to date.
- The canonical evergreen docs are listed in `docs/index.md` under Architecture, Contracts, Subsystems, Testing, plus `brand/README.md`.
- This is a read-only investigation; no source or documentation fixes should be applied in this pass.

## Background / Prior Research
No external research was required; this investigation compares repository documentation against current repository source and tests.

## Investigator Findings
<!-- Pair investigator appends structured source-vs-doc findings here. -->

### 2026-05-16 freshness verification

#### 1. IPC/preload and chat docs omit current chat title + live trace event channels
- **Doc claim:** `docs/contracts/ipc-preload.md` lists chat invoke channels as only `send-message` and `abort-chat` (`docs/contracts/ipc-preload.md:72`), and chat event channels as `chat-chunk`, `chat-done`, `chat-tool-progress`, `chat-usage`, and `chat-error` (`docs/contracts/ipc-preload.md:98-100`). `docs/subsystems/chat-and-tracing.md` likewise lists preload chat APIs from `sendMessage(...)` through `onChatError(...)` but not title generation or live trace events (`docs/subsystems/chat-and-tracing.md:60-70`).
- **Source/test evidence:** Main registers `generate-chat-title` (`src/main/ipc/chat.ts:400-407`), preload exposes `generateChatTitle` invoking that channel (`src/preload/api/chat.ts:23-24`), and `HermesAPI` types declare it (`src/preload/index.d.ts:117`). Main also emits live activity events on `chat-trace-event` (`src/main/ipc/chat.ts:76-82`, `src/main/ipc/chat.ts:323-335`, `src/main/ipc/chat.ts:342-350`), preload exposes `onChatTraceEvent` (`src/preload/api/chat.ts:52-56`), and types declare it (`src/preload/index.d.ts:122`). Surface tests now assert both APIs (`tests/preload-api-surface.test.ts:154-163`, `tests/preload-api-surface.test.ts:192-198`); chat IPC tests cover profile-aware generated title persistence (`tests/chat-ipc-lifecycle.test.ts:289-305`).
- **Conclusion:** Drift confirmed. Source/preload/types/tests are aligned; `ipc-preload.md` and `chat-and-tracing.md` are stale.
- **Recommendation:** Add `generate-chat-title` / `generateChatTitle` and `chat-trace-event` / `onChatTraceEvent` to both the IPC contract and chat subsystem docs.

#### 2. Chat subsystem doc still centers the old tool-progress-label model
- **Doc claim:** `docs/subsystems/chat-and-tracing.md` says renderer state includes a single `tool progress label` (`docs/subsystems/chat-and-tracing.md:23-28`), listeners clear/store that label (`docs/subsystems/chat-and-tracing.md:32-38`), `handleClear()` clears tool progress (`docs/subsystems/chat-and-tracing.md:56-58`), and main callbacks record/send `tool.progress` plus `chat-tool-progress` (`docs/subsystems/chat-and-tracing.md:108-113`).
- **Source/test evidence:** The renderer now maintains `activityGroups` and `titleGenerationPending` (`src/renderer/src/screens/Chat/hooks/useChatController.ts:54-57`), appends activity events from `onChatTraceEvent(...)` (`src/renderer/src/screens/Chat/hooks/useChatController.ts:155-179`, `src/renderer/src/screens/Chat/hooks/useChatController.ts:358`), renders grouped activity cards (`src/renderer/src/screens/Chat/Chat.tsx:84-107`), generates titles after the first eligible user message (`src/renderer/src/screens/Chat/hooks/useChatController.ts:451-484`), and computes context usage from token usage plus inferred/saved context windows (`src/renderer/src/screens/Chat/hooks/useChatController.ts:686-695`; header display at `src/renderer/src/screens/Chat/components/ChatHeader.tsx:52-60`, `src/renderer/src/screens/Chat/components/ChatHeader.tsx:81-84`). The richer trace schema doc is mostly current here: it describes structured `tool.*`/`delegation.*`/artifact/transport events and legacy `chat-tool-progress` compatibility (`docs/contracts/trace-schema.md:32-37`, `docs/contracts/trace-schema.md:199-217`).
- **Conclusion:** Drift confirmed for `chat-and-tracing.md`; `trace-schema.md` is substantially more current and can be used as the source for updating chat docs.
- **Recommendation:** Rewrite the chat renderer/callback sections around activity groups, live trace events, generated titles, context-usage display, and legacy `chat-tool-progress` compatibility instead of a single label.

#### 3. Storage/profiles docs miss `active_profile`, `src/main/profiles.ts`, and saved-model `contextWindow`
- **Doc claim:** Source anchors omit `src/main/profiles.ts` (`docs/subsystems/storage-and-profiles.md:5-16`), the persistent-file table omits `<HERMES_HOME>/active_profile` (`docs/subsystems/storage-and-profiles.md:28-47`), and the saved model fields/behavior omit `contextWindow` and say `updateModel(...)` only updates name/provider/model/baseUrl (`docs/subsystems/storage-and-profiles.md:93-117`).
- **Source/test evidence:** `src/main/profiles.ts` reads `<HERMES_HOME>/active_profile`, defaults to `default`, and marks profile `isActive` from that file (`src/main/profiles.ts:87-95`, `src/main/profiles.ts:106-128`); `setActiveProfile(...)` delegates to `hermes profile use <name>` (`src/main/profiles.ts:240-254`). `tests/profiles.test.ts` verifies `active_profile` drives active flags (`tests/profiles.test.ts:104-113`). `SavedModel` includes optional `contextWindow` (`src/main/models.ts:11-18`), reads normalize it through `inferContextWindow(...)` (`src/main/models.ts:21-37`), defaults seed/add it (`src/main/models.ts:47-63`, `src/main/models.ts:82-90`), and `updateModel(...)` accepts `contextWindow`, deleting/re-inferring it when provider/model changes without an explicit value (`src/main/models.ts:104-121`). Inference rules are in `src/shared/chat-metadata.ts:14-79` and tested in `tests/chat-metadata.test.ts:10-41`.
- **Conclusion:** Drift confirmed.
- **Recommendation:** Add `src/main/profiles.ts` to anchors, document `<HERMES_HOME>/active_profile`, and update model schema/behavior around `contextWindow`, explicit vs inferred windows, and update re-inference.

#### 4. Connection modes doc omits platform-toggle restart behavior
- **Doc claim:** Restart triggers list env-key, model-config, SSH model-config, and skill-import warnings, but not platform toggles (`docs/subsystems/connection-modes.md:168-173`).
- **Source evidence:** `set-platform-enabled` in local mode writes config and restarts the gateway when `isGatewayRunning()` is true (`src/main/ipc/gateway.ts:54-65`). In SSH mode the same handler calls `sshSetPlatformEnabled(...)` and returns without restart (`src/main/ipc/gateway.ts:54-59`); the SSH helper edits remote config only (`src/main/ssh/runtime.ts:129-159`). The Gateway renderer optimistically toggles and rechecks status after the possible restart (`src/renderer/src/screens/Gateway/Gateway.tsx:52-59`).
- **Conclusion:** Drift confirmed.
- **Recommendation:** Add local platform toggles as a restart trigger, and explicitly note that SSH platform toggles currently update remote config without an automatic remote gateway restart.

#### 5. Skills docs are mostly current, but SSH/pure-remote nuance should be sharper
- **Doc claim:** The skills doc covers local APIs, SSH mode, pure remote HTTP rejection for manual Markdown import, and gateway restart warnings (`docs/subsystems/skills.md:18-27`, `docs/subsystems/skills.md:200-222`). It says local install/uninstall pass `-p <profile>` for non-default profiles (`docs/subsystems/skills.md:57-75`) and SSH install/uninstall run remote Hermes commands (`docs/subsystems/skills.md:204-216`).
- **Source evidence:** Local install/uninstall do insert `-p <profile>` (`src/main/skills.ts:231-239`, `src/main/skills.ts:260-268`). SSH IPC intentionally ignores the `_profile` argument for install/uninstall (`src/main/ipc/knowledge.ts:140-155`), and SSH install/uninstall helpers accept no profile and run plain `hermes skills install <identifier> --yes` / `hermes skills uninstall <name>` (`src/main/ssh/skills.ts:73-85`). SSH installed-skill listing and remote Markdown import are profile-aware (`src/main/ssh/skills.ts:11-16`, `src/main/ssh/skills.ts:91-116`). SSH `list-bundled-skills` is not a remote repo walk; it calls `sshSearchSkills(config, "")`, which shells out to `hermes skills browse --query "" --json` (`src/main/ssh/skills.ts:147-170`), while IPC routes `list-bundled-skills` to SSH only in SSH mode (`src/main/ipc/knowledge.ts:129-132`). Pure remote HTTP mode only has an explicit reject path for manual Markdown import; other skill handlers branch for SSH only and otherwise use local helpers (`src/main/ipc/knowledge.ts:123-177`), matching the doc's warning (`docs/subsystems/skills.md:218-222`).
- **Conclusion:** Partial drift/ambiguity. The pure-remote warning is current, but SSH install/uninstall profile handling and remote bundled-skill browsing are under-specified.
- **Recommendation:** Add a callout that SSH install/uninstall currently ignore selected profile, while SSH list/import are profile-aware; document that SSH bundled browsing uses remote `hermes skills browse --query "" --json` rather than bundled-repo filesystem traversal.

#### 6. Contract-test docs omit newer contract-like tests and overstate trace-store breadth
- **Doc claim:** `docs/testing/contract-tests.md` maps only five contract-test files in source anchors (`docs/testing/contract-tests.md:7-11`) and sections (`docs/testing/contract-tests.md:30-131`). It also claims `tests/trace-store.test.ts` verifies structured event types such as tool/delegation/artifact/transport/local command events (`docs/testing/contract-tests.md:74-83`).
- **Test evidence:** Newer contract-like tests are not represented: chat IPC lifecycle/title/profile resilience (`tests/chat-ipc-lifecycle.test.ts:202-319`), chat metadata/title/context helpers (`tests/chat-metadata.test.ts:9-67`, `tests/hermes-title.test.ts:27-56`), Hermes trace-event normalization/artifact extraction (`tests/hermes-trace-events.test.ts:11-75`), profile listing/active-profile behavior (`tests/profiles.test.ts:43-114`), profile-aware local session DB behavior (`tests/sessions-profile-db.test.ts:86-121`), and SSH remote config-write behavior (`tests/ssh-remote.test.ts:14-15`). Actual trace-store core tests persist `tool.started`, `artifact.created`, and local `slash.local`/`message.agent.delta` paths (`tests/trace-store.test.ts:36-89`), while skill extraction covers `skill.eval` and `skill.promoted` (`tests/trace-store.test.ts:92-128`); delegation and transport persistence are not directly asserted there.
- **Conclusion:** Drift confirmed. The doc omits several contract-like tests and slightly overstates `trace-store.test.ts` coverage.
- **Recommendation:** Add sections for the newer tests and narrow the trace-store claim, cross-linking `tests/hermes-trace-events.test.ts` for structured event normalization coverage.

#### 7. Brand docs align with source and generated assets
- **Doc claim:** `brand/README.md` names `brand/source/mercury-logo-source.png` as canonical, instructs `npm run brand:generate` / `npm run brand:check`, and says generated Electron/renderer/docs assets derive from the source (`brand/README.md:1-17`).
- **Source/check evidence:** Package scripts define `brand:generate` and `brand:check` (`package.json:19-20`). The generator uses `brand/source/mercury-logo-source.png`, derives committed output paths for build/resources/renderer/docs icons, pins expected source hash/dimensions, and check mode byte-compares generated assets (`scripts/generate-brand-assets.mjs:10-18`, `scripts/generate-brand-assets.mjs:34-36`, `scripts/generate-brand-assets.mjs:118-147`, `scripts/generate-brand-assets.mjs:175-183`). `npm run brand:check` exited 0 with `Mercury brand assets are in sync.`
- **Conclusion:** No freshness issue found.
- **Recommendation:** No evergreen doc change needed for brand.

#### 8. `docs/index.md` historical evidence list is incomplete but likely curated, not stale
- **Doc claim:** `docs/index.md` says historical evidence is contextual and should not be treated as primary current behavior (`docs/index.md:34-36`). It lists selected investigations/reports/plans under category headings (`docs/index.md:38-62`).
- **Repository evidence:** The investigations directory contains additional dated files beyond the two listed in the index, including this investigation report and 2026-05-14 investigations. However, the index does not explicitly claim the historical-evidence list is exhaustive.
- **Conclusion:** Not a clear freshness issue. This is a curated-list ambiguity rather than source-vs-doc drift.
- **Recommendation:** If future agents are expected to find every historical evidence file through the index, rename the section to "Selected historical evidence" or expand it; otherwise leave as curated.


## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The evergreen docs may have drifted from current Electron main/preload/renderer source, shared schemas, tests, and packaging scripts.
**Findings:** `docs/index.md` defines the evergreen set and says historical docs should be treated only as context. No `AGENTS.md` exists in the repository root.
**Evidence:** `docs/index.md`; `CONTRIBUTING.md`; file search for `AGENTS.md` returned no matches.
**Conclusion:** Continue with Context Builder to discover source and docs most relevant to freshness/parity checks.

### Phase 2 - Context Builder
**Hypothesis:** Broad selection is required because evergreen freshness crosses main IPC, preload, renderer chat, shared schemas, storage/profile helpers, skills, tests, and brand scripts.
**Findings:** Context Builder selected the evergreen docs plus high-risk source/test files and identified likely drift around chat title/live trace APIs, renderer activity groups, profile/model storage, connection restarts, skills SSH nuance, and contract-test coverage.
**Evidence:** Selected context included `docs/index.md`, all evergreen docs, `src/main/ipc/*`, `src/preload/api/*`, `src/preload/index.d.ts`, chat/tracing files, storage/profile/model files, skills files, tests, `brand/README.md`, `scripts/generate-brand-assets.mjs`, `package.json`, and `electron-builder.yml`.
**Conclusion:** Proceeded to pair investigation with targeted hypotheses.

### Phase 3 - Pair Investigation
**Hypothesis:** Candidate drift areas from Context Builder can be verified or rejected by comparing exact doc claims against source/tests.
**Findings:** Pair investigator confirmed six substantive drift areas, found brand docs aligned, and treated the `docs/index.md` historical-evidence list as curated ambiguity rather than definite drift.
**Evidence:** See `## Investigator Findings` above for file:line evidence.
**Conclusion:** Main freshness issues are confirmed and scoped to documentation updates; no source behavior bug was found.

### Phase 4 - Oracle Synthesis and Spot Checks
**Hypothesis:** Pair findings need synthesis and edge-case wording before final conclusions.
**Findings:** Oracle agreed the findings are well-supported, with wording adjustments: avoid overclaiming generated-title profile scoping end-to-end, distinguish pure-remote skill handler fallback from normal user workflows, narrow trace-store test claims, and leave `docs/index.md` as optional curated-list ambiguity.
**Evidence:** Direct spot checks confirmed stale IPC docs at `docs/contracts/ipc-preload.md:72` and `docs/contracts/ipc-preload.md:98-100` vs `src/preload/api/chat.ts:23-56` and `src/main/ipc/chat.ts:76-82`, stale chat state docs at `docs/subsystems/chat-and-tracing.md:20-70` vs `src/renderer/src/screens/Chat/hooks/useChatController.ts:54-57`, `src/renderer/src/screens/Chat/hooks/useChatController.ts:155-179`, `src/renderer/src/screens/Chat/hooks/useChatController.ts:445-489`, and `src/renderer/src/screens/Chat/hooks/useChatController.ts:682-695`; stale storage docs at `docs/subsystems/storage-and-profiles.md:5-16`, `docs/subsystems/storage-and-profiles.md:28-47`, and `docs/subsystems/storage-and-profiles.md:93-117` vs `src/main/profiles.ts:87-128` and `src/main/models.ts:11-37`, `src/main/models.ts:104-121`; stale connection restart docs at `docs/subsystems/connection-modes.md:168-173` vs `src/main/ipc/gateway.ts:54-65` and `src/main/ssh/runtime.ts:129-160`; and stale test docs at `docs/testing/contract-tests.md:7-11`, `docs/testing/contract-tests.md:74-83` vs newer tests and actual `tests/trace-store.test.ts:36-128` coverage.
**Conclusion:** Final report can state documentation drift is confirmed, source contracts are internally aligned by code/tests, and the corrective work is doc refresh plus preventive process.

## Root Cause
Mercury's evergreen docs are manually source-anchored, but recent cross-boundary feature work landed faster than the docs map was refreshed. The largest drift came from changes that span multiple layers at once: generated chat titles, live structured chat trace events, renderer activity groups, model context-window metadata, profile discovery/active-profile state, gateway restart behavior, SSH skill handling, and new contract-style tests.

Existing tests protect important implementation contracts across main IPC, preload, shared types, and persistence, but they do not enforce documentation parity. Event-channel drift is especially easy to miss because invoke-channel/API parity is tested more directly than main-to-renderer event documentation.

## Recommendations
1. Update `docs/contracts/ipc-preload.md` and `docs/subsystems/chat-and-tracing.md` first: add `generate-chat-title` / `generateChatTitle`, add `chat-trace-event` / `onChatTraceEvent`, document activity groups as the current renderer model, retain `chat-tool-progress` as legacy compatibility, and document generated-title lifecycle, context usage, and fast mode.
2. Update `docs/subsystems/storage-and-profiles.md`: add `src/main/profiles.ts` to source anchors, list `<HERMES_HOME>/active_profile`, document profile listing/active marking, and add saved-model `contextWindow` persistence, normalization, and re-inference behavior.
3. Update `docs/subsystems/connection-modes.md`: add local/non-SSH platform-toggle gateway restart behavior and note that SSH platform toggles update remote config without automatic remote gateway restart.
4. Update `docs/subsystems/skills.md`: clarify that SSH install/uninstall currently ignore selected profile, SSH list/import are profile-aware, and SSH bundled-skill listing uses remote `hermes skills browse --query "" --json`.
5. Update `docs/testing/contract-tests.md`: add `chat-ipc-lifecycle`, `chat-metadata`, `hermes-title`, `hermes-trace-events`, `profiles`, and `sessions-profile-db`; optionally add `ssh-remote.test.ts`; narrow the `trace-store.test.ts` description to what it directly asserts.
6. Leave `brand/README.md` unchanged unless adding a convenience list of generated output paths. Treat the `docs/index.md` historical list as curated unless the project wants it to be exhaustive.

## Preventive Measures
- Require every new `window.hermesAPI` method, IPC invoke channel, or preload event listener to update `docs/contracts/ipc-preload.md`.
- Require every new chat/trace event type or renderer activity behavior to update `docs/subsystems/chat-and-tracing.md` and, when schema-related, `docs/contracts/trace-schema.md`.
- Require every new contract-like test to be added to `docs/testing/contract-tests.md`.
- Add a lightweight future parity check for main-to-renderer event channels, since current invoke/type parity does not fully catch event-listener documentation drift.
- Add a PR checklist item: “Evergreen docs updated or explicitly not affected” for changes under `src/main/ipc/**`, `src/preload/**`, `src/shared/**`, chat/tracing, storage/profiles, connection modes, skills, models, or brand scripts.
