# Oracle Review

## Summary

The diff adds a substantial profile runtime identity layer: `ProfileRuntimeManager`, structured runtime identity/errors, profile-aware gateway IPC/preload/renderer APIs, runtime handles for chat/title/cron API calls, SSH profile command construction, tunnel identity keys, stale-runtime diagnostics, and new tests/docs. The direction is correct, but I see blockers where the implementation can still mark a runtime as verified for profile X based on insufficient evidence, especially local gateway port binding and SSH tunnel/API identity.

## Findings

### P0 — Must fix

- **`src/main/hermes/runtime.ts` / `src/main/hermes/connection.ts` — Local API identity can be “verified” without proving the spawned profile gateway owns the API port**
  - **What’s wrong:** `startGateway("alpha")` records a verified `managed-process` identity immediately after spawning `hermes -p alpha gateway`, and `resolveLocalApiRuntime()` later treats `/health` on `getLocalApiUrl("alpha")` as sufficient. But the process is not forced to use that computed profile port. `ensureApiServerConfig(profile)` returns without creating config when `config.yaml` is absent, and `startGateway()` does not set `API_SERVER_PORT`/host in the child env. A fresh named profile may therefore launch on Hermes’ default port while Mercury believes it owns `18xxx`; worse, any unrelated server responding on the computed port can satisfy readiness and be labeled as alpha.
  - **Suggestion:** Make the managed process and readiness evidence inseparable:
    - create/patch selected profile API config even for fresh profiles, or pass `API_SERVER_PORT`/host explicitly in gateway env;
    - verify the configured/actual port matches the selected profile before marking identity verified;
    - preferably require an identity endpoint or PID/port correlation before setting `actualProfile = profile`;
    - do not set `state.lastIdentity.verified = true` at spawn time until readiness/identity verification succeeds.

- **`src/main/hermes/runtime.ts` / `src/main/ssh/runtime.ts` / `src/main/ssh-tunnel.ts` — SSH runtime identity is trusted from tunnel/profile bookkeeping, not from the remote API’s actual profile**
  - **What’s wrong:** `resolveSshApiRuntime()` returns `actualProfile: request.profile, verified: true` whenever a profile-keyed local tunnel exists, except for named profiles using remote port `8642`. This does not prove the remote API behind `conn.ssh.remotePort` was started under that profile. `sshStartGateway()` is best-effort and swallows errors, tunnel health checks only `/health`, and a non-default remote port can still be serving the wrong profile or a stale/default process.
  - **Suggestion:** Keep SSH fail-closed unless verification proves the remote runtime profile. At minimum, verify the selected profile’s remote config declares `api_server` on `conn.ssh.remotePort`, verify the profile PID/status path corresponds to a live gateway, and require the tunnel health/auth to target that profile’s configured runtime. Ideally use/add an upstream identity endpoint. If verification cannot be completed, return `runtime-profile-unverified` instead of a verified `ssh-api` handle.

### P1 — Should fix

- **`src/main/hermes/runtime.ts` — Runtime diagnostics and handles overstate verification after config/env changes or process startup**
  - **What’s wrong:** `clearRuntimeStale(profile)` only clears stale flags; it does not force a fresh identity resolution or update evidence such as auth fingerprint, PID, command, or config path. Several mutation paths restart/re-tunnel then call `clearRuntimeStale(profile)` without resolving/validating a new runtime identity. This can make diagnostics show an old verified runtime after a potentially identity-changing mutation.
  - **Suggestion:** Make `clearRuntimeStale` private/conditional or pair it with successful `resolveRuntime(..., preferTransport: "api")`. Public mutation handlers should mark stale, restart if needed, then revalidate; only clear stale if the new runtime identity verifies the same profile.

- **`src/main/hermes/title.ts` — Title generation silently falls back on runtime mismatch/unverified state**
  - **What’s wrong:** If the prepared/runtime-resolved API transport is mismatched or unverified, `generateChatTitle()` returns a heuristic fallback. This avoids wrong-profile execution, but it does not provide IPC/UI diagnostics that title generation failed closed due to runtime identity, which is part of the target contract.
  - **Suggestion:** Return a structured “title fallback due to runtime identity” diagnostic path, emit/log a runtime diagnostic event, or propagate a typed error to IPC when the user-visible contract requires fail-closed diagnostics.

- **`tests/reliable-profile-runtime-contract.test.ts` — Sentinel tests are too string-based for the riskiest identity claims**
  - **What’s wrong:** Many new tests assert source strings rather than behavior. They do not catch the two main correctness gaps above: local API port/process correlation and SSH remote API actual-profile verification.
  - **Suggestion:** Add behavioral tests that simulate:
    - named profile with missing `config.yaml` and assert gateway env/config forces the selected port;
    - a healthy wrong server on the expected local port and assert it is not accepted without identity/PID evidence;
    - SSH tunnel healthy but remote profile status/config missing or mismatched, asserting `runtime-profile-unverified`;
    - stale clearing only after successful revalidation.

## Bottom line

There are blockers visible from the diff. The architecture is close, but the current implementation can still label a local/SSH API runtime as verified for profile X without proving the API process actually belongs to profile X. Fix local port/process identity verification and SSH remote identity verification before handoff.