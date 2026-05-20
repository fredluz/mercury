# Design Handoff: Dashboard — "Completed While You Were Away"

This is a SEPARATE feature from the Schedules page redesign. It lives on Mercury's main dashboard / home screen. Specified here for parallel development.

## Purpose

When the user opens Mercury after being away, they see a summary of scheduled runs that completed in their absence. It answers: "What did my agents do while I was gone?"

## Placement

This is a section on Mercury's main/home screen (the chat view or a future dashboard view). It appears at the top of the content area, above the chat or session list.

## Visibility Logic

- **Shown when**: there are completed scheduled runs since the user's last active session
- **Hidden when**: no new completions, or all completions have been dismissed
- **"Last active"**: determined by the most recent user-initiated chat message timestamp, or the last time the user dismissed this section

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  While You Were Away                     [Mark all read] │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────────────────────────────────────────┐│
│  │ ● 09:01  Morning Briefing          ✓ Success  2m 14s││
│  │   Summarized 12 emails, 3 calendar events, 2 tasks  ││
│  ├──────────────────────────────────────────────────────┤│
│  │ ● 06:00  Data Sync Agent           ✓ Success  5m 02s││
│  │   Synced 847 records from CRM to local cache         ││
│  ├──────────────────────────────────────────────────────┤│
│  │ ✖ 03:00  Backup Agent              ✖ Failed   0m 08s││
│  │   Error: Connection timeout to remote storage        ││
│  └──────────────────────────────────────────────────────┘│
│                                                           │
│  3 runs completed · 1 failed                              │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

## Section Header

- **Text**: "While You Were Away"
- **Font**: 15px, weight 700, `var(--text-primary)`
- **Right side**: "Mark all read" — 12px, weight 500, `var(--accent-text)`, cursor pointer, underline on hover
  - Click: dismisses the entire section, stores dismissal timestamp
- **Padding**: 16px 20px 8px
- **Border-bottom**: none (the run list provides visual separation)

## Run List

- **Container**:
  - Background: `var(--bg-secondary)`
  - Border: 1px solid `var(--border)`
  - Border-radius: `var(--radius-md)`
  - Margin: 0 20px
  - Overflow: hidden

### Run Item

- **Height**: auto (two lines)
- **Padding**: 10px 14px
- **Border-bottom**: 1px solid `var(--border)` (except last)
- **Cursor**: pointer
- **Layout**: two rows

#### Row 1 (Main Info)
- **Layout**: flex row, align-items center, justify-content space-between
- **Left side**: flex row, gap 8px
  - Status dot: 6px circle, `var(--success)` or `var(--error)`
  - Time: 12px, weight 600, `var(--text-secondary)` — format: "09:01" or "Yesterday 09:01" if older than today
  - Schedule name: 13px, weight 600, `var(--text-primary)`
- **Right side**: flex row, gap 12px
  - Status text: 11px, weight 600
    - Success: `var(--success)`, "Success"
    - Failed: `var(--error)`, "Failed"
  - Duration: 11px, weight 400, `var(--text-muted)`, format "2m 14s"

#### Row 2 (Summary)
- **Margin-top**: 4px
- **Margin-left**: 14px (aligned with schedule name, past the dot)
- **Font**: 12px, weight 400, `var(--text-muted)`, line-height 1.4
- **Single line**: ellipsis overflow
- **Content**: one-line summary of what the run did (extracted from trace/run output)

### Run Item States

#### Default
As described above.

#### Hover
- Background: `var(--bg-tertiary)`
- Transition: 100ms

#### Click
- Navigates to the Trace Lab entry for this specific run
- Same behavior as clicking a run in the schedule card's run history

#### Failed Run
- Left border: 2px solid `var(--error)`
- Summary text in `var(--error)` instead of `var(--text-muted)`

## Footer

- **Padding**: 8px 20px 16px
- **Font**: 12px, weight 500, `var(--text-muted)`
- **Content**: "[N] runs completed · [M] failed"
  - Failed count only shown if > 0
  - Failed count in `var(--error)`

## Max Items

- **Default visible**: 5 most recent
- **If more than 5**: show "Show N more" link below the list
  - Font: 12px, weight 500, `var(--accent-text)`, cursor pointer
  - Click: expands to show all (with max-height 400px, overflow-y auto)

## Animations

### Section Appearance (on page load)
- Slide down from -20px + fade in: 250ms, decelerate easing
- Run items stagger: 40ms between each, max 5 stagger steps

### Dismiss ("Mark all read")
- Section height collapses to 0: 200ms, standard easing
- Opacity fades to 0: 150ms
- Stored: dismissal timestamp saved to prevent re-showing same completions

### Individual Item Dismiss (future consideration)
Not in v1. Could add swipe-to-dismiss later.

## Data Requirements

To populate this section, the backend needs to provide:
- List of completed scheduled runs since a given timestamp
- Each run: schedule name, run timestamp, status (success/fail), duration, trace ID, one-line summary
- The "one-line summary" could be:
  - The first line of the agent's response
  - A title generated from the trace
  - Or the schedule's prompt as fallback

## Integration Notes

- This feature depends on the Trace Lab's run data
- The "last active" timestamp should persist across app restarts (store in Mercury's local config)
- If the run summary isn't available from the trace, fall back to showing the schedule's prompt text
- Failed runs should always show the error message, not the prompt
