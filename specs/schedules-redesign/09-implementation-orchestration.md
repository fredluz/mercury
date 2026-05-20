# Schedules Redesign Implementation Orchestration

Created: Wednesday, May 20, 2026
Owner: Codex orchestrator
Status: Active goal plan

## Self Prompt

You are the orchestrator for Mercury's full schedules redesign. Stay focused on end-to-end product correctness, not isolated UI replacement. The work is complete only when scheduled agent runs can be created, edited, executed with the intended agent/profile, skills, context payload, delivery targets, run provenance, and Trace Lab links; the redesigned Schedules page and the dashboard completed-runs surface both render correctly; tests and visual QA pass.

Do not treat the existing cron page as the product boundary. Treat it as legacy plumbing. The target product is a scheduled agent-run system: users can schedule runs from a standalone Schedules page or from live conversation context, and those future runs should start with the selected context/skills/files already available so the agent does not waste first-turn work rediscovering them.

Use subagents aggressively. The parent agent should remain the planner, reviewer, integrator, and test/QA owner. Delegate implementation slices with explicit file ownership and close subagents after their patches are integrated or rejected. Never leave long-running agents around after their output is no longer needed.

For any frontend screen, component, icon, or asset that could be handed to Figma, first spawn a Pi/Kimi visual-spec agent. Iterate until it produces a pixel-level visual spec suitable for implementation and image generation. Do not implement visual-heavy frontend from vague prose alone.

## Product Scope

Everything in `specs/schedules-redesign/` is in scope, including:

- Schedules page redesign: header, daily strip, weekly grid, month calendar.
- Shared expandable schedule cards with run history.
- Full-screen create/edit schedule flow.
- One-shot, daily wall-clock, weekly, monthly, custom cron, and interval schedules.
- Conversation-context scheduling entry points.
- Real skill/context injection for scheduled agent runs.
- Trace Lab deep links for specific scheduled runs.
- Dashboard "While You Were Away" completed-runs surface.
- Loading, error, empty, paused, completed, running, overflow, theme, and animation states.
- Full i18n coverage and tests.

## Delegation Model

Spawn only bounded subagents with disjoint ownership. Tell every worker they are not alone in the codebase, must not revert unrelated edits, and must list changed files.

### Agent 1: Visual Spec

Model: Pi/Kimi through MACX tmux.
Ownership: No code writes unless explicitly asked; visual spec artifact only.
Task:
- Read `specs/schedules-redesign/00-spec.md` through `08-dashboard-completed-runs.md`.
- Inspect current Mercury visual tokens and screenshots/styles if needed.
- Produce a pixel-level visual spec for Schedules page, create/edit flow, schedule cards, month view, clock picker, dashboard completed-runs, and icons.
- Include desktop dimensions, spacing, typography, states, animation notes, and implementation-ready component anatomy.
- Output a markdown artifact under `specs/schedules-redesign/visual-spec-kimi.md`.

### Agent 2: Backend Contracts

Ownership:
- `src/main/cronjobs.ts`
- `src/main/services/cron-service.ts`
- `src/main/ipc/cron.ts`
- `src/preload/api/app.ts`
- `src/preload/index.d.ts`
- relevant shared schedule types if added
- backend/IPC tests
Task:
- Add/update schedule contract supporting create, edit/update, one-shots, intervals, delivery arrays, selected skills, context payload metadata, source session/trace IDs, and run history fields.
- Preserve local, SSH, and verified remote behavior where existing patterns require it.
- Avoid breaking existing cron CLI parity tests.

### Agent 3: Trace/Run History

Ownership:
- `src/main/trace-store.ts`
- `src/main/ipc/trace.ts`
- `src/preload/api/navigation.ts`
- `src/preload/index.d.ts`
- `src/renderer/src/screens/TraceLab/*`
- trace-related tests
Task:
- Make scheduled runs traceable like normal runs.
- Provide a way to resolve recent runs for a schedule from Trace Lab data or scheduled-run metadata.
- Add deep-link/navigation support for opening a specific trace run.
- Support dashboard completed-runs queries since last active/dismissed timestamp.

### Agent 4: Conversation Scheduling Entry

Ownership:
- Chat/session renderer modules
- Layout routing seams needed to open schedule composer with context
- i18n keys for chat/scheduling affordances
Task:
- Add a schedule-from-conversation entry point that opens schedule creation with current profile and compact context bundle.
- Do not create a static "default prompt" model. Capture useful source context and let the user edit the scheduled run instruction.

### Agent 5: Schedules Frontend

Ownership:
- `src/renderer/src/screens/Schedules/**`
- `src/renderer/src/assets/styles/schedules.css`
- schedules i18n locale files
- schedules renderer tests
Task:
- Replace legacy flat cron list with page shell, daily strip, weekly grid, month calendar, expandable cards, full-screen create/edit flow, clock picker, day selectors, delivery chips, skill selector, validation, and states.
- Implement from visual spec and existing tokens.
- Use lucide icons through the local icon export layer.

### Agent 6: Dashboard Completed Runs

Ownership:
- Home/chat/dashboard surface files selected after exploration
- dashboard/completed-runs renderer components/styles/tests
Task:
- Implement "While You Were Away" at the top of the main/home screen.
- Use completed scheduled runs since last active/dismissed timestamp.
- Add mark-all-read persistence.

### Agent 7: Test/QA Worker

Ownership:
- focused tests only unless assigned fixes
- e2e/QA notes
Task:
- Run targeted tests after integration.
- Add missing tests for schedule parsing, create/edit validation, toggle IPC, run deep links, dashboard visibility, and layout overflow.
- Use browser/app visual QA where possible and report concrete failures.

## Parent Orchestrator Responsibilities

1. Spawn Agent 1 first and wait only when visual implementation depends on its artifact.
2. Spawn code explorers or workers only after assigning precise write scopes.
3. Keep the integration model in parent context:
   - `ScheduleRecord`: normalized renderer/backend schedule.
   - `ScheduleRunSummary`: trace-backed run history entry.
   - `ScheduleContextBundle`: compact provenance/context for future runs.
   - `ScheduleDraft`: create/edit form state.
4. Review every worker patch before merging mentally or editing nearby files.
5. Resolve cross-slice seams personally: preload typings, IPC names, i18n key alignment, and navigation state.
6. Run tests/typecheck in focused waves, then broader verification.
7. Close every subagent once its output is integrated, superseded, or no longer needed.
8. Mark the goal complete only after implementation, tests, and QA are actually done.

## Implementation Phases

### Phase 0: Baseline Map

- Capture dirty worktree status and avoid reverting unrelated changes.
- Read current Schedules, cron service, Trace Lab, Layout, Chat, i18n, and test patterns.
- Identify exact entry points for dashboard/home placement.

### Phase 1: Visual Spec

- Spawn Pi/Kimi visual-spec agent.
- Review artifact for missing states or contradictions.
- If weak, send one refinement request before frontend implementation starts.

### Phase 2: Data Contracts

- Normalize existing cron jobs without losing unknown fields.
- Add update/edit IPC.
- Add richer schedule metadata and context fields.
- Support one-shot repeat semantics and interval schedules.
- Add run-history lookup contract.

### Phase 3: Trace Integration

- Link scheduled executions to trace run IDs.
- Add specific-run Trace Lab launch mode.
- Build "recent runs for schedule" helper.
- Add completed-runs-since query/dismiss timestamp storage.

### Phase 4: Frontend Build

- Implement Schedules page shell, daily strip, weekly grid, month calendar.
- Implement expandable schedule cards and action wiring.
- Implement full-screen create/edit with clock picker, date/day/month selectors, skills/context/delivery.
- Implement loading/error/empty/overflow/theme states.
- Add conversation scheduling entry.
- Add dashboard completed-runs component.

### Phase 5: Verification

- Unit tests for parsing, validation, card expansion, toggles, one-shots, IPC calls.
- Integration tests for create/edit/list placement and trace deep links.
- Typecheck web/node/cli where touched.
- Run app/dev server or Electron preview as appropriate.
- Use browser/Playwright visual checks for desktop dimensions, dark/light, overflow, and non-overlap.

## Default Decisions

- All times display as 24-hour local time.
- Completed one-shots remain visible dimmed and link to their trace run.
- Interval schedules are first-class alongside daily/weekly/monthly/custom.
- Delivery is multi-select and preserves all existing Mercury targets unless backend cannot execute one.
- Agent picker means Hermes profile picker; active profile is the default.
- No "default prompt" assumption. Creation starts with an editable instruction and optional source conversation context.
- Dashboard completed-runs is in scope.

## Completion Gate

The work is complete when:

- Existing schedules still load and mutate.
- New schedule types can be created and edited.
- Scheduled runs carry selected skills/context metadata into execution.
- Recent runs and dashboard completed runs are backed by trace data.
- Trace Lab can open a specific scheduled run.
- The redesigned UI matches the visual spec closely in dark and light themes.
- Focused tests and relevant typechecks pass, or any remaining failure is documented with a concrete blocker.
- All spawned subagents are closed.
