# Mercury Architecture Overview

This is the evergreen architecture reference for Mercury's current Electron app shape. It is grounded in the source files listed below and should be updated when app startup, process boundaries, navigation, or subsystem ownership changes.

## Source anchors

- Main process entrypoint: `src/main/index.ts`
- IPC composition root: `src/main/ipc/index.ts`
- Preload bridge: `src/preload/index.ts`, `src/preload/api/*`, `src/preload/index.d.ts`
- Renderer app shell: `src/renderer/src/App.tsx`, `src/renderer/src/screens/Layout/Layout.tsx`
- Shared contracts: `src/shared/*`
- Brand source and generated assets: `brand/README.md`, `brand/source/mercury-logo-source.png`, `scripts/generate-brand-assets.mjs`, `build/icon.*`, `resources/icon.png`, `docs/assets/mercury-logo.png`
- Contract tests: `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`

## Process boundaries

Mercury is an Electron/Vite desktop app split across four durable boundaries:

1. **Main process** (`src/main/index.ts` and `src/main/*`)
   - Owns Electron app lifecycle, the `BrowserWindow`, app menu, updater setup, shutdown cleanup, and side-effectful services such as gateway, SSH tunnel, and Claw3D shutdown.
   - Calls `registerIpcHandlers({ getMainWindow })` so domain IPC modules can expose main-process services to the renderer.
2. **Preload bridge** (`src/preload/index.ts`, `src/preload/api/*`, `src/preload/index.d.ts`)
   - Builds `hermesAPI` from split preload API fragments.
   - Exposes `window.hermesAPI` through `contextBridge.exposeInMainWorld("hermesAPI", hermesAPI)` when context isolation is enabled, with a direct assignment fallback when it is not.
   - `src/preload/index.d.ts` is the renderer-facing TypeScript contract.
3. **Renderer app** (`src/renderer/src/*`)
   - React UI that calls `window.hermesAPI`; it should not reach into main-process services directly.
   - `App.tsx` controls first-run/install/setup/main routing.
   - `Layout.tsx` owns the main navigation shell and active profile state.
4. **Shared contracts** (`src/shared/*`)
   - Shared TypeScript schemas used across process boundaries, including traces, skills, and i18n types/config.

For IPC/preload change rules, see [IPC and preload contract](../contracts/ipc-preload.md). For test coverage, see [Contract tests](../testing/contract-tests.md).

## Main startup flow

`src/main/index.ts` performs the current startup sequence inside `app.whenReady().then(...)`:

1. Set the app name to `Mercury`.
2. Set the Electron app user model id with `electronApp.setAppUserModelId("com.fredluz.mercury")`.
3. Watch window shortcuts for newly created browser windows.
4. Build and install the native application menu with `buildMenu()`.
5. Register all IPC handlers with `registerIpcHandlers({ getMainWindow: () => mainWindow })`.
6. Create the main `BrowserWindow` with `createWindow()`.
7. Register updater IPC/event behavior with `setupUpdater()`.
8. If the saved connection config is SSH and has a host, attempt to start the remote gateway, start the SSH tunnel, read the remote API key, and cache it with `setSshRemoteApiKey(...)`.
9. On macOS-style activation, recreate a window if none exist.

## Main window behavior

`createWindow()` in `src/main/index.ts` creates one `BrowserWindow` with:

- default size `1100x750`, minimum size `800x600`, initially hidden until `ready-to-show`;
- macOS hidden inset titlebar and Linux icon handling;
- preload path `../preload/index.js`;
- `sandbox: false` and `webviewTag: true` as the current behavior;
- external URL opening delegated to `shell.openExternal(...)` via `setWindowOpenHandler(...)`;
- dev URL loading from `ELECTRON_RENDERER_URL`, otherwise packaged `../renderer/index.html`.

It also logs renderer crashes, renderer error-level console messages, and failed loads.

## Brand assets and package icons

Mercury's canonical logo bitmap lives at `brand/source/mercury-logo-source.png`; `brand/README.md` documents the source and generation workflow. `npm run brand:generate` refreshes generated app and docs assets, and `npm run brand:check` verifies the committed derivatives.

Generated icon surfaces are intentionally checked in for packaging and docs: `build/icon.png`, `build/icon.ico`, `build/icon.icns`, `resources/icon.png`, `src/renderer/src/assets/icon.png`, and `docs/assets/mercury-logo.png`. `electron-builder.yml` points Windows, macOS, and Linux packaging at the generated `build/icon.*` files, while `src/main/index.ts` imports `resources/icon.png?asset` for the Linux `BrowserWindow` icon.

## Native menu and updater events

`buildMenu()` currently creates menu items for:

- Chat: `New Chat` sends `menu-new-chat`; `Search Sessions` sends `menu-search-sessions`.
- Standard Edit/View/Window roles.
- Help links that open external URLs.

`setupUpdater()` always registers update-related invoke handlers. In development it returns inert responses; in packaged builds it dynamically loads `electron-updater`, emits update events to the renderer, and handles check/download/install requests.

Current main-to-renderer updater/menu event channels include:

- `menu-new-chat`
- `menu-search-sessions`
- `update-available`
- `update-download-progress`
- `update-downloaded`
- `update-error`

## Shutdown flow

`src/main/index.ts` has two cleanup paths:

- `window-all-closed`
  - On non-macOS platforms: stop the gateway, stop the SSH tunnel, stop Claw3D, then quit the app.
- `before-quit`
  - Stop health polling.
  - Abort the active chat through `abortActiveChat()`.
  - Stop the gateway.
  - Stop the SSH tunnel.
  - Stop Claw3D.

Changes that add long-running main-process services should update this section and ensure shutdown cleanup remains explicit.

## IPC composition

`src/main/ipc/index.ts` is the composition root. `registerIpcHandlers(...)` currently wires these modules in order:

- `registerInstallIpc(context)`
- `registerConfigIpc()`
- `registerChatIpc(context)`
- `registerTraceIpc()`
- `registerGatewayIpc()`
- `registerSessionsIpc()`
- `registerKnowledgeIpc()`
- `registerModelsIpc()`
- `registerClaw3dIpc()`
- `registerCronIpc()`
- `registerSystemIpc()`

It also re-exports `abortActiveChat` from `src/main/ipc/chat.ts` for shutdown use.

## Renderer app flow

`src/renderer/src/App.tsx` controls the top-level UI state:

- `splash`
- `welcome`
- `installing`
- `setup`
- `main`

On startup, `runInstallCheck()` reads connection config through `window.hermesAPI.getConnectionConfig()`:

- SSH mode attempts `window.hermesAPI.startSshTunnel()` and proceeds to `main` on success.
- Remote HTTP mode tests the remote URL with `window.hermesAPI.testRemoteConnection(...)` and proceeds to `main` on success.
- Local mode checks installation status with `window.hermesAPI.checkInstall()` and routes to `welcome`, `setup`, or `main` based on installed/API-key state.

After entering `main` or `setup`, local mode performs a lazy `verifyInstall()` check in the background. Remote and SSH modes skip that local verification path.

## Main layout and navigation

`src/renderer/src/screens/Layout/Layout.tsx` owns the primary shell:

- Tracks the active view, active profile, current chat messages, current session id, and visited views.
- Lazy-mounts tabs on first visit, then keeps them mounted with `display: none` toggles.
- Re-checks pure remote mode on tab switch using `window.hermesAPI.isRemoteOnlyMode()`.
- Gates filesystem-backed screens in pure remote HTTP mode with `RemoteNotice`; SSH mode is not treated as remote-only by this renderer check.
- Handles menu events from the main process:
  - `onMenuNewChat()` aborts the current chat, clears chat state, and navigates to Chat.
  - `onMenuSearchSessions()` navigates to Sessions.
- Handles auto-update events from preload listeners and calls `downloadUpdate()` or `installUpdate()` based on updater state.

## Responsibility map

| Area | Primary source files |
| --- | --- |
| Electron lifecycle, window, menu, updater, shutdown | `src/main/index.ts` |
| IPC registration/composition | `src/main/ipc/index.ts`, `src/main/ipc/*.ts` |
| Renderer-safe API surface | `src/preload/index.ts`, `src/preload/api/*`, `src/preload/index.d.ts` |
| Hermes chat/API/CLI/gateway/connection | `src/main/hermes/*` |
| Connection config and profile-aware config/env/model settings | `src/main/config.ts`, `src/main/ipc/config.ts` |
| SSH tunnel and remote operations | `src/main/ssh-tunnel.ts`, `src/main/ssh-remote.ts`, `src/main/ssh/*` |
| Install/update/doctor/migration helpers | `src/main/installer.ts`, `src/main/install/*`, `src/main/ipc/install.ts` |
| Sessions and session cache | `src/main/sessions.ts`, `src/main/session-cache.ts`, `src/main/ipc/sessions.ts` |
| Memory, user profile, soul, tools, skills | `src/main/memory.ts`, `src/main/soul.ts`, `src/main/tools.ts`, `src/main/skills.ts`, `src/main/skills/importer.ts`, `src/main/ipc/knowledge.ts` |
| Models and credential pool | `src/main/models.ts`, `src/main/ipc/models.ts` |
| Trace runs and skill-training derivation | `src/shared/traces.ts`, `src/main/trace-store.ts`, `src/main/ipc/trace.ts` |
| Renderer top-level flow and navigation | `src/renderer/src/App.tsx`, `src/renderer/src/screens/Layout/Layout.tsx` |

## Change guidance

When changing architecture boundaries:

1. Update this document if startup, shutdown, process ownership, renderer navigation, or IPC composition changes.
2. Update [IPC and preload contract](../contracts/ipc-preload.md) if the renderer-facing API or IPC channel set changes.
3. Update [Contract tests](../testing/contract-tests.md) if test responsibilities or required commands change.
4. Run at least the relevant contract tests, plus typecheck when TypeScript contracts changed.
