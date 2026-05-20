# Design Handoff: Create & Edit Full-Screen View

This is a full-screen view that replaces the entire Schedules content area (daily strip + grid/calendar). The app sidebar (230px) remains visible. Used for both creating new schedules and editing existing ones.

## Entry Transitions

### Opening (from Schedules page)
- Current content (daily strip + grid) slides out to the left: 120ms, ease-out
- Create view slides in from the right: 180ms, ease-out, 60ms delay
- Header bar transitions: title changes, view toggle fades out, save/cancel buttons fade in (all 150ms)

### Closing (back to Schedules page)
- Reverse of opening: create view slides out right, schedule content slides in from left
- Same timing

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  ← Back                                  Cancel    Save  │  ← Modified header
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                                                      │ │
│  │   AGENT SELECTION                                    │ │
│  │   ┌────────────────────────────────────────────┐    │ │
│  │   │ 🔍 Search agents...                        │    │ │
│  │   └────────────────────────────────────────────┘    │ │
│  │                                                      │ │
│  │   SCHEDULE TYPE                                      │ │
│  │   [ Once ] [ Daily ] [ Weekly ] [ Monthly ] [Custom] │ │
│  │                                                      │ │
│  │   TIME                          DAY PICKER           │ │
│  │   ┌──────────────┐             M T W T F S S         │ │
│  │   │              │             [Weekdays] [Weekend]   │ │
│  │   │  Clock Face  │                                    │ │
│  │   │              │             DATE (for "Once")      │ │
│  │   │   12         │             ┌──────────────────┐   │ │
│  │   │ 9    3       │             │ Calendar picker   │  │ │
│  │   │   6          │             └──────────────────┘   │ │
│  │   └──────────────┘                                    │ │
│  │                                                      │ │
│  │   PROMPT                                             │ │
│  │   ┌────────────────────────────────────────────┐    │ │
│  │   │ Summarize my inbox...                       │    │ │
│  │   │                                             │    │ │
│  │   └────────────────────────────────────────────┘    │ │
│  │                                                      │ │
│  │   SKILLS                                             │ │
│  │   [email-reader ⏻] [calendar ⏻] [+ Add Skill]      │ │
│  │                                                      │ │
│  │   DELIVERY                                           │ │
│  │   [● Local] [○ Telegram] [○ Discord] [○ Slack] ...  │ │
│  │                                                      │ │
│  │   NAME                                               │ │
│  │   ┌────────────────────────────────────────────┐    │ │
│  │   │ Morning Briefing — Daily at 09:00          │    │ │
│  │   └────────────────────────────────────────────┘    │ │
│  │                                                      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

## Modified Header Bar

When in create/edit mode, the header bar changes:

### Left Zone
- **Back button**: ChevronLeft icon (16px) + "Back" text — 14px, weight 500, `var(--text-secondary)`
  - Hover: `var(--text-primary)`, `var(--bg-tertiary)` background
  - Click: returns to Schedules page (with confirmation if form has changes)
- **Title**: "New Schedule" (create) or "Edit Schedule" (edit) — 16px, weight 700, `var(--text-primary)`
  - Separated from back button by 12px

### Center Zone
- **Empty** (view toggle is hidden)

### Right Zone
- **"Cancel" button**: `btn btn-ghost` — standard ghost styling
- **"Save" button**: `btn btn-primary`
  - Create mode text: "Create Schedule"
  - Edit mode text: "Save Changes"
  - Disabled until required fields are filled (agent + valid time)
  - Shows spinner (loading-spinner, 14px) when saving

## Form Container

- **Max-width**: 640px
- **Margin**: 0 auto (horizontally centered)
- **Padding**: 32px 24px
- **Overflow-y**: auto (scrolls if content taller than viewport)
- **Sections separated by**: 28px gap

## Section 1: Agent Selection

### Label
- **Text**: "AGENT"
- **Style**: 11px, weight 600, uppercase, `var(--text-muted)`, letter-spacing 0.8px
- **Margin-bottom**: 8px

### Searchable Dropdown
- **Default state**: `.input` styling, displaying selected agent name or placeholder
- **Placeholder**: "Select an agent..." — `var(--text-muted)`
- **Height**: 44px
- **Icon**: ChevronDown from lucide, 14px, `var(--text-muted)`, right side

### Dropdown Open State
- **Trigger**: click on the input
- **Container**: positioned below input, full width, max-height 240px, overflow-y auto
  - Background: `var(--bg-primary)`
  - Border: 1px solid `var(--border-bright)`
  - Border-radius: `var(--radius-md)`
  - Box-shadow: `0 8px 24px rgba(0, 0, 0, 0.12)` (dark) / `0 8px 24px rgba(0, 0, 0, 0.06)` (light)
  - Z-index: 20

### Search Input (inside dropdown)
- **Sticky at top** of the dropdown
- **Padding**: 10px 12px
- **Border-bottom**: 1px solid `var(--border)`
- **Icon**: Search from lucide, 14px, `var(--text-muted)`, left
- **Input**: 13px, no border, transparent background
- **Placeholder**: "Search agents..."

### Agent Option
- **Height**: 48px
- **Padding**: 8px 12px
- **Layout**: flex row, gap 10px, align-items center
- **Hover**: `var(--bg-secondary)` background
- **Selected**: `var(--accent-subtle)` background, checkmark icon on right

#### Agent Avatar
- **Size**: 32px circle
- **Background**: `var(--bg-tertiary)`
- **Content**: first letter of agent name, 14px, weight 600, `var(--text-primary)`, centered
- **Border-radius**: 50%

#### Agent Info
- **Name**: 13px, weight 600, `var(--text-primary)`
- **Description**: 11px, weight 400, `var(--text-muted)`, single line, ellipsis

### Edit Mode Pre-Fill
- Shows the current agent, selected state
- Agent can be changed (dropdown still functional)

## Section 2: Schedule Type

### Label
- **Text**: "SCHEDULE"
- **Same label style as above**
- **Margin-bottom**: 8px

### Type Pills
Reuses the existing `.schedules-freq-pills` pattern but with updated options.

- **Container**: flex row, `var(--bg-tertiary)` background, `var(--radius-sm)` corners, 2px padding
- **Pills**: equal flex, 36px height, 13px font, weight 600

| Pill     | Label    | When selected, shows...                     |
|----------|----------|---------------------------------------------|
| once     | Once     | Date picker + clock face                    |
| daily    | Daily    | Clock face only                             |
| weekly   | Weekly   | Day-of-week selector + clock face           |
| monthly  | Monthly  | Day-of-month grid + clock face              |
| custom   | Custom   | Cron expression input + human preview        |

- **Active pill**: `var(--bg-elevated)` background, `var(--text-primary)` text
- **Inactive**: transparent, `var(--text-secondary)` text
- **Hover (inactive)**: `var(--text-primary)` text
- **Transition**: 150ms

## Section 3: Time Configuration

This section changes layout based on the selected schedule type.

### Layout (for types with clock face + secondary picker)
- **Display**: flex row, gap 32px, flex-wrap wrap
- **Clock face**: left side, 220px wide
- **Secondary picker** (day-of-week, date, day-of-month): right side, flex 1, min-width 200px

### Clock Face (Android Material Design style)

Two-stage picker: user selects hours first, then minutes.

#### Container
- **Size**: 220px x 220px
- **Background**: `var(--bg-secondary)`
- **Border**: 1px solid `var(--border)`
- **Border-radius**: 50%
- **Position**: relative

#### Stage Indicator
Above the clock, showing current selection:
- **Layout**: flex row, centered, gap 4px
- **Hours display**: 28px font, weight 700
  - Active stage: `var(--text-primary)`
  - Inactive stage: `var(--text-muted)`, cursor pointer, click switches to hours stage
- **Colon separator**: 28px font, weight 700, `var(--text-muted)`
- **Minutes display**: same as hours display but for minutes
- **Margin-bottom**: 16px

#### Number Ring
- **Numbers positioned in circle**: 12 positions, evenly spaced
- **Each number**:
  - Font: 14px, weight 500, `var(--text-primary)`
  - Hit area: 36px circle, transparent background
  - Positioned at radius 80px from center

#### Selected Number
- **Background**: `var(--accent)` circle, 36px diameter
- **Text**: white, weight 700
- **Transition**: background 150ms

#### Clock Hand
- **Line from center to selected number**
  - Width: 2px
  - Color: `var(--accent)`
  - Transition: transform 150ms (rotates to point at selected number)
- **Center dot**: 6px circle, `var(--accent)`, solid

#### Inner Ring (24h mode only)
For hours 13–00, positioned at radius 52px from center:
- Numbers: 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 00
- Font: 12px, weight 500, `var(--text-muted)`
- Selected: same accent treatment as outer ring

#### AM/PM Toggle (12h mode only)
- **Position**: below the clock face, centered
- **Layout**: two buttons side by side
  - Each: 40px wide, 28px tall, 12px font, weight 600
  - Active: `var(--accent)` background, white text
  - Inactive: `var(--bg-tertiary)` background, `var(--text-secondary)` text
  - Border-radius: left button has left corners rounded, right has right corners
- **Margin-top**: 12px

#### Interaction
- **Click**: select a number. If in hours stage, auto-advance to minutes stage after 200ms delay.
- **Drag**: finger/mouse drag around the ring to select. Visual hand follows the drag.

### Day-of-Week Selector (Weekly type)

- **Layout**: flex row, gap 6px
- **7 circular buttons**: one per day

#### Day Button
- **Size**: 36px circle
- **Font**: 12px, weight 600
- **Labels**: "M", "T", "W", "T", "F", "S", "S"
- **Unselected**: `var(--bg-tertiary)` background, `var(--text-secondary)` text, 1px `var(--border)` border
- **Selected**: `var(--accent)` background, white text, no border
- **Hover (unselected)**: `var(--border-bright)` border, `var(--text-primary)` text
- **Transition**: 150ms
- **Multi-select**: clicking toggles individual days on/off

#### Quick-Select Links
Below the day buttons:
- **Layout**: flex row, gap 12px
- **"Weekdays"**: 11px, weight 500, `var(--accent-text)`, cursor pointer
  - Click: selects Mon–Fri, deselects Sat–Sun
  - Underline on hover
- **"Weekends"**: same styling
  - Click: selects Sat–Sun, deselects Mon–Fri
- **"Every day"**: same styling
  - Click: selects all 7 days
  - Note: if all 7 are selected, the schedule is effectively "daily" — show a subtle hint: "Tip: use Daily type instead" in 10px, `var(--text-muted)`, italic

### Date Picker (Once type)

For one-shot schedules, a mini calendar lets the user pick the target date.

- **Size**: fills the right side of the time configuration area
- **Style**: mini version of the month calendar (same grid, smaller cells)
- **Cell size**: 32px x 32px
- **Font**: 12px
- **Navigation**: < Month > arrows at top
- **Today**: accent circle on date number
- **Selected date**: `var(--accent)` fill on cell, white text
- **Past dates**: disabled (dimmed, not clickable)
- **Hover**: `var(--bg-tertiary)` background

### Day-of-Month Grid (Monthly type)

A grid of numbers 1–31 for selecting which day of the month.

- **Grid**: `grid-template-columns: repeat(7, 1fr)`, gap 4px
- **Each cell**: 32px x 32px, centered number
  - Font: 12px, weight 500, `var(--text-primary)`
  - Border-radius: `var(--radius-sm)`
  - Hover: `var(--bg-tertiary)` background
  - Selected: `var(--accent)` background, white text
- **Single select**: only one day can be chosen
- **Days 29, 30, 31**: shown but with a subtle note below the grid
  - Text: "Months without day 31 will use the last day" — 10px, `var(--text-muted)`, italic

### Custom Cron Input

For advanced users who want raw cron expressions.

- **Input**: `.input` styling, full width
  - Placeholder: "0 9 * * 1-5"
  - Font: `var(--font-mono)`, 14px
- **Preview below input**: human-readable interpretation
  - Text: "Runs at 09:00 on weekdays" — 12px, `var(--text-secondary)`
  - Icon: Info from lucide, 12px, `var(--text-muted)`, left of text
  - If invalid expression: "Invalid cron expression" in `var(--error)`, 12px

## Section 4: Prompt

### Label
- **Text**: "PROMPT"
- **Standard label style**
- **Margin-bottom**: 8px

### Textarea
- **Class**: `.input` + `.schedules-textarea`
- **Min-height**: 80px (4 lines)
- **Max-height**: 200px
- **Resize**: vertical
- **Font**: 13px, `var(--text-primary)`, line-height 1.6
- **Placeholder**: "What should this agent do?" — `var(--text-muted)`
- **Pre-fill (edit mode)**: existing schedule's prompt
- **Pre-fill (create mode)**: agent's default prompt if available, otherwise empty

### Hint
- **Text**: "Leave empty to use the agent's default prompt"
- **Style**: 11px, `var(--text-muted)`, margin-top 4px
- **Only shown**: when textarea is empty and agent has a default prompt

## Section 5: Skills

### Label
- **Text**: "SKILLS"
- **Standard label style**
- **Margin-bottom**: 8px

### Skills List
- **Layout**: flex column, gap 6px

#### Skill Row
- **Height**: 36px
- **Layout**: flex row, `align-items: center`, `justify-content: space-between`
- **Padding**: 0 8px
- **Background**: transparent
- **Border-bottom**: 1px solid `var(--border)` (except last)

##### Skill Name
- **Font**: 13px, weight 500, `var(--text-primary)`

##### Skill Source Tag
- **Next to name**: "(default)" or "(added)" — 11px, `var(--text-muted)`, italic

##### Toggle Switch
- **Same spec as card toggle**: 34px x 18px
- **Default skills**: on by default
- **Added skills**: on by default (user explicitly added them)

#### Add Skill Button
- **Below skill list**
- **Style**: btn-ghost
- **Icon**: Plus from lucide, 12px
- **Text**: "Add Skill" — 12px, weight 500
- **Click**: opens a dropdown of available skills not already in the list
  - Same dropdown styling as agent picker but simpler (no avatar, just name + description)

## Section 6: Delivery

### Label
- **Text**: "DELIVER TO"
- **Standard label style**
- **Margin-bottom**: 8px

### Delivery Grid
- **Layout**: flex row, flex-wrap, gap 6px

#### Delivery Chip
- **Height**: 32px
- **Padding**: 0 12px
- **Border-radius**: 16px (fully rounded)
- **Font**: 12px, weight 500
- **Layout**: flex row, gap 6px, align-items center

##### Unselected
- Background: `var(--bg-tertiary)`
- Border: 1px solid `var(--border)`
- Text: `var(--text-secondary)`
- Icon: platform icon, 14px, `var(--text-muted)`

##### Selected
- Background: `var(--accent-subtle)`
- Border: 1px solid `var(--accent)` at 40% opacity
- Text: `var(--accent-text)`
- Icon: platform icon, 14px, `var(--accent-text)`

##### Hover (unselected)
- Border: `var(--border-bright)`
- Text: `var(--text-primary)`

#### Available Targets
In order of display:
1. **Local** — Monitor icon
2. **Telegram** — MessageCircle icon (or platform-specific if available)
3. **Discord** — Hash icon
4. **Slack** — Hash icon
5. **WhatsApp** — Phone icon
6. **Signal** — Shield icon
7. **Matrix** — Grid icon
8. **Email** — Mail icon
9. **SMS** — Smartphone icon
10. **Webhook** — Globe icon

- **"Local" is selected by default**
- **Multiple selections allowed**

## Section 7: Name

### Label
- **Text**: "NAME"
- **Standard label style**
- **Margin-bottom**: 8px

### Input
- **Class**: `.input`
- **Height**: 44px
- **Font**: 14px, weight 500, `var(--text-primary)`
- **Auto-generated value**: "[Agent Name] — [Schedule Description]"
  - Example: "Morning Briefing — Daily at 09:00"
  - Example: "Invoice Agent — Monthly on the 1st at 14:30"
  - Example: "Tax Reminder — May 30, 2026 at 10:00"
- **Editable**: user can clear and type a custom name
- **Updates automatically** when agent or schedule changes (unless user has manually edited it)

### Logic for Auto-Name
- Track whether user has manually edited the name field (boolean `nameManuallyEdited`)
- If not manually edited: regenerate on agent/schedule change
- If manually edited: never overwrite
- Clearing the field and leaving it empty: resets to auto-generate mode

## Validation

### Required Fields
- **Agent**: must be selected
- **Time**: must be configured (at least one day selected for weekly, valid date for once)

### Validation Display
- Fields with errors get `var(--error)` border (replacing normal border)
- Error message below field: 11px, `var(--error)`, margin-top 4px
- Save button disabled until all required fields pass

### Specific Validations
- **Weekly with no days selected**: "Select at least one day"
- **Once with past date/time**: "Scheduled time must be in the future"
- **Custom cron with invalid expression**: "Invalid cron expression"
- **No agent selected**: "Select an agent"

## Unsaved Changes Warning

If the user clicks "Back" or "Cancel" with unsaved changes:

- **Overlay**: standard `.skills-detail-overlay`
- **Modal**: 320px max-width, centered
  - Title: "Discard changes?" — 15px, weight 700, `var(--text-primary)`
  - Text: "Your schedule hasn't been saved." — 13px, `var(--text-secondary)`
  - Buttons: "Keep Editing" (btn-secondary) and "Discard" (btn-danger)
- **Escape key**: closes modal (keeps editing)
