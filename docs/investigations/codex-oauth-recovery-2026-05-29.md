# Investigation: Codex OAuth Recovery In Mercury

## Summary
Mercury already had an in-app Codex OAuth browser/device-code flow in the Providers menu. The missing piece was chat-side recovery: detecting Codex refresh-token failures while `openai-codex` is selected and surfacing that existing guided OAuth flow from chat/error activity instead of leaving users with terminal-only `codex` / `hermes auth` instructions.

## Symptoms
- Chat activity can fail with a transport/auth error: `Codex refresh token was already consumed by another client`.
- Current guidance asks the user to leave Mercury and run `codex`, then `hermes auth`, then `hermes model`.
- `hermes auth` presents a broad provider credential TUI where the desired path is buried: add credential → provider `openai-codex` → OAuth login → browser device-code URL/code.
- Desired product direction from interview: hide the generic credential menu for this recovery path and provide a guided Codex-only flow in Mercury, first from the error activity card and providers menu.

## Background / Prior Research

### Prior Mercury work: in-app Codex auth flow
- Git archaeology found substantial existing work, especially commit `956033e` (May 21, 2026), described as “Add in-app Codex auth flow”. It reportedly added `src/main/services/codex-auth-service.ts`, IPC/preload model auth APIs, and `src/renderer/src/screens/Providers/Providers.tsx` UI for Sign in/Re-authenticate, browser-opened Codex device URL, code display/copy, polling, credential write, and model configuration.
- Follow-up commit `854614f` (May 26, 2026) reportedly made provider/model choices credential-aware, treating `openai-codex` as connected when `codexStatus.hasHermesAuth` is true.
- Earlier commit `e67e1bf` (May 7, 2026) reportedly added setup-time Hermes credential detection for `openai-codex`.
- No implemented recovery entry point was found for the specific chat runtime error/card path: `Codex refresh token was already consumed by another client`.

### External/device-code mechanics
- Current OpenAI Codex auth supports a device-code flow where the app requests a user code, opens `https://auth.openai.com/codex/device`, displays the code, and polls token status; user browser interaction is still required.
- The existing Mercury/Hermes path reportedly already avoids invoking CLI commands for this flow: it opens the device URL through Electron, shows/copies the code, polls, and writes Hermes credential provider `openai-codex`.
- Safety conclusion: prefer reusing/expanding the in-app Codex auth service over embedding the generic `hermes auth` terminal menu. The terminal menu should be an advanced fallback, not the primary recovery UX.

## Investigator Findings
- Existing provider-menu Codex auth mechanics live behind `getCodexAuthStatus`, `startCodexDeviceAuth`, `pollCodexDeviceAuth`, and `configureCodexAppServer`; this is the right flow to reuse.
- Chat transport errors were previously rendered as plain string errors, so the renderer could not reliably distinguish a recoverable Codex OAuth failure from generic transport failures.
- The implemented change adds shared Codex auth recovery classification, structured chat error metadata, sanitized fallback transcript copy, a reusable `useCodexAuthFlow` hook, an in-chat `ChatCodexAuthRecoveryCard`, and an activity-card CTA.
- Providers now shares the Codex auth hook instead of owning a duplicate local polling/start flow.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Mercury may already contain partial provider/credential-management work that can support a guided Codex OAuth recovery flow.
**Findings:** Initial narrow searches found provider/model inventory and local credential pool APIs in docs/contracts/cli.md and src/main/config.ts, plus provider UI work in blueprints/hermes-inventory-role-chat-picker.md. Dedicated Codex OAuth recovery work has not yet been confirmed.
**Evidence:** User screenshots and CLI transcript supplied in this task; initial search terms: `codex|oauth|auth|credential|provider` across docs/specs/src/tests.
**Conclusion:** Confirmed: prior provider-menu Codex OAuth exists; chat-side detection/recovery was the gap.

### Phase 2 - Implementation
**Hypothesis:** Reusing the existing Codex device-code OAuth APIs is safer and clearer than embedding the generic Hermes auth TUI.
**Findings:** Implemented structured recovery detection for `openai-codex` refresh-token failures, chat recovery UI, activity CTA, and shared Providers/Chat auth flow reuse.
**Evidence:** Key files include `src/shared/codex-auth-recovery.ts`, `src/main/hermes/chat-api.ts`, `src/main/services/chat-service.ts`, `src/preload/api/chat.ts`, `src/renderer/src/hooks/useCodexAuthFlow.ts`, `src/renderer/src/screens/Chat/components/ChatCodexAuthRecoveryCard.tsx`, `src/renderer/src/screens/Chat/components/ChatActivityGroup.tsx`, and `src/renderer/src/screens/Providers/Providers.tsx`.
**Conclusion:** Confirmed/implemented.

## Root Cause
The app already knew how to authenticate Codex in-app, but chat transport errors were string-only and generic. When Codex OAuth refresh tokens failed, the UI displayed backend/CLI-oriented remediation text instead of recognizing the selected provider and routing the user into Mercury's existing Codex OAuth flow.

## Recommendations
1. Keep Codex auth recovery provider-gated: only trigger for `openai-codex` and refresh-token-specific failures.
2. Keep the generic `hermes auth` TUI as an advanced fallback, not the primary recovery path.
3. Manually smoke-test a real browser/device-code sign-in from both Providers and the new chat recovery card.

## Preventive Measures
- Keep auth error classification centralized in `src/shared/codex-auth-recovery.ts`.
- Prefer structured IPC metadata for recoverable errors instead of renderer string parsing.
- When adding future provider auth flows, expose provider-specific guided recovery affordances rather than generic terminal commands.
