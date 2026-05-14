# Mercury — E2E Flow Sweep Plan

This document lists the main end-to-end flows in Mercury, organised by:

- **Offline-friendly** — works with an isolated `HERMES_HOME` and no external API calls.
- **Requires external services** — needs a live Hermes Agent, network, or provider API key.
- **Selectors / assertions** — stable DOM hooks a Playwright Electron test can rely on.

> **Convention**: screens are defined in `src/renderer/src/screens/*/`.  
> Navigation sidebar is defined in `src/renderer/src/screens/Layout/Layout.tsx`.  
> Root `App.tsx` orchestrates the boot sequence: Splash → Welcome → Install → Setup → Main (Layout).

---

## 1. Boot / Onboarding Flow

### 1.1 Splash Screen

| Property       | Value                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**     | `SplashScreen`                                                                                                                                              |
| **CSS class**  | `.splash-screen`                                                                                                                                            |
| **Children**   | Mercury brand lockup element generated from the shared logo asset                                                                                          |
| **Behaviour**  | Calls `onFinished()` in `useEffect` — auto-transitions after mount. App logic waits for a minimum `SPLASH_MIN_MS` (1300 ms) plus the install-check promise. |
| **Offline**    | ✅ Yes                                                                                                                                                      |
| **Assertions** | `.splash-screen` exists and the Mercury brand lockup renders with Mercury alt text.                                                                                   |

### 1.2 Welcome Screen — Ready State

| Property          | Value                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**        | `Welcome` (no `error` prop)                                                                                                                          |
| **CSS class**     | `.welcome-screen`                                                                                                                                    |
| **Key selectors** | `h1.welcome-title`, `p.welcome-subtitle`, `button.welcome-button` (text: `Get Started`), button "Connect via SSH", button "Connect to Remote Hermes" |
| **Offline**       | ✅ Yes                                                                                                                                               |
| **Assertions**    | Title and subtitle rendered; `Get Started` button present; SSH and Remote buttons present; no error banner visible.                                  |

### 1.3 Welcome Screen — Error State

| Property          | Value                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| **Screen**        | `Welcome` (with `error` string)                                                                                 |
| **Key selectors** | `h1.welcome-title` shows install issue; error text in `.welcome-subtitle`; buttons: "Retry Install", "Re-check" |
| **Offline**       | ✅ Yes                                                                                                          |
| **Assertions**    | Error string displayed; Retry, Re-check, SSH, Remote buttons rendered; terminal install command box rendered.   |

### 1.4 Welcome — Remote Connection Panel

| Property          | Value                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| **Screen**        | `Welcome` with `panel === "remote"`                                                                       |
| **Key selectors** | `input.welcome-remote-input[type="url"]`, `input.welcome-remote-input[type="password"]`, button "Connect" |
| **Offline**       | ✅ Yes (UI only; actual test requires a reachable endpoint)                                               |
| **Assertions**    | URL input, API key input, Connect button, Back button.                                                    |

### 1.5 Welcome — SSH Connection Panel

| Property          | Value                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Screen**        | `Welcome` with `panel === "ssh"`                                                                                    |
| **Key selectors** | SSH Host input, SSH Port input, Username input, Private Key Path input, Remote Port input, "Connect via SSH" button |
| **Offline**       | ✅ Yes (UI only; actual test requires SSH)                                                                          |
| **Assertions**    | All five inputs rendered; Connect button enabled/disabled by host+user presence.                                    |

### 1.6 Install Screen

| Property          | Value                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**        | `Install`                                                                                                                                                                        |
| **CSS classes**   | `.install-screen`, `.install-progress-container`, `.install-progress-bar`, `.install-progress-fill`, `.install-log`                                                              |
| **Key selectors** | `h1.install-title`, `div.install-step-info`, `button` "Continue to Setup" (after done)                                                                                           |
| **Behaviour**     | Runs `startInstall()` with step progress via `onInstallProgress` IPC.                                                                                                            |
| **Offline**       | 🟡 Partial — UI renders progress but actual install needs backend                                                                                                                |
| **Assertions**    | Progress bar visible; title changes through steps; log container scrollable. After completion: "Continue to Setup" button. On failure: error banner + retry + copy-logs buttons. |

### 1.7 Setup Screen

| Property              | Value                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**            | `Setup`                                                                                                                                                                            |
| **CSS classes**       | `.setup-screen`, `.setup-provider-grid`, `.setup-provider-card`, `.setup-form`, `.setup-continue`                                                                                  |
| **Key selectors**     | Provider selection cards (e.g. "OpenRouter", "Anthropic", "OpenAI", "Google", "xAI", "Nous", "OpenCode Go", "Qwen", "MiniMax", "Local / Custom"); API key input; "Continue" button |
| **Behaviour (local)** | Selecting "Local / Custom" shows base URL presets (LM Studio, Ollama, etc.), optional API key, optional model name.                                                                |
| **Behaviour (cloud)** | Selecting a cloud provider shows API key input with hint link.                                                                                                                     |
| **Offline**           | ✅ Yes (UI only; saving config calls IPC which can be mocked)                                                                                                                      |
| **Assertions**        | All provider cards rendered; clicking one selects it; Continue button disabled when required fields empty; optional fields indicated.                                              |

---

## 2. Main Layout (Sidebar Navigation)

**File**: `src/renderer/src/screens/Layout/Layout.tsx`  
**Classes**: `.layout`, `.sidebar`, `.sidebar-nav`, `.sidebar-nav-item`, `.sidebar-brand`, `.sidebar-footer`

14 sidebar items (in order):

| #   | View      | Icon         | Key Assertion                         |
| --- | --------- | ------------ | ------------------------------------- |
| 1   | Chat      | ChatBubble   | `.sidebar-nav-item` with `Chat` label |
| 2   | Sessions  | Clock        | Button with `Sessions` label          |
| 3   | Traces    | Activity     | Button with `Traces` label            |
| 4   | Agents    | Users        | Button with `Agents` label            |
| 5   | Office    | Building     | Button with `Office` label            |
| 6   | Models    | Layers       | Button with `Models` label            |
| 7   | Providers | KeyRound     | Button with `Providers` label         |
| 8   | Skills    | Puzzle       | Button with `Skills` label            |
| 9   | Soul      | Sparkles     | Button with `Soul` label              |
| 10  | Memory    | Brain        | Button with `Memory` label            |
| 11  | Tools     | Wrench       | Button with `Tools` label             |
| 12  | Schedules | Timer        | Button with `Schedules` label         |
| 13  | Gateway   | Signal       | Button with `Gateway` label           |
| 14  | Settings  | SettingsIcon | Button with `Settings` label          |

**All 14 nav items are rendered on every view.**  
**Offline**: ✅ Yes — sidebar navigation between views is pure UI state; some views show `RemoteNotice` in remote mode.

---

## 3. Chat

**File**: `src/renderer/src/screens/Chat/Chat.tsx`  
**Classes**: `.chat-container`, `.chat-header`, `.chat-messages`, `.chat-input-area`, `.chat-input-wrapper`, `.chat-model-bar`

### 3.1 Empty Chat State

| Property       | Value                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.chat-empty`, `.chat-empty-text`, `.chat-empty-suggestions`, suggestion buttons (Search, Reminder, Email, Script, Schedule, Analyze) |
| **Offline**    | ✅ Yes                                                                                                                                |
| **Assertions** | Empty message displayed; 6 suggestion buttons present; chat input placeholder text visible.                                           |

### 3.2 Send Message / Streaming (requires backend)

| Property       | Value                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `textarea.chat-input`, `button.chat-send-btn`, `.chat-message`, `.chat-message-user`, `.chat-message-agent`, `.chat-bubble`, `.chat-typing`                    |
| **Offline**    | ❌ Requires Hermes Agent with configured model                                                                                                                 |
| **Assertions** | User message bubble rendered; agent responds with streaming dots `.chat-typing`; content appends via `onChatChunk`; `onChatDone` fires; token counter updates. |

### 3.3 Abort / Stop

| Property       | Value                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| **Selectors**  | `button.chat-stop-btn` (only visible when loading)                            |
| **Offline**    | 🟡 Partial — button visibility can be tested; actual abort needs IPC          |
| **Assertions** | While loading, send button becomes stop button; clicking calls `abortChat()`. |

### 3.4 Approve / Deny

| Property       | Value                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.chat-approval-bar`, `.chat-approval-btn.chat-approve`, `.chat-approval-btn.chat-deny`                                          |
| **Behaviour**  | Buttons appear when last agent message matches `/approve.*/deny` patterns (starts with `⚠️`, contains "requires approval", etc.) |
| **Offline**    | 🟡 Partial — UI conditional on message content, but can test with a fake agent message containing approval keywords              |
| **Assertions** | Approval bar visible on matching message; clicking sends `/approve` or `/deny`.                                                  |

### 3.5 Slash Command Menu

| Property       | Value                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Selectors**  | `.slash-menu`, `.slash-menu-item`, `.slash-menu-item-name`, `.slash-menu-item-desc`, `.slash-menu-item-active`     |
| **Offline**    | ✅ Yes                                                                                                             |
| **Assertions** | Typing `/` opens menu; arrow keys navigate; Enter/Tab selects; Escape closes; filtered list updates as user types. |

### 3.6 Local Slash Commands (Offline-Executable)

| Command    | UI Assertion                                | IPC Called                          | Offline |
| ---------- | ------------------------------------------- | ----------------------------------- | ------- |
| `/help`    | Agent bubble with grouped command list      | None (local)                        | ✅      |
| `/new`     | Clears messages, resets session             | None (local)                        | ✅      |
| `/clear`   | Clears messages, aborts current             | None (local)                        | ✅      |
| `/model`   | Agent bubble with current model/provider    | `getModelConfig`                    | ✅      |
| `/memory`  | Agent bubble with memory stats + content    | `readMemory`                        | ✅      |
| `/tools`   | Agent bubble with toolset list              | `getToolsets`                       | ✅      |
| `/skills`  | Agent bubble with installed skills          | `listInstalledSkills`               | ✅      |
| `/persona` | Agent bubble with soul content              | `readSoul`                          | ✅      |
| `/version` | Agent bubble with hermes + desktop versions | `getHermesVersion`, `getAppVersion` | ✅      |
| `/fast`    | Toggle fast mode, agent bubble confirms     | `getConfig` / `setConfig`           | ✅      |
| `/usage`   | Agent bubble with token usage               | Uses local state                    | ✅      |

### 3.7 Model Picker

| Property       | Value                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.chat-model-trigger`, `.chat-model-name`, `.chat-model-dropdown`, `.chat-model-option`, `.chat-model-custom-input`        |
| **Offline**    | 🟡 Partial — dropdown opens/closes locally; model selection calls `setModelConfig` IPC; custom model input works.          |
| **Assertions** | Trigger button shows current model name; dropdown displays grouped models; custom input appears; click selects and closes. |

### 3.8 Fast Mode Toggle

| Property       | Value                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| **Selectors**  | `.chat-fast-btn`, `.chat-fast-popover`                                         |
| **Offline**    | ✅ Yes (calls `setConfig`)                                                     |
| **Assertions** | Toggle button toggles active class; popover tooltip on hover shows state text. |

---

## 4. Sessions

**File**: `src/renderer/src/screens/Sessions/Sessions.tsx`  
**Classes**: `.sessions-container`, `.sessions-card`, `.sessions-card--active`, `.sessions-searchbar`, `.sessions-group`, `.sessions-group-label`

### 4.1 Empty Sessions List

| Property       | Value                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| **Selectors**  | `.sessions-empty`, `.sessions-empty-icon`, `.sessions-empty-text`, `.sessions-empty-hint` |
| **Offline**    | ✅ Yes                                                                                    |
| **Assertions** | Empty state rendered; `New Chat` button present.                                          |

### 4.2 Session List with Groups

| Property       | Value                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.sessions-group`, `.sessions-group-label` ("Today", "Yesterday", "This Week", "Earlier"), `.sessions-card`, `.sessions-card-title`, `.sessions-card-time`, `.sessions-tag` |
| **Offline**    | 🟡 Requires data from backend (`listCachedSessions` / `syncSessionCache`)                                                                                                   |
| **Assertions** | Sessions grouped by date; each card shows title, time, source tag, message count, model tag.                                                                                |

### 4.3 Sessions Search

| Property       | Value                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.sessions-searchbar-input`, `.sessions-searchbar-clear`, search result cards, `.sessions-result-snippet`                                     |
| **Offline**    | 🟡 Requires backend `searchSessions`                                                                                                          |
| **Assertions** | Typing triggers 300 ms debounce; results show highlighted snippets (`<<match>>`); "No results" empty state for no match; clear button resets. |

### 4.4 Resume Session

| Property       | Value                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Behaviour**  | Clicking a session card calls `onResumeSession(sessionId)` which loads messages via `getSessionMessages` and navigates to Chat |
| **Offline**    | ❌ Requires backend                                                                                                            |
| **Assertions** | After click, view changes to Chat; messages populated from session history.                                                    |

---

## 5. Trace Lab

**File**: `src/renderer/src/screens/TraceLab/TraceLab.tsx`  
**Classes**: `.trace-lab`, `.trace-metrics`, `.trace-metric`, `.trace-workbench`, `.trace-run-list`, `.trace-detail`, `.trace-inspector`

### 5.1 Empty Trace Lab

| Property       | Value                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.trace-run-list` empty state `.trace-empty` ("No trace runs yet"), `.trace-detail` empty state ("No run selected"), `.trace-inspector` empty ("No event selected") |
| **Offline**    | ✅ Yes                                                                                                                                                              |
| **Assertions** | Metrics show 0; "No trace runs yet" in runs list; empty state in detail; empty in inspector.                                                                        |

### 5.2 Trace Metrics

| Property       | Value                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.trace-metric` (4 cards): Recorded runs, Completed, Needs attention (failed+aborted), Skill loops |
| **Offline**    | 🟡 Requires data (`listTraceRuns`, `listSkillTrainingRuns`)                                        |
| **Assertions** | Each metric shows label + count value.                                                             |

### 5.3 Trace Run Selection & Detail

| Property       | Value                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.trace-run-row`, `.trace-status-dot` (`.completed`, `.failed`, `.aborted`), `.trace-status-pill`, `.trace-detail-title`, `.trace-facts`, `.trace-fact`, `.trace-timeline`, `.trace-event-row` |
| **Offline**    | 🟡 Requires run data                                                                                                                                                                           |
| **Assertions** | Clicking a run highlights it (`.active`); detail panel shows title, profile, status pill, facts (started, updated, tokens, cost), event timeline.                                              |

### 5.4 Event Inspector

| Property       | Value                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| **Selectors**  | `.trace-inspector`, `.event-inspector`, `.trace-event-type`, `.event-metadata`      |
| **Offline**    | 🟡 Requires event data                                                              |
| **Assertions** | Selecting an event shows its type badge, detail text, and metadata key-value pairs. |

### 5.5 Skill Training Panel

| Property       | Value                                                                            |
| -------------- | -------------------------------------------------------------------------------- |
| **Selectors**  | `.skill-training-panel`, `.skill-training-row`                                   |
| **Offline**    | 🟡 Requires skill training run data                                              |
| **Assertions** | Panel shows "Review queue" heading; lists runs with status, skill name, summary. |

### 5.6 Refresh Button

| Property       | Value                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| **Selectors**  | Button with `.btn-secondary` containing `Refresh` text and `.trace-lab-header` |
| **Offline**    | ✅ Yes (button click fires `load()`)                                           |
| **Assertions** | Loading state disables button; after refresh, metrics and list update.         |

---

## 6. Agents (Profiles)

**File**: `src/renderer/src/screens/Agents/Agents.tsx`  
**Classes**: `.agents-container`, `.agents-card`, `.agents-card--active`, `.agents-card-avatar`, `.agents-card-name`, `.agents-card-provider`, `.agents-card-active-badge`, `.agents-card-chat-button`

### 6.1 Profile List

| Property       | Value                                                                            |
| -------------- | -------------------------------------------------------------------------------- |
| **Selectors**  | `.agents-card` per profile; `.agents-card-active-badge` on active profile        |
| **Offline**    | 🟡 Requires `listProfiles` IPC (backend may work with isolated HERMES_HOME)      |
| **Assertions** | At minimum the "default" profile card rendered; active badge on current profile. |

### 6.2 Create New Profile

| Property       | Value                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | Button "New Agent", `.agents-create`, input, checkbox "Clone config from current", "Create" button, "Cancel"               |
| **Offline**    | ✅ Yes (calls `createProfile` which is local-filesystem)                                                                   |
| **Assertions** | Modal shown/hidden; Create button disabled when name empty; success adds card to grid; error message displayed on failure. |

### 6.3 Delete Profile

| Property       | Value                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.agents-card-delete` (trash icon), `.agents-card-confirm-delete` with Yes/No buttons                                      |
| **Offline**    | ✅ Yes (calls `deleteProfile`)                                                                                             |
| **Assertions** | Clicking delete shows confirm; "Yes" deletes and removes card; "No"/"Cancel" dismisses. Default profile cannot be deleted. |

### 6.4 Switch Active Profile

| Property       | Value                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| **Behaviour**  | Clicking a profile card calls `setActiveProfile(name)` and `onSelectProfile(name)` |
| **Offline**    | ✅ Yes                                                                             |
| **Assertions** | Active badge moves to clicked profile; Chat becomes active profile's context.      |

### 6.5 Chat With Profile

| Property       | Value                                                       |
| -------------- | ----------------------------------------------------------- |
| **Selectors**  | Button inside profile card with `ChatBubble` icon           |
| **Offline**    | ✅ Yes (navigates to Chat)                                  |
| **Assertions** | Clicking navigates to Chat view with profile set as active. |

---

## 7. Models

**File**: `src/renderer/src/screens/Models/Models.tsx`  
**Classes**: `.settings-container`, `.models-header`, `.models-grid`, `.models-card`, `.models-modal-overlay`, `.models-modal`

### 7.1 Empty Models List

| Property       | Value                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| **Selectors**  | `.models-empty`, `.models-empty-text` ("No models yet"), `.models-empty-hint` |
| **Offline**    | ✅ Yes                                                                        |
| **Assertions** | Empty state rendered; "Add Model" button present.                             |

### 7.2 Add / Edit Model Modal

| Property       | Value                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.models-modal`, `.models-modal-title`, input fields (Display Name, Provider select, Model ID, Base URL, API Key for custom), Save/Cancel buttons |
| **Offline**    | ✅ Yes (calls `addModel` / `updateModel`)                                                                                                         |
| **Assertions** | Modal opens/closes; validation error when name or model ID empty; API key field appears only for "Local / Custom" provider; Save calls IPC.       |

### 7.3 Delete Model

| Property       | Value                                                             |
| -------------- | ----------------------------------------------------------------- |
| **Selectors**  | `.models-card-delete` (trash), `.models-card-confirm` with Yes/No |
| **Offline**    | ✅ Yes                                                            |
| **Assertions** | Confirm dialog shown on click; "Yes" removes card.                |

### 7.4 Search / Filter Models

| Property       | Value                                                             |
| -------------- | ----------------------------------------------------------------- |
| **Selectors**  | `.models-search-input`, `.models-search`                          |
| **Offline**    | ✅ Yes (pure client-side filter)                                  |
| **Assertions** | Typing filters visible cards; "No matching models" when no match. |

---

## 8. Providers

**File**: `src/renderer/src/screens/Providers/Providers.tsx`  
**Classes**: `.settings-container`, `.settings-section`, `.settings-field`, `select.settings-select`, `input[type="password"]`, `.settings-toggle-btn`

### 8.1 Provider Selection

| Property       | Value                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| **Selectors**  | Provider dropdown (`.settings-select`); model name input; base URL input (visible only for "Local / Custom") |
| **Offline**    | ✅ Yes                                                                                                       |
| **Assertions** | Changing provider updates label; Local/Custom shows base URL field; auto-save indicator appears.             |

### 8.2 Environment Variable Fields

| Property       | Value                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| **Selectors**  | Per-section API key inputs (type password); show/hide toggle button; saved indicator                        |
| **Offline**    | ✅ Yes                                                                                                      |
| **Assertions** | Typing and blur triggers save (calls `setEnv`); show/hide toggles input type; "Saved" text flashes briefly. |

### 8.3 Credential Pool

| Property       | Value                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.settings-pool-add` (provider select, key input, label input, Add button); `.settings-pool-group`; `.settings-pool-entry`          |
| **Offline**    | ✅ Yes                                                                                                                              |
| **Assertions** | Add button enabled when provider selected and key non-empty; entry appears in list with truncated key; Remove button deletes entry. |

---

## 9. Skills

**File**: `src/renderer/src/screens/Skills/Skills.tsx`  
**Classes**: `.skills-container`, `.skills-tabs`, `.skills-grid`, `.skills-card`, `.skills-detail-overlay`

### 9.1 Tabs (Installed / Browse)

| Property       | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| **Selectors**  | `.skills-tab` ("Installed (N)" and "Browse (M)"); active tab highlighted |
| **Offline**    | ✅ Yes                                                                   |
| **Assertions** | Both tabs rendered; counts update; switching tab shows respective grid.  |

### 9.2 Browse Skills — Filtering

| Property       | Value                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.skills-search-input`, `.skills-category-pills`, `.skills-pill`, `.skills-pill.active`               |
| **Offline**    | ✅ Yes (browse list comes from `listBundledSkills`)                                                   |
| **Assertions** | Category filter pills rendered; active pill highlighted; search filters card list; "All" pill resets. |

### 9.3 Install Skill

| Property       | Value                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Selectors**  | `.skills-card-install-btn` (only on non-installed skills); `.skills-card-installed-badge`              |
| **Offline**    | 🟡 Partial — button rendering depends on data; actual install calls backend                            |
| **Assertions** | Clicking Install calls `installSkill`; button shows "Installing..." then badge changes to "Installed". |

### 9.4 View Skill Detail & Uninstall

| Property       | Value                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.skills-detail-overlay`, `.skills-detail`, `.skills-detail-name`, `.skills-detail-content`, Uninstall button |
| **Offline**    | ✅ Yes (viewing content from installed skill file; uninstall calls `uninstallSkill` which is local)           |
| **Assertions** | Clicking installed skill opens overlay; content rendered as Markdown; Uninstall removes it.                   |

---

## 10. Soul (Persona)

**File**: `src/renderer/src/screens/Soul/Soul.tsx`  
**Classes**: `.soul-container`, `.soul-editor`, `.soul-saved`, `.soul-reset-confirm`

### 10.1 Edit Persona

| Property       | Value                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `textarea.soul-editor`; `h2.soul-title` with "Soul" text; "Saved" indicator                              |
| **Offline**    | ✅ Yes                                                                                                   |
| **Assertions** | Textarea populated with current persona; editing triggers debounced auto-save (500 ms); "Saved" flashes. |

### 10.2 Reset Persona

| Property       | Value                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| **Selectors**  | Button "Reset" (refresh icon); `.soul-reset-confirm` with "Reset" and "Cancel"            |
| **Offline**    | ✅ Yes                                                                                    |
| **Assertions** | Clicking reset shows confirm; confirming calls `resetSoul` and replaces textarea content. |

---

## 11. Memory

**File**: `src/renderer/src/screens/Memory/Memory.tsx`  
**Classes**: `.memory-container`, `.memory-stats`, `.memory-capacities`, `.memory-tabs`, `.memory-entries`, `.memory-profile`, `.memory-providers`

### 11.1 Memory Dashboard (Stats + Capacities)

| Property       | Value                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.memory-stats` (3 stat blocks: Sessions, Messages, Memories); `.memory-capacities` (Agent Memory + User Profile capacity bars) |
| **Offline**    | ✅ Yes                                                                                                                          |
| **Assertions** | Stats display counts; capacity bars show used/limit and percentage; color varies by usage level.                                |

### 11.2 Tabs (Agent Memory / User Profile / Providers)

| Property       | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| **Selectors**  | `.memory-tab` (3 tabs); active tab highlighted; last-modified time shown |
| **Offline**    | ✅ Yes                                                                   |
| **Assertions** | All three tabs present; switching shows corresponding view.              |

### 11.3 Agent Memory — Entry CRUD

| Property       | Value                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Selectors**  | `.memory-entry-card`, `.memory-entry-form`, `.memory-entry-content`, `.memory-entry-actions` (Edit, Delete)                                                              |
| **Offline**    | ✅ Yes                                                                                                                                                                   |
| **Assertions** | Add: form with textarea appears/disappears; saving adds entry card. Edit: replaces content with textarea; save updates. Delete: confirm Yes/No; confirmed entry removed. |

### 11.4 User Profile

| Property       | Value                                                                                |
| -------------- | ------------------------------------------------------------------------------------ |
| **Selectors**  | `textarea.memory-profile-textarea`; "Save Profile" button (visible only when edited) |
| **Offline**    | ✅ Yes                                                                               |
| **Assertions** | Textarea populated; editing shows save button; saving calls `writeUserProfile`.      |

### 11.5 Memory Providers

| Property       | Value                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Selectors**  | `.memory-provider-card`, `.memory-provider-active`, `.memory-provider-badge`, env var password inputs, "Activate" / "Deactivate" buttons   |
| **Offline**    | 🟡 Partial — UI rendering depends on provider list from backend; activate/deactivate calls `setConfig`                                     |
| **Assertions** | Provider cards rendered; active state highlighted; env var inputs rendered per provider; external link button present for known providers. |

---

## 12. Tools

**File**: `src/renderer/src/screens/Tools/Tools.tsx`  
**Classes**: `.tools-container`, `.tools-grid`, `.tools-card`, `.tools-card-enabled`, `.tools-card-disabled`, `.tools-toggle`

### 12.1 Toolset Toggle

| Property       | Value                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Selectors**  | `.tools-card`; `.tools-toggle` checkbox; `.tools-card-label`                                                                                                       |
| **Offline**    | ✅ Yes                                                                                                                                                             |
| **Assertions** | Each toolset card renders label + description + icon + toggle; clicking card or toggle flips state; enabled class applied/removed; `setToolsetEnabled` IPC called. |

### 12.2 MCP Servers Section

| Property       | Value                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Selectors**  | `.tools-card` for MCP servers (with HTTP/STDIO badge); `.tools-card-label` with server name    |
| **Offline**    | ✅ Yes (data from `listMcpServers`)                                                            |
| **Assertions** | Section rendered when servers present; name, type, detail displayed; disabled indicator shown. |

---

## 13. Schedules (Cron Jobs)

**File**: `src/renderer/src/screens/Schedules/Schedules.tsx`  
**Classes**: `.schedules-container`, `.schedules-card`, `.schedules-modal`

### 13.1 Empty Schedule List

| Property       | Value                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.schedules-empty`, `.schedules-empty-text`, `.schedules-empty-hint`, "Create your first task" button |
| **Offline**    | ✅ Yes                                                                                                |
| **Assertions** | Empty state rendered; Create-first-task button present.                                               |

### 13.2 Create Job Modal

| Property       | Value                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.schedules-modal`, `.schedules-field`, `.schedules-freq-pills` (minutes/hourly/daily/weekly/custom), schedule sub-inputs, prompt textarea, deliver-to select, Create/Cancel buttons                                                                                         |
| **Offline**    | ✅ Yes                                                                                                                                                                                                                                                                       |
| **Assertions** | Name input, frequency pills (all 5); sub-inputs change with frequency: minutes shows interval select, daily shows time picker, weekly shows day+time, custom shows cron text input; prompt textarea; deliver-to select with 16 options; Create button calls `createCronJob`. |

### 13.3 Job List — Cards & Controls

| Property       | Value                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.schedules-card`; `.schedules-card-name`; `.schedules-card-schedule`; `.schedules-badge` (`.schedules-badge-active`, `.schedules-badge-paused`, `.schedules-badge-completed`); Pause/Play button; Trigger (Zap) button; Delete button |
| **Offline**    | 🟡 Requires job data from backend; pause/resume/trigger/delete call IPC                                                                                                                                                                |
| **Assertions** | Job card shows name, schedule, state badge; controls rendered according to state (active shows pause+trigger; paused shows play; completed shows neither).                                                                             |

### 13.4 Delete Confirmation

| Property       | Value                                                         |
| -------------- | ------------------------------------------------------------- |
| **Selectors**  | Modal with delete confirm text; Delete/Cancel buttons         |
| **Offline**    | ✅ Yes                                                        |
| **Assertions** | Confirm modal shown/hidden; confirming calls `removeCronJob`. |

---

## 14. Gateway

**File**: `src/renderer/src/screens/Gateway/Gateway.tsx`  
**Classes**: `.settings-container`, `.settings-gateway-row`, `.settings-platform-card`, `.settings-platform-header`, `.tools-toggle`

### 14.1 Gateway Status Toggle

| Property       | Value                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| **Selectors**  | `.settings-gateway-status` (`.running` / `.stopped`); Start/Stop button                     |
| **Offline**    | 🟡 UI renders with status from `gatewayStatus()`; actual start/stop requires backend        |
| **Assertions** | Status indicator shows running/stopped; toggle button calls `startGateway` / `stopGateway`. |

### 14.2 Platform Toggles & Env Vars

| Property       | Value                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.settings-platform-card`, `.settings-platform-header`, toggle checkbox, `.settings-platform-fields` (password inputs) |
| **Offline**    | ✅ Yes (UI only; env save calls `setEnv`)                                                                              |
| **Assertions** | Platform cards rendered; toggling a platform shows its env var fields; typing/blur saves via IPC.                      |

---

## 15. Office (Claw3D)

**File**: `src/renderer/src/screens/Office/Office.tsx`  
**Classes**: `.office-ready`, `.office-toolbar`, `.office-content`, `.office-loading-overlay`, `webview`

### 15.1 Office Status States

| Property       | Value                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.office-center` (checking, not-installed, error states); `.office-setup-card`; `.office-installing` with progress; `.office-ready` with toolbar                                                                |
| **Offline**    | 🟡 All states are UI-driven from IPC responses                                                                                                                                                                  |
| **Assertions** | "Checking" shows spinner; "Not installed" shows setup card with Install + GitHub buttons; "Installing" shows progress bar + step info + log; "Ready" shows toolbar with start/stop, settings, and webview area. |

### 15.2 Start/Stop Claw3D

| Property       | Value                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Selectors**  | Start/Stop button in toolbar; `.office-status-dot` (`.running` / `.stopped`); `.office-status-label` |
| **Offline**    | ❌ Requires actual Claw3D processes                                                                  |
| **Assertions** | Start button transitions to "Starting..." then "Running" with green dot; Stop reverts.               |

### 15.3 Settings Bar

| Property       | Value                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **Selectors**  | Settings gear icon, `.office-settings-bar`, `.office-port-input`, `.office-ws-input`, "View Logs" button |
| **Offline**    | ✅ Yes (UI only)                                                                                         |
| **Assertions** | Clicking gear shows/hides settings bar; port and WS URL inputs present; "View Logs" opens logs panel.    |

---

## 16. Settings

**File**: `src/renderer/src/screens/Settings/Settings.tsx`  
**Classes**: `.settings-container`, `.settings-section`, `.settings-hermes-info`, `.settings-hermes-actions`, `.settings-theme-options`

### 16.1 Hermes Engine Info

| Property       | Value                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.settings-hermes-detail` (Engine version, Release date, Desktop version, Python, OpenAI SDK, HERMES_HOME); skeleton loading placeholders |
| **Offline**    | 🟡 Version info from IPC; skeleton shown while loading                                                                                    |
| **Assertions** | Six info rows; version parsed from version string; update badge shown if update available.                                                |

### 16.2 Engine Actions

| Property       | Value                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Selectors**  | "Update Engine" / "Latest version" button; "Run Diagnosis" button; "Debug Dump" button         |
| **Offline**    | 🟡 Buttons rendered; actual doctor/dump/update require backend                                 |
| **Assertions** | Buttons disabled/enabled based on state; doctor output displayed in `<pre>`; dump output same. |

### 16.3 Connection Mode

| Property       | Value                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Selectors**  | `.settings-theme-options` with "Local", "Remote", "SSH Tunnel" buttons; active class       |
| **Offline**    | ✅ Yes (UI only; save/test calls IPC)                                                      |
| **Assertions** | Three mode buttons; switching shows relevant fields; "Test Connection" and "Save" buttons. |

### 16.4 Remote Connection Fields

| Property       | Value                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| **Selectors**  | URL input (type=url), API key input (type=password), Test Connection, Save |
| **Offline**    | ✅ Yes (UI; actual test requires endpoint)                                 |
| **Assertions** | Both inputs rendered; test/save buttons functional.                        |

### 16.5 SSH Connection Fields

| Property       | Value                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Selectors**  | SSH Host, SSH Port, Username, Private Key Path, Remote Hermes Port inputs; Test SSH Connection, Save |
| **Offline**    | ✅ Yes (UI; actual test requires SSH)                                                                |
| **Assertions** | All five inputs rendered with correct types; test + save buttons present.                            |

### 16.6 OpenClaw Migration Banner

| Property       | Value                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.settings-migration-banner`, `.settings-migration-title`, ".Migrate to Hermes" button, "Skip" button, dismiss × button |
| **Offline**    | 🟡 Banner visibility depends on `checkOpenClaw` IPC; migration calls `runClawMigrate`                                   |
| **Assertions** | Banner shown when OpenClaw found; dismiss hides permanently (localStorage); migration shows progress log + result.      |

### 16.7 Theme Selection

| Property       | Value                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| **Selectors**  | `.settings-theme-options` with "System", "Light", "Dark" buttons                  |
| **Offline**    | ✅ Yes                                                                            |
| **Assertions** | Three theme buttons; active class reflects current theme; clicking changes theme. |

### 16.8 Language Selection

| Property       | Value                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **Selectors**  | `.settings-theme-options` with "English", "Español", "Português", "中文"                                  |
| **Offline**    | ✅ Yes                                                                                                    |
| **Assertions** | All four locale buttons rendered; active class on current locale; clicking changes locale (rerenders UI). |

### 16.9 Network Settings

| Property       | Value                                                          |
| -------------- | -------------------------------------------------------------- |
| **Selectors**  | Force IPv4 toggle (`.tools-toggle` checkbox); HTTP Proxy input |
| **Offline**    | ✅ Yes                                                         |
| **Assertions** | Toggle calls `setConfig`; proxy input blurs saves.             |

### 16.10 Backup / Import

| Property       | Value                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| **Selectors**  | "Export Backup" button; "Import Backup" button; result message            |
| **Offline**    | 🟡 Buttons rendered; actual backup/import requires filesystem + backend   |
| **Assertions** | Buttons disabled during operation; success/error message displayed after. |

### 16.11 Log Viewer

| Property       | Value                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **Selectors**  | Log section collapsible header; log file tab buttons (gateway, agent, errors); `<pre>` log content |
| **Offline**    | ✅ Yes (reads local log files)                                                                     |
| **Assertions** | Clicking header expands section; file tabs switch content; log path shown; refresh reloads.        |

---

## 17. Remote Notice Overlay

**File**: `src/renderer/src/components/RemoteNotice.tsx`  
**Behaviour**: When the app is in remote-only mode (`conn.mode === "remote"` i.e. pure HTTP, not SSH), certain screens show a notice instead of their normal content.

Affected screens:

- Sessions
- Agents (Profiles)
- Providers
- Skills
- Soul
- Memory
- Tools
- Gateway

**Offline**: ✅ Yes (can test by simulating remote mode)  
**Assertions**: RemoteNotice rendered with feature name; normal screen content hidden.

---

## Summary: Testability Matrix

| Screen / Flow                         | Offline (isolated HERMES_HOME) | Requires External Services |
| ------------------------------------- | ------------------------------ | -------------------------- |
| **Boot:** Splash                      | ✅ Pure UI                     | —                          |
| **Boot:** Welcome (ready/error)       | ✅ All states                  | —                          |
| **Boot:** Welcome (remote/SSH panels) | ✅ UI                          | ❌ Test connection         |
| **Boot:** Install                     | 🟡 Progress UI                 | ❌ Actual install          |
| **Boot:** Setup                       | ✅ UI + IPC                    | 🟡 Needs env to save       |
| **Chat:** Empty state                 | ✅                             | —                          |
| **Chat:** Message streaming           | —                              | ❌ Model provider          |
| **Chat:** Slash commands (local)      | ✅ 11 commands                 | —                          |
| **Chat:** Model picker                | 🟡 Dropdown                    | ❌ Model list from backend |
| **Chat:** Approval bar                | ✅ Inject fake msg             | —                          |
| **Sessions:** List/search             | —                              | ❌ Backend data            |
| **TraceLab:** Metrics/list/inspector  | —                              | ❌ Backend data            |
| **TraceLab:** Empty state             | ✅                             | —                          |
| **Agents:** List/create/delete/switch | ✅                             | —                          |
| **Models:** CRUD                      | ✅                             | —                          |
| **Providers:** UI + env keys          | ✅                             | —                          |
| **Skills:** Browse/filter             | ✅                             | —                          |
| **Skills:** Install/uninstall         | 🟡 UI + IPC                    | ❌ Backend install         |
| **Soul:** Edit/reset                  | ✅                             | —                          |
| **Memory:** Stats/entries/profile     | ✅                             | —                          |
| **Memory:** Providers                 | 🟡 UI                          | ❌ Activate/deactivate     |
| **Tools:** Toggle/MCP list            | ✅                             | —                          |
| **Schedules:** CRUD UI                | ✅                             | ❌ Cron execution          |
| **Gateway:** UI + toggles             | ✅                             | ❌ Start/stop gateway      |
| **Office:** All states                | 🟡 UI                          | ❌ Claw3D processes        |
| **Settings:** Theme/lang/network      | ✅                             | —                          |
| **Settings:** Engine info/doctor      | 🟡 Buttons                     | ❌ Doctor/dump             |
| **Settings:** Connection modes        | ✅ UI                          | ❌ Test connections        |
| **Settings:** Backup/import           | 🟡 Buttons                     | ❌ Actual backup           |
| **Settings:** Log viewer              | ✅                             | —                          |
| **Navigation:** Sidebar (14 views)    | ✅                             | —                          |
| **RemoteNotice**                      | ✅                             | —                          |
