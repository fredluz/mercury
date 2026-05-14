# Investigation: Chat Stop-State Input Lock

## Summary
The stuck red stop button is a lifecycle-finalization bug: visible assistant text streams via `chat-chunk`, but the composer unlocks only when renderer `isLoading` is cleared by `chat-done` / `chat-error` or manual abort/clear. The strongest concrete trigger is that main IPC runs trace/artifact/session side effects before emitting terminal IPC, so any exception there can skip `chat-done` / `chat-error` and leave the renderer locked.

## Symptoms
- Agent message content appears complete in the chat view.
- The composer remains unavailable / stop button remains visible after the visible response is finished.
- The user must manually click the stop button before they can type a reply.
- Screenshot shows a completed assistant message with a red stop button still active in the composer area.

## Background / Prior Research
- Git archaeology probe (2026-05-14) identified the strongest regression candidates as:
  - `b7a952a` (2026-05-14, "Harden Trace Lab real app coverage") touching `src/main/ipc/chat.ts`, especially active-run/settle logic, `chat-done` emission, and abort completion handling.
  - `c3ab937` (2026-05-14, "Capture current Mercury updates") expanding `src/renderer/src/screens/Chat/hooks/useChatController.ts` listener dependencies/rebinding, making a missed `chat-done` during teardown/rebind plausible.
  - `2ee2ec5` (2026-05-14, "Improve chat activity UI and profile actions") adding activity lifecycle coupling around done/error/abort paths.
  - `e5109cd` (2026-05-13, "refactor: split renderer constants and screens") establishing that `ChatComposer` stop/disabled state is tied to `isLoading`, while `useChatController` clears `isLoading` via `chat-done` / `chat-error`.
- Initial external conclusion: the bug is likely not in markdown rendering. It is more likely a lifecycle/state mismatch where visible assistant content completes, but the renderer never receives or processes a terminal event that clears `isLoading`.

## Investigator Findings
<!-- Pair investigator will append structured analysis here with file:line refs, evidence, and conclusions. -->

### 2026-05-14 - Renderer/Main/Transport Lifecycle Probe

#### Executive conclusion
The hypothesis is strongly supported: the visible assistant text and the renderer loading lock are driven by separate signals. Assistant content streams over `chat-chunk`, but the composer unlocks only when `useChatController` processes a terminal `chat-done` or `chat-error` IPC event, or when the user explicitly clears/aborts. If the terminal IPC is delayed, missed, or suppressed after chunks have already rendered, the UI can remain on the red stop button with the textarea disabled.

#### Renderer evidence: `isLoading` is the composer lock
- `Chat.tsx` passes the controller state directly into the composer: `isLoading={chat.isLoading}` at `src/renderer/src/screens/Chat/Chat.tsx:137`, and passes `onAbort={chat.handleAbort}` at `src/renderer/src/screens/Chat/Chat.tsx:140`.
- `ChatComposer` disables the textarea with `disabled={isLoading}` at `src/renderer/src/screens/Chat/components/ChatComposer.tsx:40`.
- The red stop button branch is rendered only under `{isLoading ? (...) : (...)}` at `src/renderer/src/screens/Chat/components/ChatComposer.tsx:43`, with the stop button at `src/renderer/src/screens/Chat/components/ChatComposer.tsx:44`.
- Therefore the reported UI state is equivalent to `useChatController.isLoading === true`.

#### Renderer evidence: automatic unlock depends on terminal IPC
- Streaming assistant content is appended in the `onChatChunk` listener at `src/renderer/src/screens/Chat/hooks/useChatController.ts:277`, updating the last agent message or adding a new agent message at `src/renderer/src/screens/Chat/hooks/useChatController.ts:278-283`.
- `onChatDone` is the main normal unlock path: it optionally stores the session id, marks activity completed, and calls `setIsLoading(false)` at `src/renderer/src/screens/Chat/hooks/useChatController.ts:287-290`.
- `onChatError` is the main failure unlock path: it appends an error message, marks activity failed, and calls `setIsLoading(false)` at `src/renderer/src/screens/Chat/hooks/useChatController.ts:292-295`.
- `handleSend` sets `setIsLoading(true)` before sending at `src/renderer/src/screens/Chat/hooks/useChatController.ts:449`, awaits `window.hermesAPI.sendMessage(...)` at `src/renderer/src/screens/Chat/hooks/useChatController.ts:454-459`, catches errors at `src/renderer/src/screens/Chat/hooks/useChatController.ts:480-482`, but has no `finally` that clears loading.
- `handleQuickAsk` similarly sets loading at `src/renderer/src/screens/Chat/hooks/useChatController.ts:491`, awaits send at `src/renderer/src/screens/Chat/hooks/useChatController.ts:495-500`, catches without clearing at `src/renderer/src/screens/Chat/hooks/useChatController.ts:501-503`, and has no `finally`.
- Manual user escape hatches do clear loading: `handleClear` calls `setIsLoading(false)` when loading at `src/renderer/src/screens/Chat/hooks/useChatController.ts:414-418`, and `handleAbort` calls `setIsLoading(false)` at `src/renderer/src/screens/Chat/hooks/useChatController.ts:567-570`.

#### Renderer listener lifecycle: missed terminal IPC is plausible
- The chat IPC listeners are registered together in one effect at `src/renderer/src/screens/Chat/hooks/useChatController.ts:276-313` and cleaned up at `src/renderer/src/screens/Chat/hooks/useChatController.ts:314-322`.
- That effect depends on `appendActivityEvent`, `markActiveActivityGroup`, `setMessages`, `currentContextInfo`, `currentModel`, and `currentProvider` at `src/renderer/src/screens/Chat/hooks/useChatController.ts:323`.
- `currentContextInfo`, `currentModel`, and `currentProvider` can change during the component lifetime via model config loading/selection, so the effect can remove and re-add the `chat-done`/`chat-error` listeners while a run is active. React effect cleanup/re-subscribe order creates a small gap where a terminal IPC emitted by main could be missed, leaving `isLoading` true because there is no independent `sendMessage` `finally` unlock.
- This is plausible but not yet proven as the most common path; it is a secondary risk compared with terminal emission being delayed or skipped in main/transport.

#### Main IPC evidence: terminal emission is after side effects and not protected by callback-level `try/finally`
- `send-message` creates a manual promise at `src/main/ipc/chat.ts:143-148`; `settleResolved` / `settleRejected` guard double settlement at `src/main/ipc/chat.ts:149-157`.
- `onChunk` appends to `fullResponse` and emits visible content with `event.sender.send("chat-chunk", chunk)` at `src/main/ipc/chat.ts:164-179`. This means visible assistant text can complete before the terminal lifecycle code runs.
- `onDone` first clears `activeChatRun` if active at `src/main/ipc/chat.ts:181-182`, then performs trace/artifact/session side effects at `src/main/ipc/chat.ts:183-209`, then emits `chat-done` at `src/main/ipc/chat.ts:210`, then settles the invoke promise at `src/main/ipc/chat.ts:211`.
- Because `recordTraceEvent`, `extractArtifactEventsFromText`, `sendChatTraceEvent`, `finishTraceRun`, and `updateSessionProfile` all run before `chat-done`, any thrown exception in that region can skip both `chat-done` and `settleResolved`. There is no local `try/catch/finally` around the callback body.
- `onError` has the same shape: pre-emit trace side effects at `src/main/ipc/chat.ts:231-239`, then `chat-error` at `src/main/ipc/chat.ts:240`, then `settleRejected` at `src/main/ipc/chat.ts:241`. An exception before line 240 can skip both terminal IPC and promise rejection.
- The outer `try/catch` at `src/main/ipc/chat.ts:162-313` covers initial `sendMessage(...)` setup failures, but it does not guarantee terminal emission if asynchronous transport callbacks throw after `sendMessage` has returned.
- Abort is one path with explicit settlement: `abortCurrentRun` calls `run.settleAbort()` at `src/main/ipc/chat.ts:61-68`; the per-run `settleAbort` emits `chat-done` and resolves at `src/main/ipc/chat.ts:292-299`. This explains why manually clicking stop can unlock the UI.

#### Main IPC race/active-run observations
- `shouldIgnoreCallback` is `settled || (activeChatRun !== null && !isActiveRun())` at `src/main/ipc/chat.ts:158-160`; callbacks are not ignored merely because `activeChatRun` is `null`.
- `activeChatRun` is assigned only after `await sendMessage(...)` returns, at `src/main/ipc/chat.ts:290-299`. If a transport could synchronously call `onDone` before `activeChatRun` assignment, `onDone` would still be allowed to run, but the later assignment could leave stale `activeChatRun`. This is less likely to explain the red stop button directly because renderer unlock would still receive `chat-done`, but it is a cleanup/abort correctness hazard.
- `abortCurrentRun("Superseded by a new Hermes message.")` is called before each new send at `src/main/ipc/chat.ts:102`, so stale `activeChatRun` can also cause a future send to emit an abort/done for an already completed run.

#### Transport evidence: chunks and terminal completion are separate by design
- Gateway routing chooses API or CLI transport in `src/main/hermes/gateway.ts`: remote mode always uses API at `src/main/hermes/gateway.ts:23-25`; local mode uses API when available at `src/main/hermes/gateway.ts:28-35`; otherwise it falls back to CLI at `src/main/hermes/gateway.ts:38`.
- API transport emits content chunks from SSE delta content with `cb.onChunk(prose)` at `src/main/hermes/chat-api.ts:164-172`.
- API terminal completion is separate: `[DONE]` calls `finish()` at `src/main/hermes/chat-api.ts:128-137`, stream `end` calls `finish(...)` at `src/main/hermes/chat-api.ts:245-256`, and `finish()` dispatches `cb.onDone(...)` or `cb.onError(...)` at `src/main/hermes/chat-api.ts:49-56`.
- API completion can be delayed by the non-streaming `probeRealError()` fallback when the stream is empty/no-signal at `src/main/hermes/chat-api.ts:129-137` and `src/main/hermes/chat-api.ts:252-254`; that probe itself resolves only from its own response/end/error at `src/main/hermes/chat-api.ts:59-106`.
- API completion can also wait indefinitely until request timeout/error if the stream produces visible chunks but never sends `[DONE]` or `end`; request timeout is configured at `src/main/hermes/chat-api.ts:269-271`.
- CLI transport emits visible stdout chunks via `cb.onChunk(output)` at `src/main/hermes/chat-cli.ts:167-170`; stderr transport-looking errors can also be forwarded visibly via `cb.onChunk(text)` at `src/main/hermes/chat-cli.ts:193-202`.
- CLI terminal completion is tied to child-process `close`: `cb.onDone(...)` only fires at `src/main/hermes/chat-cli.ts:209-211`; otherwise `cb.onError(...)` fires at `src/main/hermes/chat-cli.ts:212-218`. A child process that has printed all visible output but has not closed will leave renderer loading active.
- CLI deliberately withholds `onDone` when `sawTransportError` is true, even if there was visible output, because the close handler requires `code === 0 || (hasOutput && !sawTransportError)` at `src/main/hermes/chat-cli.ts:209-218`.

#### Eliminated or downgraded hypotheses
- Markdown/rendering completion is not the lock trigger. Message rendering is driven by `chat-chunk` at `src/renderer/src/screens/Chat/hooks/useChatController.ts:277-283`, while composer unlock is driven by `chat-done`/`chat-error` at `src/renderer/src/screens/Chat/hooks/useChatController.ts:287-295`.
- The composer component itself is not maintaining hidden state; it is a pure prop-driven component and directly reflects `isLoading` at `src/renderer/src/screens/Chat/components/ChatComposer.tsx:40-44`.
- Manual stop behavior is not mysterious: `handleAbort` immediately clears renderer loading at `src/renderer/src/screens/Chat/hooks/useChatController.ts:567-570`, and main abort also emits `chat-done` through `settleAbort` at `src/main/ipc/chat.ts:292-299`.

#### Root-cause likelihood
- High confidence: the stuck stop button is caused by `isLoading` remaining true after visible chunks have finished because renderer unlock depends on terminal IPC rather than on the visible stream/promise lifecycle.
- High confidence risk: `src/main/ipc/chat.ts` can skip `chat-done`/`chat-error` and promise settlement if unguarded pre-terminal side effects throw inside `onDone`/`onError`.
- Medium confidence risk: terminal events can be delayed by transport semantics after visible output (`chat-api.ts` waits for `[DONE]`/`end`/probe/timeout; `chat-cli.ts` waits for process close).
- Medium-low confidence risk: renderer listener rebinds during active runs could miss a terminal IPC in a cleanup/re-subscribe gap.

#### Recommended fixes
1. In `src/main/ipc/chat.ts`, make terminal IPC and promise settlement unconditional with callback-level `try/catch/finally`: emit `chat-done` / `chat-error` and settle even if trace/session/artifact side effects fail. Prefer moving terminal emit + settlement before non-critical notification/session side effects, or wrapping every pre-terminal side effect as best-effort.
2. In `useChatController`, add a `finally` or equivalent run-token guarded cleanup around `handleSend` and `handleQuickAsk` so the renderer can clear `isLoading` when `window.hermesAPI.sendMessage(...)` resolves/rejects even if the event listener missed `chat-done`/`chat-error`.
3. Stabilize renderer IPC listener registration: keep `onChatDone`/`onChatError` listener effect dependencies minimal/stable, and read changing model/context values from refs for `onChatUsage` instead of rebinding all listeners on model/config changes.
4. Add a defensive timeout/watchdog or transport heartbeat for cases where visible output completes but API stream/process never reaches terminal completion; surface a recoverable error and unlock rather than requiring manual stop.
5. Consider separating activity/trace side effects from chat lifecycle-critical completion so trace-store failures cannot block UI unlock.

#### Recommended tests
- Renderer unit test: `handleSend` sets loading true, receives `chat-chunk`, then when the `sendMessage` promise resolves without invoking `onChatDone`, loading eventually clears via `finally`.
- Renderer listener stability test: changing model/context state while a run is active should not unregister `chat-done`/`chat-error` listeners or should still clear loading if the send promise resolves.
- Main IPC test: force `recordTraceEvent`, `finishTraceRun`, `updateSessionProfile`, or artifact extraction to throw inside `onDone`; verify `chat-done` is still sent and the `send-message` invoke promise resolves.
- Main IPC test: force pre-emit error side effects inside `onError` to throw; verify `chat-error` is still sent and the invoke promise rejects/settles.
- Transport tests: API stream emits chunks before delayed `[DONE]`; verify renderer remains loading during delay but unlocks on terminal. CLI emits stdout then delays `close`; verify current behavior and intended watchdog/finally behavior.


## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The UI's active/running state is not being cleared when an assistant stream/session reaches completion, leaving the composer in a disabled/stopping state even after content rendering is done.
**Findings:** Initial symptom points to a mismatch between message-rendering completion and request/session lifecycle completion.
**Evidence:** User-provided screenshot and description on 2026-05-14.
**Conclusion:** Needs code-path tracing through chat controller, composer disabled state, stop action, IPC stream completion, and any agent/session status handling.

## Root Cause
The reported UI state maps directly to `useChatController.isLoading === true`:

- `src/renderer/src/screens/Chat/Chat.tsx:134-142` passes `chat.isLoading` and `chat.handleAbort` into `ChatComposer`.
- `src/renderer/src/screens/Chat/components/ChatComposer.tsx:38-45` disables the textarea and renders the red stop button while `isLoading` is true.

Assistant text visibility is separate from completion:

- `src/renderer/src/screens/Chat/hooks/useChatController.ts:277-295` appends streamed chunks through `onChatChunk`, but clears loading only in `onChatDone` / `onChatError`.
- `src/renderer/src/screens/Chat/hooks/useChatController.ts:449-483` and `491-503` set loading before `sendMessage` and await/catch it, but do not clear loading in a `finally` fallback.
- `src/main/ipc/chat.ts:164-179` emits `chat-chunk` before terminal lifecycle work.

The highest-confidence production trigger is brittle main-process terminal emission:

- `src/main/ipc/chat.ts:181-211` runs trace/artifact/session side effects before emitting `chat-done` and resolving the invoke promise.
- `src/main/ipc/chat.ts:231-241` runs failure side effects before emitting `chat-error` and rejecting.
- These callback bodies have no local `try/finally`, so an exception before terminal emission can leave the renderer with rendered content but no unlock event.

Secondary risks:

- Transport semantics intentionally separate visible output from terminal completion: API waits for `[DONE]`, response `end`, error, or timeout (`src/main/hermes/chat-api.ts:49-56`, `128-137`, `245-271`); CLI waits for process `close` (`src/main/hermes/chat-cli.ts:167-211`).
- Renderer listener registration is dependency-sensitive: `src/renderer/src/screens/Chat/hooks/useChatController.ts:314-323` cleans up and re-registers chat listeners when model/context dependencies change, creating a plausible but not proven missed-terminal-event window.

Eliminated / downgraded hypotheses:

- Markdown rendering is not the cause; rendering can be complete while lifecycle remains active.
- The composer component has no hidden local lock state; it reflects `isLoading` props.
- Listener rebinding is plausible but not proven without instrumentation showing `chat-done` was emitted but not received.

## Recommendations
1. In `src/main/ipc/chat.ts`, guarantee terminal IPC and promise settlement with callback-level `try/finally`. `chat-done` / `chat-error` and `settleResolved` / `settleRejected` must run even if trace, artifact, notification, or session-cache side effects fail.
2. In `src/renderer/src/screens/Chat/hooks/useChatController.ts`, add a run-token-guarded finalizer for `handleSend`, `handleQuickAsk`, `handleApprove`, and `handleDeny` so a resolved/rejected `sendMessage` cannot leave the current run stuck if terminal IPC is missed.
3. Stabilize renderer chat listeners by keeping `chat-done` / `chat-error` subscriptions independent of changing model/context state; use refs for usage metadata instead of rebinding all listeners.
4. Add focused regression tests before changing behavior:
   - Main `onDone` side-effect failure still sends `chat-done`, resolves, and clears active run.
   - Main `onError` side-effect failure still sends `chat-error`, settles, and clears active run.
   - Renderer `sendMessage` resolve/reject without terminal IPC re-enables the composer.
   - Quick ask / approve / deny follow the same unlock behavior.
   - Listener rebinding during an active mocked send does not strand `isLoading`.
5. Add a transport watchdog only if logs show streams/processes commonly produce final-looking output but never reach terminal completion after the lifecycle fixes above.

## Preventive Measures
- Treat UI unlock as lifecycle-critical; non-critical trace/session/notification work must never block terminal IPC.
- Add tests for “visible chunks without terminal event” and “terminal side effect throws” to prevent regressions.
- Instrument chat runs with explicit logs/counters for `chat-chunk`, `chat-done`, `chat-error`, send promise settlement, and renderer unlock so future reports can distinguish transport delay, main suppression, and renderer missed-event cases.
- Keep renderer subscriptions stable for lifecycle-critical events; isolate frequently changing metadata into refs or separate listener effects.
