# 50 Response UI Sweep

## Scope

- Harness: Electron UI driven through Playwright browser control against an isolated `HERMES_HOME`.
- Provider path: configured for the OpenCode Go provider and `deepseek-v4-flash`.
- Usage volume: 50 varied chat prompts submitted through the visible Chat composer.
- Training-cycle signal: every prompt carried a unique marker from `RUN_001_OK` through `RUN_050_OK` so trace auditability could be checked under load.

## Results

- Responses generated through the app UI: 50.
- Trace runs recorded: 50.
- Completed trace runs: 50.
- Failed trace runs: 0.
- Unique run markers found in trace event details: 50.

## Product Issue Found

Trace Lab stored the full 50-run cycle, but locating one specific run was too hard:

- The run list had no search/filter.
- Long prompts were truncated before unique audit markers.
- Full request text existed in event details, but it was not visible at the run level.

This removed value from the tracing product because a user running a high-volume skill/training cycle needs to jump directly to a run by marker, phrase, status, or event detail.

## Fix Verified

Trace Lab now supports run search across request text, run metadata, event detail, event type, and event metadata. Run cards show request previews, and the selected run detail shows the full request.

Post-fix UI verification searched for `RUN_050_OK` and produced:

- Filter count: `1/50`.
- Detail panel contains `RUN_050_OK`: yes.
- Evidence: `docs/usage-sweep/50-response-trace-lab-search-fixed.png`.

## Residual Risk

Sessions search returned 0 cards for `RUN_050_OK` during the sweep. Trace Lab now handles trace auditability, but if users expect one global search across sessions and traces, Sessions should index trace/event text or delegate to a shared search layer.
