# Design Handoff: Schedule Card (Collapsed & Expanded)

The schedule card is the core component. It exists in two variants (daily strip and weekly grid) and two states (collapsed and expanded). This document specifies the expanded state, shared across both variants.

## Interaction: Expand / Collapse

- **Click on card** (anywhere except toggle switch): card expands inline
- **Click on expanded card header**: card collapses
- **Only one card expanded at a time**: expanding a card collapses any other expanded card
- **Keyboard**: Enter/Space when focused expands/collapses. Escape collapses.

## Expanded State

When expanded, the card grows vertically in place. Other cards push down to accommodate.

### Layout

```
┌──────────────────────────────────────────────┐
│ ▾ 09:00   Morning Briefing              ◉ ⏻ │  ← header (clickable to collapse)
├──────────────────────────────────────────────┤
│                                              │
│  Prompt                                      │
│  ┌────────────────────────────────────────┐  │
│  │ Summarize my inbox, calendar, and      │  │
│  │ pending tasks. Prioritize by urgency.  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Agent         Harness        Delivery       │
│  hermes-daily  Claude 4.6     Local          │
│                                              │
│  Skills                                      │
│  [email-reader] [calendar] [task-manager]    │
│                                              │
│  Recent Runs                                 │
│  ┌────────────────────────────────────────┐  │
│  │ Today 09:01    ● Success   2m 14s    → │  │
│  │ Yesterday 09:00  ● Success   1m 58s  → │  │
│  │ Mon 09:01     ✖ Failed    0m 12s    → │  │
│  │ Sun 09:00     ● Success   2m 30s    → │  │
│  │ Sat 09:01     ● Success   1m 45s    → │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  [Edit]  [Trigger Now]           [Delete]    │
│                                              │
└──────────────────────────────────────────────┘
```

### Expanded Card Container

- **Background**: `var(--bg-primary)`
- **Border**: 1px solid `var(--border-bright)`
- **Border-radius**: `var(--radius-md)` (10px)
- **Padding**: 0 (sections have their own padding)
- **Width**: in daily strip, fills strip width (200px - padding). In weekly grid, min(100%, 320px) with z-index 10 overflow.
- **Box-shadow**: `0 4px 20px rgba(0, 0, 0, 0.12)` (dark) / `0 4px 20px rgba(0, 0, 0, 0.06)` (light)

### Section 1: Header (clickable to collapse)

Same as collapsed card layout but with a collapse indicator:

- **Collapse chevron**: a small downward-pointing chevron (ChevronDown from lucide, 12px) to the left of the time, `var(--text-muted)`. Rotates 180° when expanded (now points up, indicating "click to collapse").
- **Padding**: 10px 12px
- **Border-bottom**: 1px solid `var(--border)`
- **Cursor**: pointer
- **Hover**: `var(--bg-secondary)` background

### Section 2: Prompt

- **Padding**: 12px
- **Label**: "Prompt" — 10px, weight 600, uppercase, `var(--text-muted)`, letter-spacing 0.5px, margin-bottom 4px
- **Content**: prompt text in a subtle box
  - Background: `var(--bg-secondary)`
  - Padding: 8px 10px
  - Border-radius: `var(--radius-sm)`
  - Font: 12px, weight 400, `var(--text-secondary)`, line-height 1.5
  - Max-height: 72px (roughly 4 lines)
  - Overflow-y: auto if longer

### Section 3: Metadata Row

- **Padding**: 0 12px
- **Layout**: flex row, gap 16px, flex-wrap wrap
- **Each metadata item**:
  - Label: 10px, weight 600, uppercase, `var(--text-muted)`, letter-spacing 0.3px
  - Value: 12px, weight 500, `var(--text-primary)`
  - Layout: flex column, gap 2px
- **Items**:
  - **Agent**: profile name (e.g., "hermes-daily")
  - **Harness**: model name (e.g., "Claude 4.6")
  - **Delivery**: target names joined by comma. If only "local", show "Local" with a monitor icon (Monitor, 10px). If Telegram, show Telegram icon, etc.

### Section 4: Skills

- **Padding**: 12px
- **Label**: "Skills" — same style as Prompt label
- **Skills list**: horizontal flex, wrap, gap 4px
- **Each skill pill**:
  - Font: 11px, weight 500, `var(--text-secondary)`
  - Padding: 3px 8px
  - Background: `var(--bg-tertiary)`
  - Border-radius: 12px (fully rounded)
  - Border: 1px solid `var(--border)`
- **If no skills**: show "No skills" in 11px, italic, `var(--text-muted)`

### Section 5: Recent Runs

- **Padding**: 12px
- **Label**: "Recent Runs" — same label style
- **Run list**: flex column, gap 0 (items have their own borders)
- **Container**: border 1px solid `var(--border)`, border-radius `var(--radius-sm)`, overflow hidden
- **Max items**: 5 most recent
- **If more than 5**: show "View all in Trace Lab →" link at the bottom

#### Run Item

- **Height**: 36px
- **Padding**: 0 10px
- **Layout**: flex row, `align-items: center`, gap 8px
- **Border-bottom**: 1px solid `var(--border)` (except last item)
- **Cursor**: pointer
- **Background**: transparent

##### Timestamp
- **Font**: 12px, weight 500, `var(--text-secondary)`
- **Width**: 100px, flex-shrink 0
- **Format**: "Today 09:01", "Yesterday 09:00", "Mon 09:01", or "May 15 09:01" if older than this week

##### Status Badge
- **Size**: 6px circle + text
- **Layout**: flex row, gap 4px, align-items center
- **Success**: `var(--success)` dot + "Success" in 11px, weight 500, `var(--success)`
- **Failed**: `var(--error)` dot + "Failed" in 11px, weight 500, `var(--error)`
- **Running**: `var(--accent)` dot with pulse + "Running..." in 11px, weight 500, `var(--accent-text)`
- **Width**: 80px, flex-shrink 0

##### Duration
- **Font**: 11px, weight 400, `var(--text-muted)`
- **Format**: "2m 14s", "0m 12s"
- **Flex**: 1

##### Arrow
- **Icon**: ChevronRight from lucide, 12px, `var(--text-muted)`
- **Flex-shrink**: 0
- **Indicates**: clickable → navigates to Trace Lab

#### Run Item Hover
- **Background**: `var(--bg-secondary)`
- **Arrow icon**: `var(--text-primary)`
- **Transition**: 100ms

#### Run Item Click
- **Action**: navigate to Trace Lab view, opening the specific trace run entry
- **Passes**: the run's trace ID to the Trace Lab view

### Section 6: Action Bar

- **Padding**: 12px
- **Border-top**: 1px solid `var(--border)`
- **Layout**: flex row, `justify-content: space-between`, `align-items: center`

#### Left Actions
- **"Edit" button**: `btn btn-secondary btn-sm`
  - Icon: Pencil from lucide, 12px
  - Text: "Edit"
  - Click: opens full-screen edit view with this schedule's data pre-filled

- **"Trigger Now" button**: `btn btn-primary btn-sm`
  - Icon: Zap from lucide, 12px
  - Text: "Run Now"
  - Click: fires triggerCronJob IPC, shows brief "Triggered" toast
  - Disabled while action is in progress (shows spinner)

#### Right Action
- **"Delete" button**: `btn-ghost` with `var(--error)` text on hover
  - Icon: Trash from lucide, 14px
  - No text (icon only)
  - Click: shows delete confirmation (same modal as current implementation)

## Card Type Variations

### One-Shot Schedule (in expanded state)

Same layout as above, but:
- **Schedule type indicator** in header: small "ONCE" badge next to the time
  - Same badge spec as in weekly grid collapsed state
- **Metadata row**: adds "Scheduled For" item showing the exact date/time
- **No "Recent Runs" section** if it hasn't run yet — instead show "Scheduled to run on [date]" centered text
- **After completion**: card background gets a subtle `var(--success-bg)` tint, status shows completion result

### Paused Schedule

- **Entire card**: 50% opacity
- **Toggle switch**: off position
- **No "Trigger Now" button** in action bar
- **Status dot**: `var(--text-muted)` at 30%
