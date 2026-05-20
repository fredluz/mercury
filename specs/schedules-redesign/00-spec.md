# Spec: Schedules Page Redesign

Created: Wednesday, May 20, 2026
Status: Draft

## Problem Statement

Mercury's Schedules page is a flat cron-job manager that shows raw cron expressions, offers no edit flow, no one-shot scheduling, and no timeline view. Users scheduling AI agents need an experience closer to setting alarms on an iPhone or events on Google Calendar — intuitive time management with clear visual feedback about what runs when, not sysadmin-style cron wrangling.

## Proposed Solution

Replace the current flat card list with a three-zone scheduling interface:

1. **Daily strip** — A vertical sidebar showing agents that recur every day, ordered by time. This is the user's "daily rhythm" — the agents they see fire every single day.
2. **Weekly grid** — The default main view. Seven day-columns (Mon–Sun) showing all non-daily schedules placed in their respective days. Weekly, custom, and one-shot schedules live here.
3. **Month calendar** — A toggle view for infrequent schedules (monthly, quarterly, one-shot far-future). Daily items are hidden here by default; a toggle reveals them.

Each schedule card is **minimal by default** (time, agent name, one-line description) and **expands inline on click** to reveal full detail: prompt, skills, harness, delivery targets, and a clickable run history list (each run links to Trace Lab).

Creation uses a **full-screen view** (like Google Calendar event creation) with an agent picker, schedule type pills, Android-style clock face time picker, day-of-week multi-selector, skill overrides, and delivery target selection.

## Requirements

### Functional

- [ ] Weekly grid as default view — 7 day-columns showing scheduled runs
- [ ] Daily strip — vertical sidebar listing daily-recurring agents by time
- [ ] Month calendar view — toggle from weekly, for monthly/one-shot/infrequent schedules
- [ ] "Show daily in calendar" toggle — off by default, reveals daily items in month view
- [ ] Schedule card collapsed state — time, agent name, one-line description, toggle switch
- [ ] Schedule card expanded state — inline expand with prompt, skills, harness, delivery targets, run history
- [ ] Run history in expanded card — clickable list of recent runs, each links to Trace Lab
- [ ] Toggle switch per schedule — iOS-style on/off (maps to pause/resume)
- [ ] One-shot schedules — "Once" frequency: pick date+time, runs once, then completes
- [ ] Full-screen create view — agent picker, schedule type, time picker, skill overrides, delivery
- [ ] Full-screen edit view — same as create, pre-filled with existing schedule data
- [ ] Agent picker — searchable dropdown of available Hermes profiles/agents
- [ ] Skill override — shows agent defaults as toggleable list, allows adding extra skills
- [ ] Prompt override — pre-filled with agent default, editable
- [ ] Clock face time picker — Android Material style, two-stage (hours then minutes)
- [ ] Day-of-week multi-selector — 7 circular buttons (M T W T F S S) with weekday/weekend shortcuts
- [ ] Current-day highlight in weekly grid
- [ ] "Now" time indicator in daily strip
- [ ] Today column accent in weekly grid
- [ ] View toggle in header — Week | Month

### Non-Functional

- [ ] All animations under 300ms — no sluggish transitions
- [ ] Respects existing Mercury theme tokens (dark/light) without new color variables
- [ ] Card expand/collapse must feel snappy — 250ms with Material standard easing
- [ ] Weekly grid must handle 0–20+ schedules per day without layout breakage
- [ ] Full i18n — all strings through react-i18next

## Test Requirements

- [ ] Unit: Schedule card renders collapsed state with correct data
- [ ] Unit: Schedule card expands on click, collapses on second click
- [ ] Unit: Toggle switch fires pause/resume IPC call
- [ ] Unit: Create view validates required fields (agent, time)
- [ ] Unit: Clock face returns correct hour/minute values
- [ ] Unit: Day-of-week selector produces correct cron expression
- [ ] Unit: One-shot schedule sets repeat.times = 1
- [ ] Integration: Create schedule → appears in weekly grid on correct day
- [ ] Integration: Toggle schedule off → card shows paused state
- [ ] Integration: Click run history entry → navigates to Trace Lab view
- [ ] Edge: Day with 20+ schedules scrolls without overflow
- [ ] Edge: Long agent name truncates in collapsed card, shows full in expanded
- [ ] Edge: Empty state renders when no schedules exist

## Out of Scope

- "Completed while you were gone" dashboard widget (separate feature, planned in parallel)
- Mobile/responsive layout (desktop Electron only for now)
- Drag-and-drop rescheduling
- Multi-profile schedule management (inherits app-level profile selection)
- Conversational schedule creation via chat (CLI concern, not UI page)

## Correction Log

(none yet)

## Open Questions

- [ ] Should the clock face support both 12h and 24h based on user locale, or always 24h?
- [ ] Should completed one-shots remain in the weekly grid (dimmed) or only in month/calendar view?

## Acceptance Criteria

1. User can view their full week of scheduled agent runs at a glance
2. Daily agents are visually separated in the daily strip
3. Tapping any schedule reveals full detail including run history inline
4. User can create a new schedule via full-screen view with agent picker and clock face
5. User can edit an existing schedule
6. One-shot schedules can be created and auto-complete after firing
7. Month view shows infrequent schedules on a calendar grid
8. Every run history entry links to its Trace Lab entry
9. All theme tokens respected — works in both dark and light mode
