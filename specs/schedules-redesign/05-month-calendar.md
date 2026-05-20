# Design Handoff: Month Calendar View

The month calendar view replaces the weekly grid in the main area when the user toggles to "Month." It shows infrequent schedules (monthly, quarterly, one-shots) on a traditional calendar grid. The daily strip remains visible on the left.

## Layout

```
┌──────────────────────────────────────────────────┐
│        ◀   May 2026   ▶           ☐ Show daily   │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┤
│ Mon  │ Tue  │ Wed  │ Thu  │ Fri  │ Sat  │ Sun  │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│      │      │      │   1  │   2  │   3  │   4  │
│      │      │      │  ●●  │      │      │      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│   5  │   6  │   7  │   8  │   9  │  10  │  11  │
│  ●   │      │      │  ●   │      │      │      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│  12  │  13  │  14  │  15  │  16  │  17  │  18  │
│      │      │      │  ●   │      │      │      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│  19  │ [20] │  21  │  22  │  23  │  24  │  25  │
│  ●   │      │      │      │      │      │      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│  26  │  27  │  28  │  29  │  30  │  31  │      │
│      │      │      │      │  ●   │      │      │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┘

┌──────────────────────────────────────────────────┐
│  Selected Day: Thursday, May 1                    │
│                                                   │
│  [card] Invoice Agent — 14:30 — Monthly           │
│  [card] Tax Reminder  — 10:00 — Once              │
│                                                   │
└──────────────────────────────────────────────────┘
```

## Month Navigation Bar

- **Height**: 44px
- **Padding**: 0 8px
- **Layout**: flex row, `align-items: center`, `justify-content: space-between`
- **Background**: transparent
- **Border-bottom**: 1px solid `var(--border)`

### Left: Month Navigation
- **Previous arrow**: ChevronLeft from lucide, 16px, `var(--text-secondary)`, btn-ghost styling (24x24px hit area)
- **Month/Year label**: "May 2026" — 15px, weight 700, `var(--text-primary)`
  - Clicking the label: no action (reserved for future month-picker popover)
- **Next arrow**: ChevronRight from lucide, 16px, `var(--text-secondary)`, btn-ghost styling
- **Gap**: 12px between arrows and label
- **Hover on arrows**: `var(--text-primary)`, `var(--bg-tertiary)` background

### Right: Show Daily Toggle
- **Layout**: flex row, gap 6px, align-items center
- **Checkbox**: 16x16px
  - Unchecked: `var(--bg-primary)` background, 1px `var(--border-bright)` border, `var(--radius-sm)` corners
  - Checked: `var(--accent)` background, white checkmark (Check icon, 10px), `var(--radius-sm)` corners
  - Transition: 150ms
- **Label**: "Show daily" — 12px, weight 500, `var(--text-secondary)`
- **Default state**: unchecked
- **Effect when checked**: daily-recurring schedules appear as dots and cards in the calendar, alongside monthly/one-shot items

## Day-of-Week Header Row

- **Height**: 28px
- **Grid**: `grid-template-columns: repeat(7, 1fr)`
- **Each cell**: centered text
  - Font: 11px, weight 600, uppercase, `var(--text-muted)`, letter-spacing 0.5px
  - Text: "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"
- **Border-bottom**: 1px solid `var(--border)`

## Calendar Grid

- **Grid**: `grid-template-columns: repeat(7, 1fr)`, `grid-template-rows: repeat(auto, 1fr)`
- **Rows**: 5 or 6 depending on the month
- **Each cell height**: flexible, min-height 64px

### Day Cell

- **Padding**: 4px
- **Border-right**: 1px solid `var(--border)` (except last column)
- **Border-bottom**: 1px solid `var(--border)` (except last row)
- **Cursor**: pointer
- **Background**: transparent

#### Date Number
- **Position**: top-left of cell, 4px inset
- **Font**: 13px, weight 600, `var(--text-primary)`

#### Today's Date Number
- **Displayed inside circle**: 24px diameter, `var(--accent)` background, white text
- **Border-radius**: 50%
- **Centered within the 24px circle**

#### Past Date Number
- **Color**: `var(--text-muted)` at 60%

#### Outside-Month Dates
- **Visibility**: shown but very dimmed
- **Color**: `var(--text-muted)` at 25%
- **Schedule dots**: not shown for outside-month dates

#### Schedule Dots
- **Position**: below the date number, centered horizontally
- **Margin-top**: 4px from date number
- **Layout**: flex row, gap 3px, centered
- **Each dot**: 6px circle
- **Dot color**: `var(--accent)` for active schedules
- **Max visible dots**: 3. If more than 3 schedules on a day, show 3 dots + a "+N" text
  - "+N" text: 9px, weight 600, `var(--text-muted)`, inline with the dots
- **One-shot dot**: `var(--accent)` with a ring outline (border: 1.5px solid `var(--accent)`, transparent fill) to distinguish from recurring

### Day Cell States

#### Default
As described above.

#### Hover
- **Background**: `var(--bg-secondary)`
- **Transition**: 100ms

#### Selected (clicked)
- **Background**: `var(--accent-subtle)`
- **Border**: 1px solid `var(--accent)` at 30% opacity
- **Opens**: the Day Detail Panel below the calendar grid

#### Today
- **Background**: `var(--accent-subtle)` at 50% of normal accent-subtle
- **Very subtle** — just a hint that this is today

## Day Detail Panel

When a day is clicked, a panel appears below the calendar grid showing that day's schedules.

- **Position**: below the calendar grid, full width of the main area
- **Height**: auto (content-dependent), max 300px with scroll
- **Padding**: 16px
- **Background**: `var(--bg-primary)`
- **Border-top**: 1px solid `var(--border-bright)`
- **Animation**: slide down from 0 height, 200ms ease

### Panel Header
- **Text**: "Thursday, May 1" — full date with day of week
- **Font**: 14px, weight 600, `var(--text-primary)`
- **Close button**: X from lucide, 14px, `var(--text-muted)`, btn-ghost, top-right
- **Margin-bottom**: 12px

### Panel Content
- **Layout**: flex column, gap 6px
- **Contains**: schedule cards (same as weekly grid compact cards but full-width, not column-constrained)
- **Card width**: max 480px
- **Cards are clickable**: expand inline within the panel (same expand behavior as elsewhere)

### Empty Day
If the selected day has no schedules:
- Centered text: "No schedules on this day" — 13px, `var(--text-muted)`

## Transition: Week ↔ Month

When toggling between Week and Month views:

- **Duration**: 200ms
- **Effect**: cross-fade (outgoing fades to 0, incoming fades from 0 to 1)
- **The daily strip does NOT animate** — it stays static during the transition
- **Selected day resets** when switching to Month view (panel is closed)
