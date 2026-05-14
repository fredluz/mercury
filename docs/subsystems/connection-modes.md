# Connection Modes

Mercury supports three connection modes: local, pure remote HTTP, and SSH. This document describes the current behavior only; do not treat it as a proposal for new routing or fallback behavior.

## Source anchors

- Connection config persistence: `src/main/config.ts`
- Connection helpers: `src/main/hermes/connection.ts`
- Gateway lifecycle and chat dispatch choice: `src/main/hermes/gateway.ts`
- SSH tunnel: `src/main/ssh-tunnel.ts`
- SSH compatibility exports: `src/main/ssh-remote.ts`
- SSH domain implementations: `src/main/ssh/*`
- IPC handlers that branch by mode: `src/main/ipc/config.ts`, `src/main/ipc/install.ts`, `src/main/ipc/chat.ts`, `src/main/ipc/knowledge.ts`, `src/main/ipc/sessions.ts`, `src/main/ipc/models.ts`, `src/main/ipc/system.ts`
- Renderer gating: `src/renderer/src/App.tsx`, `src/renderer/src/screens/Layout/Layout.tsx`

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

## Mode helpers

`src/main/hermes/connection.ts` defines the core runtime helpers:

- `getApiUrl()`
  - SSH mode: returns `getSshTunnelUrl()` or throws `SSH tunnel is not active` if no tunnel URL exists.
  - Remote mode with `remoteUrl`: returns `remoteUrl` with trailing slashes removed.
  - Otherwise: returns local `http://127.0.0.1:8642`.
- `isRemoteMode()` returns `true` for `remote` and `ssh`.
- `isRemoteOnlyMode()` returns `true` only for pure remote HTTP mode.
- `getRemoteAuthHeader()`
  - SSH mode: returns `Authorization: Bearer <cached SSH remote API key>` if one has been cached with `setSshRemoteApiKey(...)`.
  - Remote mode: returns `Authorization: Bearer <remoteApiKey>` if configured.
  - Local mode: returns no auth header.
- `ensureSshTunnelIfNeeded()` starts the SSH tunnel when mode is SSH and the tunnel is inactive or unhealthy.
- `testRemoteConnection(url, apiKey?)` checks `<url>/health` with a 5 second timeout and optional bearer token.

## Local mode

Local mode is the default.

Current behavior:

- `getApiUrl()` resolves to `http://127.0.0.1:8642`.
- `isRemoteMode()` is false.
- Chat dispatch in `src/main/hermes/gateway.ts` may use the local API server if ready; otherwise it falls back to CLI.
- `send-message` in `src/main/ipc/chat.ts` lazy-starts the local gateway when not remote and not already running.
- `ensureApiServerConfig()` appends an API server config block to `<HERMES_HOME>/config.yaml` if no `api_server` text is present. It is called during local initialization, not in remote modes.
- Local gateway startup runs Hermes via `HERMES_PYTHON` and `HERMES_SCRIPT`, with `HERMES_HOME`, enhanced `PATH`, `HOME`, `API_SERVER_ENABLED=true`, and profile API keys from `.env` injected into the child process environment.
- Local config/env/model/storage functions operate under `profileHome(profile)` for profile-aware files.

Local persistent storage is covered in [Storage and profiles](storage-and-profiles.md).

## Pure remote HTTP mode

Pure remote mode is `mode === "remote"` with a configured `remoteUrl`.

Current behavior:

- `getApiUrl()` returns the configured `remoteUrl` with trailing slashes removed.
- `getRemoteAuthHeader()` uses the stored `apiKey` as a bearer token when present.
- `isRemoteMode()` is true.
- `isRemoteOnlyMode()` is true.
- Chat dispatch always uses `sendMessageViaApi(...)`; there is no CLI fallback in remote mode.
- `App.tsx` startup checks `testRemoteConnection(remoteUrl, apiKey)` and enters the main app only when it succeeds.
- `Layout.tsx` re-checks `isRemoteOnlyMode()` on tab switch and gates filesystem-backed screens with `RemoteNotice` in pure remote mode.
- `App.tsx` skips local `verifyInstall()` after remote startup because that check probes local Python/script paths.

Important current limitations and differences:

- Pure remote HTTP mode is treated as remote-only by the renderer. Screens gated in `Layout.tsx` include Sessions, Profiles/Agents, Providers, Skills, Persona/Soul, Memory, Tools, and Gateway.
- Some main IPC handlers still call local services unless they have an SSH branch. For example, manual Markdown skill import explicitly rejects pure remote mode because it writes to the selected profile filesystem.
- Pure remote HTTP mode does not use SSH filesystem/command helpers.

## SSH mode

SSH mode is `mode === "ssh"` with SSH connection fields configured.

Current behavior:

- `getApiUrl()` returns the active tunnel URL from `getSshTunnelUrl()`.
- `isRemoteMode()` is true.
- `isRemoteOnlyMode()` is false. The renderer comment in `Layout.tsx` notes that SSH tunnel mode has full access and only pure HTTP remote mode restricts screens.
- `App.tsx` attempts `window.hermesAPI.startSshTunnel()` on startup and enters the main app on success.
- `src/main/index.ts` also attempts to auto-start SSH support on launch when config mode is SSH and a host is set:
  1. Check remote gateway status.
  2. Start the remote gateway if needed.
  3. Start the local SSH tunnel.
  4. Read remote `API_SERVER_KEY` and cache it with `setSshRemoteApiKey(...)`.
- `send-message` ensures the SSH tunnel and remote gateway are healthy before dispatching chat. If gateway or tunnel health fails, it starts the remote gateway, starts the tunnel, reads the remote API key, and caches it.
- Chat dispatch uses the API path because `isRemoteMode()` is true for SSH.

### SSH tunnel details

`src/main/ssh-tunnel.ts` starts an `ssh` process with local port forwarding:

```text
-L <localPort>:127.0.0.1:<remotePort>
```

Current behavior:

- Preferred local port comes from config, but `findFreePort(...)` may choose another free port.
- `getSshTunnelUrl()` returns `http://127.0.0.1:<activeLocalPort>` only when a tunnel config is active and marked running.
- Startup waits for the local forwarded port and then checks `/health` through the tunnel.
- `isSshTunnelHealthy()` checks `http://127.0.0.1:<localPort>/health`.
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

## Gateway and restart behavior

Current gateway behavior by mode:

- Local mode can start a gateway child process using Hermes Python/script paths.
- Remote and SSH chat dispatch use API, not local CLI fallback.
- `startGateway(profile)` does nothing if a gateway is already running and returns `false` in that case.
- `stopGateway(force = false)` only stops if the app started the gateway unless `force` is true; it also attempts to signal any PID from `<HERMES_HOME>/gateway.pid` and clears the PID file.
- `restartGateway(profile)` only restarts if the gateway was app-started or is currently running.

Current restart triggers visible in IPC handlers:

- Local `set-env` restarts the gateway when it is running and the key ends with `_API_KEY`, the key ends with `_TOKEN`, or the key is `HF_TOKEN`.
- Local `set-model-config` restarts the gateway when it is running and provider/model/base URL changed.
- SSH `set-model-config` stops and starts the remote gateway when remote gateway is running and provider/model/base URL changed.
- Successful local or SSH Markdown skill import returns `warning: "gateway-restart-required"` when a gateway is running; it does not restart the gateway itself in the current code.

## Verification guidance

For connection-mode changes, run the relevant contract tests and source checks:

```bash
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run typecheck
```

If the change touches session cache, skill import, or trace behavior, also run the targeted tests listed in [Contract tests](../testing/contract-tests.md). For docs-only edits, manually verify file paths and links.
