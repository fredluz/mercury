# Investigation: Sessions Resume and Profile Metadata

## Summary
The Sessions screen is losing profile context. Rows display `unknown profile` because cache sync creates session rows from SQLite data that has no profile field, while profile metadata is only written later if chat completion returns a session id; resume is unreliable because row clicks pass only `sessionId/title`, main reads only the default `HERMES_HOME/state.db`, and an empty transcript causes Chat to clear the selected resume id.

## Symptoms
- Sessions list renders recent conversation rows with titles, timestamps, message counts, and models.
- Clicking/opening a listed session does not resume that conversation in Chat as expected.
- Session rows show `unknown profile` for all conversations.
- Screenshot taken on 2026-05-14 shows multiple sessions with known agent activity but missing displayed profile names.

## Background / Prior Research
- Git archaeology probe (2026-05-14) identified the likely regression window as May 14 commits `2ee2ec5` → `79276c1` → `c3ab937`.
- Strongest profile-display regression candidate: `79276c1` ("Show session agent profiles"), which changed `src/main/session-cache.ts`, `src/main/ipc/sessions.ts`, `src/renderer/src/screens/Sessions/Sessions.tsx`, `src/main/sessions.ts`, `src/main/ipc/chat.ts`, `src/preload/index.d.ts`, and tests. Current HEAD evidence from the probe: Sessions UI falls back to `"unknown profile"` when `session.profile` is absent; profile cache updates are tied to completion/update paths.
- Strongest resume/list regression candidate: `c3ab937` ("Capture current Mercury updates"), which heavily changed `src/main/ipc/sessions.ts`, `src/main/session-cache.ts`, `src/renderer/src/screens/Sessions/Sessions.tsx`, and related preload/chat APIs. Current HEAD evidence from the probe: session row click calls `onResumeSession(sessionId, title)` and Layout loads DB messages by session id before switching to chat.
- Foundational IPC/preload split candidate: `d89fb67` (2026-05-13, "refactor: split ipc and preload bridge"), which centralized sessions/profile IPC wiring in `src/main/ipc/sessions.ts` and `src/preload/api/navigation.ts`.
- Secondary profile metadata candidate: `e68408e` (2026-05-03) changed `src/main/profiles.ts` so profile directory discovery behavior can affect profile availability.

## Investigator Findings
<!-- Pair investigator will append structured analysis here with file:line refs, evidence, and conclusions. -->

### Pair Investigation - Sessions Resume/Profile Flow (2026-05-14)

#### Scope and method
- Traced the current HEAD flow from Sessions row render/click through renderer state, preload IPC, main-process session DB lookup, chat state, chat completion, session-id capture, and session-cache profile writes.
- Spot-checked three focused reconnaissance probes: Hermes profile/state DB path construction, tests around session/profile/resume, and API/transport session-id/resume behavior.
- This was read-only except for appending this report section; no source files were changed.

#### Flow: Sessions row render/click -> Layout -> preload IPC -> main lookup -> Chat state
- `src/renderer/src/screens/Sessions/Sessions.tsx:4-12` defines `CachedSession.profile?: string`; `src/renderer/src/screens/Sessions/Sessions.tsx:106-109` formats missing/blank profiles as `"unknown profile"`.
- Normal rows render the profile chip from `session.profile` at `src/renderer/src/screens/Sessions/Sessions.tsx:142-146` and invoke `onResumeSession(s.id, s.title)` at `src/renderer/src/screens/Sessions/Sessions.tsx:311-318`. Search rows do the same with `r.profile`/`r.sessionId` at `src/renderer/src/screens/Sessions/Sessions.tsx:238-276`.
- `src/renderer/src/screens/Layout/Layout.tsx:180-198` is the resume bridge: it calls `window.hermesAPI.getSessionMessages(sessionId)`, maps DB messages into renderer messages, then sets `messages`, `currentSessionId`, `currentSessionTitle`, bumps `conversationVersion`, and navigates to chat.
- Preload forwards `getSessionMessages(sessionId)` unchanged via `ipcRenderer.invoke("get-session-messages", sessionId)` at `src/preload/api/navigation.ts:48-59`.
- Main IPC handles that without any profile argument: SSH mode calls `sshGetSessionMessages(conn.ssh, sessionId)`, local mode calls `getSessionMessages(sessionId)` at `src/main/ipc/sessions.ts:107-112`.
- Local `getSessionMessages()` always opens `DB_PATH = join(HERMES_HOME, "state.db")` (`src/main/sessions.ts:5-6`, `src/main/sessions.ts:35-38`) and filters only `role IN ('user', 'assistant')` with non-null content (`src/main/sessions.ts:169-187`). If the session lives in another profile DB, if the root DB is absent, or if the selected session has no qualifying user/assistant messages, it returns `[]`.
- The chat hook then has a destructive empty-message side effect: `src/renderer/src/screens/Chat/hooks/useChatController.ts:295-305` clears `hermesSessionId`, usage, activity groups, and title state whenever `messages.length === 0`. Because the hook’s `[sessionId]` effect sets `hermesSessionId` at `src/renderer/src/screens/Chat/hooks/useChatController.ts:96-98` before the later `[messages]` effect, an empty resumed transcript can leave the local `hermesSessionId` null. Subsequent sends use `hermesSessionId || undefined`, not the prop, at `src/renderer/src/screens/Chat/hooks/useChatController.ts:520-527`, so the continuation may start as a new conversation rather than resuming the clicked row.
- Conclusion for hypothesis 2: largely proven. The row click can successfully switch to Chat but appear blank when `getSessionMessages()` returns `[]`; the empty-message effect can then clear the local resume id, making continuation unreliable. The highest-risk causes for `[]` are wrong DB root/profile and role/content filtering.

#### Flow: Chat completion -> session id capture -> `updateSessionProfile()` -> cache -> Sessions profile chip
- Renderer sends the current local `hermesSessionId` as the resume id in normal sends (`src/renderer/src/screens/Chat/hooks/useChatController.ts:520-527`) and resolves a returned session id from `result.sessionId || hermesSessionId` at `src/renderer/src/screens/Chat/hooks/useChatController.ts:529-535`.
- Main chat IPC defines `{ response: string; sessionId?: string }` at `src/main/ipc/chat.ts:33`, forwards `resumeSessionId` and `history` into the Hermes gateway at `src/main/ipc/chat.ts:358-366`, and on completion runs `updateSessionProfile(sessionId, profile)` only when the transport callback supplies a truthy `sessionId` (`src/main/ipc/chat.ts:248-256`). It then emits `chat-done` and resolves the invoke response with that same id (`src/main/ipc/chat.ts:257-258`).
- `updateSessionProfile()` only writes the desktop cache. It normalizes a blank profile to `default` (`src/main/session-cache.ts:84-87`), finds/updates an existing cache entry or reads a row from the same root DB before inserting (`src/main/session-cache.ts:267-313`). If the transport never returns a session id, or the row is in a profile-specific DB not visible through root `HERMES_HOME/state.db`, the profile write does not happen.
- `syncSessionCache()` cannot derive profile metadata from SQLite. It selects only `id`, `started_at`, `source`, `message_count`, `model`, and `title` from `sessions` (`src/main/session-cache.ts:147-155`), then for new rows calls `cachedSessionFromRow(db, row)` without profile overrides (`src/main/session-cache.ts:181-183`). For existing rows it updates message count/model/title but does not backfill profile (`src/main/session-cache.ts:168-179`).
- `listCachedSessions()` simply slices the JSON cache (`src/main/session-cache.ts:207-213`), and the Sessions screen displays exactly the cached `profile` field if present.
- Conclusion for hypothesis 1: proven. `unknown profile` is expected for any cache rows created only by DB sync, because sync has no profile source and `Sessions.tsx` falls back to `"unknown profile"`. Profile chips become populated only if `updateSessionProfile()` successfully runs after a chat completion with a returned session id.

#### Local default vs named profile storage assumptions
- Base Hermes home is `process.env.HERMES_HOME || ~/.hermes` at `src/main/install/paths.ts:10-12`.
- The canonical local helper says default/undefined maps to `HERMES_HOME`, while named profiles map to `HERMES_HOME/profiles/<profile>` (`src/main/utils.ts:19-25`). `src/main/profiles.ts:13` sets `PROFILES_DIR = join(HERMES_HOME, "profiles")`, lists default from `HERMES_HOME` at `src/main/profiles.ts:107-126`, and lists named profile subdirectories at `src/main/profiles.ts:129-149`.
- Documentation agrees that default uses `<HERMES_HOME>`, named profiles use profile-specific homes, and SSH mirrors `~/.hermes` vs `~/.hermes/profiles/<profile>` (`docs/subsystems/storage-and-profiles.md:18-27`). The same doc says session state is `<profileHome>/state.db` (`docs/subsystems/storage-and-profiles.md:33-40`) and later describes local session functions reading `<HERMES_HOME>/state.db` (`docs/subsystems/storage-and-profiles.md:122-130`), exposing the mismatch.
- Current local sessions/cache code is not profile-aware: `src/main/sessions.ts:5-6` and `src/main/session-cache.ts:11-13` hard-code `join(HERMES_HOME, "state.db")` instead of `join(profileHome(profile), "state.db")`.
- SSH helpers are profile-capable internally: `sshListSessions(config, ..., profile?)` chooses `~/.hermes/profiles/<profile>/state.db` for named profiles (`src/main/ssh/sessions-profiles.ts:8-23`), and `sshGetSessionMessages(config, sessionId, profile?)` uses the same split (`src/main/ssh/sessions-profiles.ts:47-61`). However, main IPC does not pass a profile into these calls for list/get/search (`src/main/ipc/sessions.ts:99-112`, `src/main/ipc/sessions.ts:210-232`). `sshListCachedSessions()` also has no profile parameter and maps `sshListSessions(config, limit, 0)` without profile (`src/main/ssh/runtime.ts:170-183`).
- Conclusion for hypothesis 3: proven for local default-vs-named DB mismatch, and also a likely SSH IPC gap. The codebase has profile-specific storage conventions, but the Sessions screen’s list/sync/search/get-message IPC path does not carry active profile context and local DB readers are default-root only.

#### API/transport session-id capture and resume behavior
- `sendMessageViaApi()` accepts `_resumeSessionId` but only uses it as an initial local `sessionId` fallback (`src/main/hermes/chat-api.ts:14-16`, `src/main/hermes/chat-api.ts:44`). The HTTP request body contains only `{ model, messages, stream: true }` (`src/main/hermes/chat-api.ts:33-37`), so Mercury does not send the resume id to the API server in the body or headers.
- API mode captures a session id only from the `x-hermes-session-id` response header (`src/main/hermes/chat-api.ts:190-193`) and calls `cb.onDone(sessionId || undefined)` at `src/main/hermes/chat-api.ts:54-56`. If the API server does not set that header for new sessions, main IPC receives no id and `updateSessionProfile()` is skipped.
- CLI mode is different: `sendMessageViaCli()` adds `-p <profile>` for named profiles (`src/main/hermes/chat-cli.ts:48-50`), adds `--resume <sessionId>` when provided (`src/main/hermes/chat-cli.ts:55-57`), captures `session_id: <id>` from CLI output (`src/main/hermes/chat-cli.ts:143-151`), and returns it through `cb.onDone(capturedSessionId || undefined)` (`src/main/hermes/chat-cli.ts:211-213`).
- Gateway selection means API mode is preferred whenever available: local remote mode always uses API, otherwise local mode probes `isApiServerReady()` and uses API before CLI fallback (`src/main/hermes/gateway.ts:21-39`).
- Conclusion for hypothesis 4: partially proven. The UI/main/preload contract can carry a session id, and API mode can capture it from `x-hermes-session-id`; however, API resume id is not actually sent upstream, and new-chat profile caching depends entirely on that response header being present. CLI is the only transport that definitely sends `--resume` and captures `session_id:` output.

#### Tests reviewed and gaps
- `tests/session-cache-sync.test.ts` covers first sync/title generation, metadata refresh, no duplicates, appending, title updates, profile writes, profile preservation, and large-cache performance (`tests/session-cache-sync.test.ts:110-371`). The profile tests specifically prove that `updateSessionProfile()` records profile (`tests/session-cache-sync.test.ts:285-309`) and later sync preserves it (`tests/session-cache-sync.test.ts:311-342`). They do not cover deriving profile during DB sync, because the code has no such source.
- `src/renderer/src/screens/Chat/hooks/useChatController.test.tsx` covers send/quick-ask loading, reject paths, approve/deny, stale send after conversation reset, and listener registration (`src/renderer/src/screens/Chat/hooks/useChatController.test.tsx:112-247`). It does not cover resuming a selected session whose DB messages resolve to `[]`, nor the effect ordering that clears `hermesSessionId` on empty messages.
- `tests/chat-ipc-lifecycle.test.ts` covers IPC resilience and includes a resume-id/history invocation (`tests/chat-ipc-lifecycle.test.ts:232-251`), but it only proves trace setup failures do not break completion; it does not assert transport-level API resume semantics.
- `tests/preload-api-surface.test.ts` checks API surface/channel presence (`tests/preload-api-surface.test.ts:196-200` and related IPC consistency checks), not Sessions behavior.
- No renderer `Sessions.tsx` behavior test was found, and no local/SSH multi-profile `state.db` resume/search/cache tests were found. Existing cache tests mock a single `HERMES_HOME/state.db` (`tests/session-cache-sync.test.ts:31-32`).
- Additional contract drift: runtime cache/search results may include `profile`, but `src/preload/api/models.ts:5-42` return types omit `profile` for `listCachedSessions`, `syncSessionCache`, and `searchSessions`; `src/preload/index.d.ts:270-304` includes `profile?: string`. This does not cause the runtime symptom by itself, but it makes the profile contract easier to regress.

#### Eliminated or lower-confidence hypotheses
- Row click wiring itself is not missing: normal rows and search rows both call `onResumeSession(...)` (`src/renderer/src/screens/Sessions/Sessions.tsx:238-276`, `src/renderer/src/screens/Sessions/Sessions.tsx:311-318`), and Layout does switch to Chat after the DB lookup (`src/renderer/src/screens/Layout/Layout.tsx:180-198`). The failure mode is downstream data/state, not an absent click handler.
- Preload IPC for `getSessionMessages` is present and directly wired (`src/preload/api/navigation.ts:48-59`), so this is not a missing preload method issue.
- `updateSessionProfile()` itself works for a visible root-DB session when called with a session id; tests cover that (`tests/session-cache-sync.test.ts:285-309`). The issue is when it is not called or cannot see the relevant DB row.
- Search profile attachment tries to backfill from cache (`src/main/ipc/sessions.ts:52-64`, `src/main/ipc/sessions.ts:210-232`), but if cache entries lack profile, search rows will still show `unknown profile`; this is not a separate source of truth.

#### Likely root causes
1. **Profile chip root cause:** Sessions rows display `session.profile`, but DB sync never derives profile metadata and profile writes only happen on chat completion when a transport returns a session id. Existing synced rows and any API completions without `x-hermes-session-id` will therefore show `unknown profile`.
2. **Resume reliability root cause:** Session list/cache can expose IDs for sessions whose messages are not readable through `getSessionMessages(sessionId)` because local readers use only default `HERMES_HOME/state.db`, IPC does not pass active profile, and SSH helpers’ profile-capable parameters are unused. An empty result renders Chat blank.
3. **Continuation root cause after blank resume:** When the selected session loads as `[]`, `useChatController` clears `hermesSessionId`; subsequent sends pass `undefined` as the resume id even though Layout still has `currentSessionId`, so the next message may start a new session.
4. **API transport root cause:** API mode does not send the resume id to Hermes; it reconstructs context from renderer history and relies on a response header for session identity. This weakens true resume semantics and makes profile cache updates dependent on server/header behavior.

#### Recommendations
1. Make session list/message/cache IPC profile-aware. Pass `activeProfile` from `Layout`/`Sessions` into `listCachedSessions`, `syncSessionCache`, `searchSessions`, and `getSessionMessages`; use `profileHome(profile)/state.db` locally and pass profile through SSH helpers.
2. Store `profile` as first-class cache metadata during sync. Options: maintain per-profile cache entries by syncing each profile DB with an explicit profile override, or include profile in the cache key/record when listing a selected profile. Avoid relying only on post-completion `updateSessionProfile()`.
3. Harden resume state in `useChatController`: do not clear `hermesSessionId` merely because `messages.length === 0` when a `sessionId` prop is present, or have send paths fall back to `sessionIdRef.current`/`sessionId` when local state is null.
4. Fix API transport resume semantics by sending `resumeSessionId` to the API server in the expected contract (body field/header/query, depending on Hermes API support) and add tests that assert it is included. Keep using the returned/header session id for reconciliation.
5. Add tests for: Sessions row click with `getSessionMessages() === []`; profile-specific local DB list/search/get-message; SSH profile passthrough; API transport resume id propagation; API completion without session header; and profile contract parity between `src/preload/api/models.ts` and `src/preload/index.d.ts`.
6. Add diagnostics/logging around resume misses: session id, active profile, DB path used, message count returned, and whether `hermesSessionId` was preserved.

#### Remaining ambiguous / needs runtime confirmation
- Whether the local Hermes API server currently emits `x-hermes-session-id` for all new chats in the user’s environment. Code supports capturing it, but profile writes fail if it is absent.
- Whether the listed sessions in the screenshot are from default DB sync, named profile DBs, cache-only rows, SSH rows, or mixed origins. The code supports multiple failure modes with the same UI symptom.
- The exact Hermes API contract for resuming by session id was not confirmed here; Mercury currently sends full renderer history in API mode, which may approximate continuation but is not the same as backend `--resume` semantics.
- Whether `sessions.source`, `sessions.model`, or another Hermes DB column could reliably imply profile in some environments. Current Mercury code does not read such a mapping, and no DB schema evidence in this repo proves it can be derived safely.


## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The bug is likely in the Sessions screen → preload IPC → main sessions/cache path, either because rows do not include enough metadata/IDs to navigate, or the renderer does not wire row selection to the chat resume path. The `unknown profile` label likely comes from missing/incorrect profile metadata normalization in session discovery/cache.
**Findings:** Report created from the user-provided screenshot and symptoms. No `AGENTS.md` guidance file exists in the repo.
**Evidence:** Screenshot shows Sessions page rows with correct titles/message counts/models but profile chips all reading `unknown profile`.
**Conclusion:** Proceeding with git archaeology for recent sessions/profile changes, then broad context gathering.

### Phase 4 - Oracle Synthesis
**Hypothesis:** The pair findings needed synthesis into primary vs secondary root causes and an appropriately scoped fix sequence.
**Findings:** Oracle agreed that the primary root cause is lost profile context in the Sessions/cache/resume path plus default-only SQLite reads. Secondary causes are empty-transcript resume-id clearing, row clicks not passing profile, SSH profile args not used by IPC, API transport session-id/header dependence, and lack of diagnostics.
**Evidence:** See pair findings above and verified evidence in `src/renderer/src/screens/Sessions/Sessions.tsx:106-109`, `src/renderer/src/screens/Layout/Layout.tsx:169-182`, `src/renderer/src/screens/Chat/hooks/useChatController.ts:295-305`, `src/main/sessions.ts:5-6`, `src/main/session-cache.ts:11-13`, `src/main/session-cache.ts:147-183`, `src/main/ipc/sessions.ts:107-112`, `src/main/hermes/chat-api.ts:14-16`, `src/main/hermes/chat-api.ts:33-37`, and `src/main/hermes/chat-api.ts:190-193`.
**Conclusion:** Confirmed. The click handler exists; the failure is downstream identity/profile context and persistence lookup.

## Root Cause
Primary root cause: **profile context is not carried through the Sessions list/cache/resume pipeline, while local session/cache readers are default-DB only.**

Concrete chain:
1. The Sessions UI renders `formatProfile(session.profile)`, and `formatProfile()` returns `"unknown profile"` when the field is absent (`src/renderer/src/screens/Sessions/Sessions.tsx:106-109`, `src/renderer/src/screens/Sessions/Sessions.tsx:142-146`).
2. Cache sync reads only `HERMES_HOME/state.db` (`src/main/session-cache.ts:11-13`) and selects SQLite columns that do not include profile; new cache rows are created without a profile override (`src/main/session-cache.ts:147-183`).
3. `updateSessionProfile()` can populate profile, but only when chat completion receives a truthy `sessionId` and calls it (`src/main/ipc/chat.ts:266-271`); the helper itself also reads only the default DB before inserting missing rows (`src/main/session-cache.ts:280-313`).
4. Row clicks pass only id/title, not the row profile (`src/renderer/src/screens/Sessions/Sessions.tsx:238-276`, `src/renderer/src/screens/Sessions/Sessions.tsx:311-318`).
5. Layout resumes by calling `getSessionMessages(sessionId)` with no profile (`src/renderer/src/screens/Layout/Layout.tsx:169-182`), preload/main preserve that profile-less shape (`src/preload/api/navigation.ts:48-59`, `src/main/ipc/sessions.ts:107-112`), and local `getSessionMessages()` reads only `HERMES_HOME/state.db` (`src/main/sessions.ts:5-6`, `src/main/sessions.ts:160-187`).
6. The repo's storage contract says named profiles live under `HERMES_HOME/profiles/<profile>/state.db` via `profileHome(profile)` (`src/main/utils.ts:19-25`, `docs/subsystems/storage-and-profiles.md:18-40`), so named-profile sessions can list/cache incorrectly or load as `[]` when resumed through the default DB path.
7. If resume loads `[]`, `useChatController` clears `hermesSessionId` whenever `messages.length === 0` (`src/renderer/src/screens/Chat/hooks/useChatController.ts:295-305`); subsequent sends use `hermesSessionId || undefined` (`src/renderer/src/screens/Chat/hooks/useChatController.ts:520-527`), so the selected session may not be resumed.

Secondary contributors:
- SSH helpers already accept optional profile arguments, but IPC calls omit them (`src/main/ssh/sessions-profiles.ts:8-23`, `src/main/ssh/sessions-profiles.ts:47-61`, `src/main/ipc/sessions.ts:99-112`).
- API transport accepts `_resumeSessionId` but only uses it as a local fallback, does not send it in the request body, and only captures session identity from `x-hermes-session-id` (`src/main/hermes/chat-api.ts:14-16`, `src/main/hermes/chat-api.ts:33-37`, `src/main/hermes/chat-api.ts:190-193`). This makes cache profile writes dependent on API header behavior.
- `Layout.handleResumeSession()` has no empty/error diagnostics, so the UI silently switches to an empty Chat view when message lookup misses.

Eliminated hypotheses:
- Missing row click handler: eliminated; cached and search rows call `onResumeSession(...)`.
- Missing preload method: eliminated; `getSessionMessages` is exposed and wired.
- `updateSessionProfile()` fundamentally cannot work: eliminated for default-DB rows when called with a real session id; existing tests cover profile write/preservation.
- Search has an independent profile source: eliminated; search only attaches profile from the same cache.

## Recommendations
1. **Pass profile through resume flow.** Extend `SessionsProps.onResumeSession` and both cached/search row clicks to pass `profile`; update `Layout.handleResumeSession(sessionId, title, profile)` to pass profile into message lookup and set `activeProfile` when a row profile is known.
2. **Make session message lookup profile-aware.** Update preload typings and IPC to accept `getSessionMessages(sessionId, profile?)`; local lookup should read `profileHome(profile)/state.db`, and SSH should call `sshGetSessionMessages(conn.ssh, sessionId, profile)`. If no profile is supplied, consider a guarded fallback search across default + profile DBs for backward compatibility.
3. **Make cache sync profile-aware.** Sync default and named profile DBs with explicit `profile: "default" | profileName`; backfill existing cache rows missing `profile`; avoid relying only on `updateSessionProfile()` as the source of profile truth.
4. **Make cache side-effect helpers profile-aware.** Add profile-aware DB selection to `updateSessionProfile()` and, if title writes should affect named profiles, `updateSessionTitle(sessionId, title, profile?)`.
5. **Harden Chat resume state.** Do not clear `hermesSessionId` solely because `messages.length === 0` when an external `sessionId` exists; sends should fall back to `sessionIdRef.current`/prop if local state is null.
6. **Add diagnostics before deeper API changes.** Log clicked `sessionId`, row profile, active profile, DB path attempted, message count returned, and whether the resume id was preserved. Confirm the official Hermes API resume/session-id contract before changing API transport; then add the supported resume id field/header and session-id capture tests.
7. **Add focused regression tests.** Cover Sessions row profile passthrough, Layout resume with profile, named-profile DB message lookup/cache sync, empty transcript preserving resume id, SSH profile passthrough, and API completion with/without session id header.

## Preventive Measures
- Treat profile as first-class identity for session APIs, not display-only metadata.
- Keep preload `api/*.ts` runtime return types and `src/preload/index.d.ts` in sync for optional fields like `profile`.
- Add contract tests that exercise default and named-profile storage paths for list/search/get-message/cache sync.
- Add UI tests for selecting a session with no loaded messages so blank resume states remain explicit and resumable.
- Include resume diagnostics in future session/cache regressions so wrong DB/profile lookup is visible immediately.
