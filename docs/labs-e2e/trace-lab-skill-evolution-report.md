# Trace Lab and Skill Auto-Evolution E2E

## Scope

- Fixture: 200 trace runs in an isolated `HERMES_HOME`.
- Install detection: fixture home symlinked to the real `~/.hermes/hermes-agent` binaries so the desktop app exercised the normal installed-app path without mutating real trace data.
- Coverage: completed, failed, aborted, tool activity, file-edit activity, usage events, skill use, skill eval, needs-review, promotion, and rejection.
- Browser control: Electron UI driven through Playwright.

## Results

- Recorded runs loaded: `200/200`.
- Skill-signal filter result: `50/200`.
- Needs-attention filter result: `80/200`.
- Marker search for `LAB_TRACE_120`: `1/200`.
- Full request visible for searched trace: yes.
- Linked skill summary visible for searched trace: yes, including promoted status and `68% trust`.
- Skill-eval panel rows: 50.
- Clicking a skill eval opens the linked trace/event: yes.

## Bugs Found and Fixed

- Skill training extraction dropped score metadata, so the UI could render bars without an auditable score model. Fixed by preserving and clamping skill scores from event metadata.
- `needs-review` metadata on skill eval events was ignored. Fixed by mapping skill metadata status into `SkillTrainingRun.status`.
- Trace filters could update the run list while leaving the detail pane on a run outside the filtered set. Fixed so filters and search drive the selected detail.

## Evidence

- `trace-lab-skill-filter-200-fixed.png`: high-volume skill-signal filtering selects a linked skill trace.
- `trace-lab-linked-skill-run-fixed.png`: marker search finds a specific skill-evolution trace and shows the full request plus trust score.
- `trace-lab-skill-cross-link-fixed.png`: clicking a skill eval opens the exact linked trace/event.
- `trace-lab-skill-evolution-summary.json`: machine-readable assertions from the UI sweep.
