# Connection Modes

Mercury supports three connection modes: local, pure remote HTTP, and SSH. This document describes the current behavior only; do not treat it as a proposal for new routing or fallback behavior.

## Source anchors

- Connection config persistence: `src/main/config.ts`
- Connection helpers: `src/main/hermes/connection.ts`
- Profile runtime manager/identity contract: `src/main/hermes/runtime.ts`, `src/main/hermes/types.ts`, `src/shared/runtime.ts`
- Gateway lifecycle and chat dispatch choice: `src/main/hermes/gateway.ts`
- SSH tunnel: `src/main/ssh-tunnel.ts`
- SSH compatibility exports: `src/main/ssh-remote.ts`
- SSH domain implementations: `src/main/ssh/*`
- IPC handlers that branch by mode: `src/main/ipc/config.ts`, `src/main/ipc/gateway.ts`, `src/main/ipc/install.ts`, `src/main/ipc/chat.ts`, `src/main/ipc/knowledge.ts`, `src/main/ipc/sessions.ts`, `src/main/ipc/models.ts`, `src/main/ipc/system.ts`
- Shared services used by IPC and CLI mode routing: `src/main/services/config-service.ts`, `src/main/services/chat-service.ts`, `src/main/services/gateway-service.ts`, `src/main/services/install-service.ts`, `src/main/services/knowledge-service.ts`, `src/main/services/sessions-service.ts`, `src/main/services/system-service.ts`
- Renderer startup/gating/status checks: `src/renderer/src/App.tsx`, `src/renderer/src/screens/Layout/Layout.tsx`, `src/renderer/src/screens/Gateway/Gateway.tsx`
- Contract tests: `tests/reliable-profile-runtime-contract.test.ts`, `tests/chat-ipc-lifecycle.test.ts`
- CLI parity: `src/cli/*`, `src/main/services/chat-service.ts`, `docs/contracts/cli.md`, `tests/cli-chat-commands.test.ts`, `tests/cli-parity.test.ts`

## Persisted connection config

`src/main/config.ts` stores connection mode data in:

```text
<HERMES_HOME>/desktop.json
```

The current `ConnectionConfig` shape is:

```ts
interface ConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  apiKey: string;
  ssh: {
    host: string;
    port: number;
    username: string;
    keyPath: string;
    remotePort: number;
    localPort: number;
  };
}
```

Defaults returned by `getConnectionConfig()` when fields are missing:

- `mode`: `local`
- `remoteUrl`: empty string
- `apiKey`: empty string
- `ssh.host`: empty string
- `ssh.port`: `22`
- `ssh.username`: empty string
- `ssh.keyPath`: empty string
- `ssh.remotePort`: `8642`
- `ssh.localPort`: `18642`

`setConnectionConfig(config)` writes `connectionMode`, `remoteUrl`, and `remoteApiKey`. It writes `sshConfig` only when `config.mode === "ssh"`.

## Mode helpers and runtime handles

`src/main/hermes/connection.ts` still defines low-level connection helpers, but profile-bound execution should use `ProfileRuntimeManager.resolveRuntime(...)` and the resulting `ProfileRuntimeHandle` rather than calling URL/auth helpers directly.

Low-level helpers:

- `getApiUrl(profile?)`
  - SSH mode: returns the active profile-bound `getSshTunnelUrl(profile, conn.ssh)` or throws `SSH tunnel is not active` if no matching tunnel URL exists.
  - Remote mode with `remoteUrl`: returns `remoteUrl` with trailing slashes removed.
  - Otherwise: returns the profile-local API URL when a profile is supplied, or legacy `http://127.0.0.1:8642` when not.
- `getLocalApiPort(profile?)` reads an explicit `api_server` port from the selected profile config when present, otherwise returns a stable profile-specific port (`8642` for default, hashed `18642+` range for named profiles).
- `isRemoteMode()` returns `true` for `remote` and `ssh`.
- `isRemoteOnlyMode()` returns `true` only for pure remote HTTP mode.
- `getRemoteAuthHeader(profile?)`
  - SSH mode: returns `Authorization: Bearer <cached SSH remote API key>` for the normalized profile if one has been cached with `setSshRemoteApiKey(...)`.
  - Remote mode: returns `Authorization: Bearer <remoteApiKey>` if configured.
  - Local mode: returns no auth header.
- `ensureSshTunnelIfNeeded(profile?)` starts the SSH tunnel when mode is SSH and the profile-bound tunnel is inactive or unhealthy.
- `testRemoteConnection(url, apiKey?)` checks `<url>/health` with a 5 second timeout and optional bearer token.

`src/main/hermes/runtime.ts` is the authoritative runtime dispatcher:

- `ProfileRuntimeRequest` carries profile, mode, purpose, optional session id, and optional transport preference.
- `ProfileRuntimeHandle` carries the verified runtime identity, transport (`api`, `ssh-api`, or `cli` for executable chat paths), API base URL/auth headers, or CLI command.
- Local API handles require managed-process/profile evidence except for the legacy default-profile probe; otherwise local chat falls back to CLI.
- SSH API handles require a profile-bound tunnel plus `sshVerifyProfileRuntime(...)` evidence from the remote profile config/gateway.
- Pure remote HTTP currently fails closed for profile-bound execution with `runtime-unsupported-remote-profile`; `remote-api` appears only as an unverified external diagnostic identity.
- Runtime diagnostics expose stale, mismatch, unverified, and unsupported states to the renderer.

## Local mode

Local mode is the default.

Current behavior:

- `getApiUrl(profile)` resolves to the selected profile's local API URL; the default profile is `http://127.0.0.1:8642` unless config overrides the API port.
- `isRemoteMode()` is false.
- `send-message` in `src/main/ipc/chat.ts` lazy-starts the selected profile's local gateway when not remote and not already running, then resolves a `ProfileRuntimeHandle` for `{ profile, purpose: "chat", sessionId }`.
- Chat dispatch in `src/main/hermes/gateway.ts` uses the resolved handle: `api` when a verified local API runtime exists, otherwise `cli`.
- `ensureApiServerConfig(profile)` appends a profile-specific API server config block to the selected profile's `config.yaml` if no `api_server` text is present. It is called during local initialization, not in remote modes.
- Local gateway startup runs Hermes via `HERMES_PYTHON` and `HERMES_SCRIPT`, with `HERMES_HOME`, enhanced `PATH`, `HOME`, `API_SERVER_ENABLED=true`, profile-specific `API_SERVER_HOST`/`API_SERVER_PORT`, and profile API keys from `.env` injected into the child process environment.
- Local config/env/model/storage functions operate under `profileHome(profile)` for profile-aware files.

Local persistent storage is covered in [Storage and profiles](storage-and-profiles.md).

### CLI notes

`mercury chat send` and `mercury chat title` use the same shared chat service as IPC. In local mode the CLI lazily starts the selected profile gateway when needed, resolves a verified local runtime handle or CLI fallback, and streams text/NDJSON without launching Electron. `mercury connection set --mode local`, local gateway commands, and local install/update/doctor commands mutate the same `desktop.json`, gateway state, and Hermes home used by the desktop app.

## Pure remote HTTP mode

Pure remote mode is `mode === "remote"` with a configured `remoteUrl`.

Current behavior:

- `getApiUrl()` returns the configured `remoteUrl` with trailing slashes removed.
- `getRemoteAuthHeader()` uses the stored `apiKey` as a bearer token when present.
- `isRemoteMode()` is true.
- `isRemoteOnlyMode()` is true.
- `App.tsx` startup checks `testRemoteConnection(remoteUrl, apiKey)` and enters the main app only when it succeeds.
- `Layout.tsx` re-checks `isRemoteOnlyMode()` on tab switch and gates filesystem-backed screens with `RemoteNotice` in pure remote mode.
- `App.tsx` skips local `verifyInstall()` after remote startup because that check probes local Python/script paths.
- Profile-bound execution does **not** currently route chat/title/cron through pure remote HTTP. `ProfileRuntimeManager.resolveRuntime(...)` creates an unverified external identity and throws `runtime-unsupported-remote-profile` because Mercury cannot prove the remote API is executing the requested profile.

Important current limitations and differences:

- Pure remote HTTP mode is treated as remote-only by the renderer. Screens gated in `Layout.tsx` include Sessions, Profiles/Agents, Providers, Skills, Persona/Soul, Memory, Tools, and Gateway.
- Pure remote HTTP can validate basic remote reachability, but profile-scoped execution fails closed until a future remote profile identity declaration/verification path exists.
- Some main IPC handlers still call local services unless they have an SSH branch. For example, manual Markdown skill import explicitly rejects pure remote mode because it writes to the selected profile filesystem.
- Pure remote HTTP mode does not use SSH filesystem/command helpers.

### CLI notes

The CLI preserves the fail-closed remote profile behavior. Profile-bound `chat send`, `chat title`, and cron/runtime execution surface `runtime-unsupported-remote-profile` or an unsupported-mode exit instead of routing prompts to an unverified remote API. `mercury connection get` and `mercury connection set --mode remote ...` can inspect or mutate the persisted remote URL/API-key configuration, but that does not make filesystem-backed commands remote-aware; commands without explicit remote support keep the current shared-service behavior documented in their subsystem docs.

## SSH mode

SSH mode is `mode === "ssh"` with SSH connection fields configured.

Current behavior:

- `getApiUrl(profile)` returns the active profile-bound tunnel URL from `getSshTunnelUrl(profile, conn.ssh)`.
- `isRemoteMode()` is true.
- `isRemoteOnlyMode()` is false. The renderer comment in `Layout.tsx` notes that SSH tunnel mode has full access and only pure HTTP remote mode restricts screens.
- `App.tsx` attempts `window.hermesAPI.startSshTunnel()` on startup and enters the main app on success.
- `src/main/index.ts` also attempts to auto-start SSH support on launch when config mode is SSH and a host is set:
  1. Check remote gateway status.
  2. Start the remote gateway if needed.
  3. Start the local SSH tunnel.
  4. Read remote `API_SERVER_KEY` and cache it with `setSshRemoteApiKey(...)`.
- `send-message` ensures the selected profile's SSH tunnel and remote gateway are healthy before dispatching chat. If gateway or tunnel health fails, it starts the remote gateway, starts the tunnel, reads the remote API key, and caches it.
- `ProfileRuntimeManager.resolveRuntime(...)` then verifies the SSH runtime through `sshVerifyProfileRuntime(...)`. Named SSH profiles cannot be verified through the default remote API port; they require a profile-specific SSH remote port.
- Verified SSH chat dispatch uses the API path via transport `ssh-api`, passing `runtime.apiBaseUrl` and `runtime.authHeaders` into `sendMessageViaApi(...)`.

### CLI notes

The CLI follows the same SSH preparation sequence for chat/title: ensure the profile-bound tunnel, check/start the remote gateway, read and cache the remote API key, then resolve a verified `ssh-api` runtime. `mercury connection ssh set ...` writes the SSH config in `desktop.json`, `mercury ssh tunnel status|start|stop` exposes the same tunnel controls used by the renderer startup path, and SSH-capable read/write commands route through the shared service layer into `src/main/ssh/*` just like their IPC counterparts.

### SSH tunnel details

`src/main/ssh-tunnel.ts` starts an `ssh` process with local port forwarding:

```text
-L <localPort>:127.0.0.1:<remotePort>
```

Current behavior:

- Preferred local port comes from config, but `findFreePort(...)` may choose another free port.
- `getSshTunnelUrl(profile, config)` returns `http://127.0.0.1:<activeLocalPort>` only when a tunnel config is active, marked running, and matches the requested normalized profile plus SSH config identity.
- Startup waits for the local forwarded port and then checks `/health` through the tunnel.
- `isSshTunnelHealthy(config, profile)` checks the active profile/config-matched tunnel health at `http://127.0.0.1:<localPort>/health`.
- `stopSshTunnel()` sends `SIGTERM`, clears tunnel state, and clears the active config.
- `testSshConnection(...)` creates a temporary tunnel and checks `/health` before resolving true or false.

SSH command options currently include batch mode, `StrictHostKeyChecking=accept-new`, SSH control master/persist settings, `ExitOnForwardFailure=yes`, and server-alive settings.

### SSH domain operations

`src/main/ssh-remote.ts` re-exports domain helpers from `src/main/ssh/*`:

- `ssh/config.ts`: remote env/config/model/toolset reads and writes; remote paths under `~/.hermes` or `~/.hermes/profiles/<profile>`.
- `ssh/runtime.ts`: gateway status/start/stop, remote API key read, version, logs, platform toggles, cached sessions, doctor/update/dump, memory providers, model list/save.
- `ssh/sessions-profiles.ts`: remote session/profile list, session messages, search, profile create/delete.
- `ssh/memory-soul.ts`: remote memory/user/soul reads and writes with the same memory/user character limits as local code.
- `ssh/skills.ts`: remote skill listing/content/install/uninstall/import.
- `ssh/transport.ts`: SSH exec, Python, file read/write, error sanitization, shell quoting, and remote path normalization.

## CLI behavior by connection mode

The CLI reports mode/profile metadata in JSON envelopes on a best-effort basis from the shared context and connection services. It does not maintain a renderer session, so mode errors surface as normalized CLI errors and exit codes instead of `RemoteNotice` screens or runtime diagnostic banners.

| Mode | CLI behavior |
| --- | --- |
| Local | Reads and writes local `HERMES_HOME`; chat/title use verified local API runtime or Hermes CLI fallback; gateway/install/config commands operate on local files and processes. |
| Pure remote HTTP | Connection config can be read/written, but profile-bound execution fails closed because Mercury cannot verify remote profile identity; filesystem-backed mutations are not documented as remote operations unless a specific service implements remote support. |
| SSH | Chat/title, sessions, memory/SOUL/tools/skills, config/env/model reads/writes, gateway/log/MCP/dump operations use SSH branches where the shared service exposes them; tunnel commands expose `start`, `status`, and `stop`. |

`mercury connection set` and `mercury connection ssh set` both mutate `<HERMES_HOME>/desktop.json` through `config-service.ts`/`src/main/config.ts`. Connection-mode changes invalidate previously verified runtime assumptions; services mark affected runtimes stale where source behavior supports it, and callers should re-run `mercury runtime diagnostic --profile <name> --json` before relying on a long-lived automation context.

## Gateway and restart behavior

Current gateway behavior by mode:

- Local mode can start a gateway child process using Hermes Python/script paths.
- SSH chat dispatch uses the verified `ssh-api` transport; pure remote HTTP profile execution currently fails closed instead of falling back to CLI or using an unverified remote API.
- `startGateway(profile)` does nothing if a gateway is already running and returns `false` in that case.
- `stopGateway(force = false)` only stops if the app started the gateway unless `force` is true; it also attempts to signal any PID from `<HERMES_HOME>/gateway.pid` and clears the PID file.
- `restartGateway(profile)` only restarts if the gateway was app-started or is currently running.

Current restart triggers visible in IPC handlers:

- Local `set-env` restarts the gateway when it is running and the key ends with `_API_KEY`, the key ends with `_TOKEN`, or the key is `HF_TOKEN`.
- Local `set-model-config` restarts the gateway when it is running and provider/model/base URL changed.
- Local `set-platform-enabled` writes the platform setting and restarts the local gateway when `isGatewayRunning()` is true so the platform config is picked up.
- SSH `set-model-config` stops and starts the remote gateway when remote gateway is running and provider/model/base URL changed.
- SSH `set-platform-enabled` writes remote config through `sshSetPlatformEnabled(...)`, marks the selected profile runtime stale, and, when the remote gateway is running, stops/starts the remote gateway, restarts the SSH tunnel, refreshes the cached remote API key, and calls `revalidateRuntime(profile)`.
- Successful local or SSH Markdown skill import returns `warning: "gateway-restart-required"` when a gateway is running; it does not restart the gateway itself in the current code.

`Gateway.tsx` optimistically flips platform toggle UI state, invokes `setPlatformEnabled(...)`, then re-checks gateway status after a short delay. In local mode, the handler may restart the local gateway. In SSH mode, the handler now performs the remote stop/start and tunnel/API-key/runtime revalidation sequence when a remote gateway is running, so the re-check observes the refreshed remote gateway state.

## Verification guidance

For connection-mode changes, run the relevant contract tests and source checks:

```bash
npm run test -- tests/reliable-profile-runtime-contract.test.ts tests/chat-ipc-lifecycle.test.ts
npm run typecheck
```

If the change touches session cache, skill import, or trace behavior, also run the targeted tests listed in [Contract tests](../testing/contract-tests.md). For docs-only edits, manually verify file paths and links.
