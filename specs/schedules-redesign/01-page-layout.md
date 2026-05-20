# Design Handoff: Page Layout

## Viewport Context

Mercury's content area sits to the right of a 230px sidebar. The drag region is 28px at the top. Assume a minimum content width of 800px and a typical width of ~1050px at 1280px window width.

The Schedules page occupies the full content area below the drag region.

## Page Structure

```
┌──────────────────────────────────────────────────────────┐
│  HEADER BAR (56px)                                        │
│  [Schedules]           [Week|Month]    [+ New Schedule]   │
├────────────┬─────────────────────────────────────────────┤
│            │                                              │
│  DAILY     │  WEEKLY GRID  (or MONTH CALENDAR)            │
│  STRIP     │                                              │
│  (200px)   │  7 columns: Mon Tue Wed Thu Fri Sat Sun      │
│            │                                              │
│  Vertical  │  Schedule cards placed in day columns         │
│  list of   │                                              │
│  daily-    │                                              │
│  recurring │                                              │
│  agents    │                                              │
│            │                                              │
├────────────┴─────────────────────────────────────────────┘
```

## Header Bar

- **Height**: 56px
- **Padding**: 0 32px
- **Background**: transparent (inherits page background)
- **Border-bottom**: 1px solid `var(--border)`
- **Layout**: flexbox, `align-items: center`, `justify-content: space-between`

### Left zone
- **Title**: "Schedules"
  - Font: 20px, weight 700, `var(--text-primary)`
  - No subtitle (removed — the view toggle makes context obvious)

### Center zone
- **View toggle**: segmented control with two options
  - Options: "Week" | "Month"
  - Container: `var(--bg-tertiary)` background, `var(--radius-sm)` border-radius, 2px padding
  - Each segment: 72px wide, 32px tall, 13px font, weight 600
  - Inactive segment: transparent background, `var(--text-secondary)` text
  - Active segment: `var(--bg-elevated)` background, `var(--text-primary)` text, `var(--radius-sm)` corners
  - Hover (inactive): `var(--text-primary)` text
  - Transition: background 150ms ease, color 150ms ease

### Right zone
- **"+ New Schedule" button**: `btn btn-primary`
  - Icon: Plus (lucide), 14px, left of text
  - Text: "New Schedule"
  - Standard `.btn-primary` styling

## Content Area

- **Padding**: 0 (no outer padding — the daily strip and grid handle their own)
- **Height**: fills remaining space below header (flex: 1)
- **Overflow**: hidden on the container; each zone scrolls independently

### Daily Strip (left)

- **Width**: 200px, fixed
- **Border-right**: 1px solid `var(--border)`
- **Padding**: 16px 12px
- **Overflow-y**: auto (scrolls independently if many daily agents)
- **Background**: `var(--bg-secondary)` at 50% opacity (subtle differentiation from grid)

### Main Area (right)

- **Width**: fills remaining space (flex: 1)
- **Padding**: 16px 20px
- **Overflow-y**: auto (scrolls independently)
- **Contains**: either the Weekly Grid or Month Calendar based on view toggle

## View Switching

When the user toggles between Week and Month:

- **The daily strip stays visible in both views.** It's always present on the left.
- **The main area content changes** — Weekly Grid swaps for Month Calendar.
- **Transition**: cross-fade, 200ms. Outgoing view fades to 0 opacity while incoming view fades from 0 to 1. No slide.

## Full-Screen Create/Edit View

When the user clicks "+ New Schedule" or edits a schedule:

- **The entire content area** (daily strip + main area) is replaced by the create/edit view.
- **The header bar** changes: title becomes "← New Schedule" (or "← Edit: [Name]") with a back arrow, view toggle is hidden, save/cancel buttons replace the action zone.
- **Transition**: main content slides out to the left (120ms, ease-out), create view slides in from the right (180ms, ease-out, 60ms delay).

## Empty State

When there are no schedules at all (no daily, no weekly, nothing):

- **Daily strip**: hidden entirely (flex: 0, no border)
- **Main area**: centered empty state
  - Icon: CalendarClock from lucide, 48px, `var(--text-muted)` at 40% opacity
  - Title: "No schedules yet" — 16px, weight 600, `var(--text-secondary)`
  - Subtitle: "Schedule your agents to run automatically" — 13px, `var(--text-muted)`
  - CTA: "Create Schedule" — `btn btn-primary`, margin-top 16px
  - All centered vertically and horizontally

## Loading State

- **Daily strip area**: 3 skeleton rectangles (140px x 44px), 8px gap, shimmer animation
- **Main area**: 7 column headers rendered, 2 skeleton cards per column (random heights 40–56px), shimmer animation
- **Shimmer**: linear-gradient sweep from `var(--bg-tertiary)` through `var(--bg-elevated)` back to `var(--bg-tertiary)`, 1.5s cycle, infinite

## Error State

- **Banner**: full width below header bar, 44px tall
  - Background: `var(--error-bg)`
  - Text: 13px, `var(--error)`, "Failed to load schedules"
  - Right side: "Retry" link in `var(--error)`, underline on hover, and X dismiss button
  - Fade-in: 200ms
