# Reliable Profile Runtime Implementation Plan

Source investigation: `docs/investigations/reliable-profile-runtime-2026-05-16.md`

## Work Items

### Item 1: Runtime identity contract and local runtime manager
- [x] Status: complete — implemented by `Runtime 1/5: contract and manager`; typecheck and full tests reported passing.
- **Goal:** Introduce the main-process runtime contract (`ProfileRuntimeRequest`, `RuntimeIdentity`, structured runtime errors) and a `ProfileRuntimeManager`/equivalent that owns local runtime identity, profile-keyed gateway state, API URL/auth/readiness, and CLI fallback identity.
- **Done when:** Main-process runtime code can resolve a runtime for `(profile, purpose)` in local mode; local CLI identity is considered verified via `-p`; local API identity is represented by a runtime handle; global `apiServerAvailable`/gateway process state is replaced or isolated behind profile-keyed manager state; TypeScript compiles for touched modules.
- **Key files/modules:** `src/main/hermes/gateway.ts`, `src/main/hermes/connection.ts`, `src/main/hermes/types.ts`, likely new `src/main/hermes/runtime.ts`, `src/main/hermes/chat-cli.ts`, `src/main/utils.ts`, `src/main/config.ts`.
- **Dependencies:** none.
- **Tests expected:** Add focused unit/contract tests for runtime identity types/manager where feasible; update existing tests if compile/API changes require it.

### Item 2: Gateway/API/chat/title/cron execution through verified runtime
- [x] Status: complete — profile runtime handles threaded through gateway/chat/title/cron; typecheck and full tests reported passing.
- **Goal:** Thread profile-keyed runtime handles through gateway lifecycle, chat API, title generation, and cron API paths. Gateway start/status/stop/restart must accept profile through renderer/preload/IPC. API chat/title/cron must not use a global profile-less API URL.
- **Done when:** `Gateway.tsx`, preload, IPC, and main gateway lifecycle all accept `profile`; chat preparation resolves a runtime for the selected profile; `sendMessageViaApi` and title generation use runtime handle URL/auth; title existing lookup uses `(sessionId, profile)`; remote/API cron fails closed or uses verified runtime; default runtime cannot satisfy named profile API execution.
- **Key files/modules:** `src/renderer/src/screens/Gateway/Gateway.tsx`, `src/preload/api/navigation.ts`, `src/preload/index.d.ts`, `src/main/ipc/gateway.ts`, `src/main/ipc/chat.ts`, `src/main/hermes/chat-api.ts`, `src/main/hermes/title.ts`, `src/main/cronjobs.ts`, `src/main/ipc/cron.ts`, `src/main/sessions.ts`.
- **Dependencies:** Item 1.
- **Tests expected:** Update `preload-api-surface.test.ts`, `ipc-handlers.test.ts`, `chat-ipc-lifecycle.test.ts`; add tests for title lookup with duplicate session IDs/profile and profile-aware gateway lifecycle signatures.

### Item 3: SSH and remote runtime parity/fail-closed behavior
- [x] Status: complete — SSH/remote runtime parity and fail-closed seams implemented; typecheck and full tests reported passing.
- **Goal:** Make SSH runtime lifecycle and tunneling profile-keyed, and make pure remote HTTP behavior explicit and fail-closed unless identity is declared/verified. Fix SSH skill/tool/MCP/runtime parity where it affects execution identity.
- **Done when:** SSH gateway status/start/stop/API key/logs accept profile and use `hermes -p <profile>` or profile-specific paths; SSH tunnel state is keyed sufficiently by profile/remote port/local port or explicitly switched safely; remote HTTP mode has clear unsupported/unverified profile behavior; SSH toolset mirroring and skill install/uninstall profile flags are fixed if in scope of runtime reliability; MCP listing in SSH mode does not show local selected-profile MCP servers for remote execution.
- **Key files/modules:** `src/main/ssh/runtime.ts`, `src/main/ssh-tunnel.ts`, `src/main/ssh-remote.ts`, `src/main/ssh/config.ts`, `src/main/ssh/skills.ts`, `src/main/ipc/knowledge.ts`, `src/main/ipc/system.ts`, `src/main/install/introspection.ts`, `src/main/hermes/connection.ts`.
- **Dependencies:** Items 1-2.
- **Tests expected:** SSH command construction tests; tunnel identity/switching tests; remote unverified/fail-closed tests; SSH toolset/skill profile propagation tests.

### Item 4: Runtime diagnostics, stale-runtime invalidation, and profile-scoped surfaces
- [x] Status: complete — diagnostics API/UI and stale-runtime invalidation hooks implemented; typecheck and full tests reported passing.
- **Goal:** Surface runtime identity to the UI and invalidate/restart/warn when profile-scoped config changes affect a running runtime. Wire diagnostics into Chat/Gateway/Settings/Profile-related surfaces enough to distinguish selected profile from actual runtime profile.
- **Done when:** A diagnostic API exists and shows requested profile, actual/verified profile, mode, transport, API URL/port, PID/config/auth source, verification time, and mismatch reason; profile-scoped changes to env/model/tools/skills/memory/SOUL/MCP/cron mark runtime stale or restart/warn for that profile; UI displays mismatch/unverified states rather than implying isolation.
- **Key files/modules:** `src/main/ipc/system.ts` or new runtime IPC, `src/preload/api/app.ts`/`navigation.ts`, `src/preload/index.d.ts`, `src/renderer/src/screens/Gateway/Gateway.tsx`, `src/renderer/src/screens/Chat/hooks/useChatController.ts`, `src/renderer/src/screens/Layout/Layout.tsx`, config/knowledge IPC handlers.
- **Dependencies:** Items 1-3.
- **Tests expected:** Preload/API surface tests for diagnostics; renderer tests or main IPC tests for mismatch/stale states where existing test harness supports it.

### Item 5: End-to-end verification suite and documentation cleanup
- [x] Status: complete — added reliable profile runtime sentinel coverage and updated storage/architecture/investigation docs with final behavior and limitations; `npm run -s typecheck` and `npm test -- --run` passed.
- **Review remediation:** Final Oracle P0 blockers were addressed additively: local API runtimes now start unverified, force profile host/port evidence, and only verify after readiness; SSH API runtimes require remote profile config/status evidence instead of trusting a tunnel; stale clearing is conservative until successful revalidation. Full validation passed after remediation.
- **Goal:** Expand tests and docs so "reliable profile runtime" remains enforced. Include sentinel-style tests where practical and document the storage-vs-runtime distinction.
- **Done when:** Existing and new tests cover runtime identity, profile switching, gateway profile lifecycle, chat API mismatch prevention, title/session duplicate handling, cron routing, SSH/remote fail-closed behavior, and diagnostics. Docs/report are updated with final behavior and any deferred limitations.
- **Key files/modules:** `tests/*`, `docs/subsystems/storage-and-profiles.md`, `docs/architecture/overview.md`, `docs/investigations/reliable-profile-runtime-2026-05-16.md` if needed.
- **Dependencies:** Items 1-4.
- **Tests expected:** Full relevant test suite passes or failures are documented with clear blockers.

## Coordination Notes
- Do not revert unrelated existing work. Current git status may include unrelated modified/untracked files.
- Prefer fail-closed structured errors over silent fallback to default/global runtime.
- If upstream lacks a profile identity endpoint, Mercury-managed local runtimes can be verified by launch command + profile-specific port/auth/config/PID evidence; generic remote URLs remain unverified/external unless declared.
- The CLI path with `hermes -p <profile>` is the strongest existing profile runtime and can be used as the safe fallback.
