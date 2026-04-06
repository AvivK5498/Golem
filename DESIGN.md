# Design Specification

The source of truth for all UI decisions. Every page, component, and interaction in the web dashboard must conform to this document.

**Last updated**: 2026-04-04

---

## 1. Product Context

### What is this?

A web dashboard for a self-hosted personal AI agent platform. Users create AI agents, connect them to Telegram, configure skills and schedules, and monitor activity. The platform runs as a daemon on the user's machine; the dashboard is the control surface.

### Target user

Semi-technical operators. They can follow setup instructions and edit config files when needed, but day-to-day operations should happen through the UI. They understand concepts like "cron jobs" and "API keys" but shouldn't need to touch YAML to change a model or create a scheduled task.

### Usage patterns

| Pattern | Frequency | Duration | Intent |
|---------|-----------|----------|--------|
| **Glance** | Daily | <1 min | "Is everything running? Any errors?" |
| **Inspect** | Daily | 1-5 min | Review activity, check what agents said |
| **Configure** | Weekly | 5-15 min | Create agent, set up crons, change models |
| **Debug** | As needed | 5-30 min | Investigate errors, read logs, trace prompts |

### Constraints

| Constraint | Decision |
|-----------|----------|
| Device | Desktop only. Minimum 1024px width. No responsive breakpoints. |
| Browsers | Modern only — Chrome, Firefox, Safari, Edge (last 2 versions) |
| Theming | One fixed design. No user customization. |
| Accessibility | Best effort (semantic HTML, adequate contrast). No formal WCAG audit. |
| Fonts | Inter + JetBrains Mono via next/font. No external CDN. |
| Framework | Next.js 16 (App Router) + shadcn/ui + Tailwind CSS v4 |
| Performance | Target <2s initial page load |

---

## 2. Information Architecture

### Navigation

Collapsible sidebar, 6 items. 220px expanded, icon-only when collapsed.

```
Home         (/)              — Metrics dashboard, agent status, at-a-glance health
Agents       (/agents)        — Agent registry, creation wizard, detail/editor
Crons        (/crons)         — Scheduled tasks management
Feed         (/feed)          — Activity stream / audit log
Skills       (/skills)        — Browse installed skills, check eligibility
Settings     (/settings)      — Global platform config + per-agent override visibility
```

### Removed pages

- **Jobs** — Job status surfaces inline in the Feed with status badges. Not a top-level concept for users.

### Page hierarchy

```
/                           Home (metrics dashboard)
/agents                     Agent list (cards grid)
/agents/new                 Creation wizard step 1: Config
/agents/new/persona         Creation wizard step 2: Persona generation
/agents/new/review          Creation wizard step 3: Review & confirm
/agents/[id]                Agent detail/editor (existing sidebar layout — keep)
/crons                      Cron list (table)
/crons/new                  Create cron
/crons/[id]                 Edit cron
/feed                       Activity feed (table with filters)
/skills                     Skills browser (card grid)
/settings                   Settings (global + per-agent tabs)
```

### Navigation rules

- **Active state**: The current page's nav item gets a highlighted background and bold text.
- **Visual hierarchy**: Home and Agents get primary visual weight. The rest is secondary.
- **Sidebar footer**: Theme toggle + restart button + health indicator (existing pattern — keep).
- **Sidebar header**: App icon + name (configurable once we pick a name).

---

## 3. Design Tokens

### Color System

Light-first design inspired by Mastra. One bold green accent used sparingly — "green is currency."

#### Light theme (default)

```css
/* Backgrounds — 3-layer depth system */
--bg-base:        #FAFAFA;     /* Page background */
--bg-raised:      #FFFFFF;     /* Cards, panels, sidebar */
--bg-inset:       #F4F4F5;     /* Inputs, code blocks, inset areas */
--bg-hover:       #F0F0F1;     /* Row/item hover state */

/* Brand accent — use for ONE primary action per viewport */
--accent:         #18FB6F;     /* Signature green (buttons, focus rings, active indicators) */
--accent-hover:   #10E85F;     /* Hover state */
--accent-muted:   #DCFCE7;     /* Green tint (background highlights, badges) */
--accent-text:    #02792F;     /* Green for text/links (AA contrast on white) */

/* Text — 3-level hierarchy */
--text-primary:   #141414;     /* Headings, important content, data values */
--text-secondary: #5F5F5F;     /* Body text, descriptions */
--text-tertiary:  #A1A1AA;     /* Metadata, timestamps, placeholders, disabled */

/* Semantic status */
--status-success:     #16A34A;
--status-success-bg:  #F0FDF4;
--status-warning:     #CA8A04;
--status-warning-bg:  #FEFCE8;
--status-error:       #DC2626;
--status-error-bg:    #FEF2F2;
--status-info:        #2563EB;
--status-info-bg:     #EFF6FF;

/* Borders & dividers */
--border:         #E4E4E7;     /* Default border */
--border-subtle:  #F4F4F5;     /* Very subtle dividers (table rows) */
--border-focus:   #18FB6F;     /* Focus ring color */

/* Shadows — minimal, used only for elevation */
--shadow-sm:   0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-md:   0 4px 12px rgba(0, 0, 0, 0.06);
--shadow-lg:   0 8px 30px rgba(0, 0, 0, 0.10);
```

#### Dark theme (secondary — available via toggle)

```css
--bg-base:        #111113;
--bg-raised:      #1A1A1C;
--bg-inset:       #0D0D0E;
--bg-hover:       #222224;

--accent:         #18FB6F;     /* Green pops even harder on dark */
--accent-hover:   #2CFF7E;
--accent-muted:   rgba(24, 251, 111, 0.1);
--accent-text:    #4ADE80;

--text-primary:   #F5F5F7;     /* Off-white (not pure #FFF — reduces halation) */
--text-secondary: rgba(245, 245, 247, 0.6);
--text-tertiary:  rgba(245, 245, 247, 0.3);

--status-success:     #4ADE80;
--status-success-bg:  rgba(74, 222, 128, 0.1);
--status-warning:     #FACC15;
--status-warning-bg:  rgba(250, 204, 21, 0.1);
--status-error:       #F87171;
--status-error-bg:    rgba(248, 113, 113, 0.1);
--status-info:        #60A5FA;
--status-info-bg:     rgba(96, 165, 250, 0.1);

--border:         rgba(255, 255, 255, 0.08);
--border-subtle:  rgba(255, 255, 255, 0.04);
--border-focus:   #18FB6F;

--shadow-sm:   0 1px 2px rgba(0, 0, 0, 0.2);
--shadow-md:   0 4px 12px rgba(0, 0, 0, 0.3);
--shadow-lg:   0 8px 30px rgba(0, 0, 0, 0.4);
```

### Typography

Two fonts. Six roles. No exceptions.

**Font families**:
- `--font-sans`: Inter (body, headings, UI)
- `--font-mono`: JetBrains Mono (data values, code, IDs, token counts)

**Type scale** (Major Third ratio, 14px base):

| Role | Size | Weight | Line Height | Letter Spacing | Use |
|------|------|--------|-------------|----------------|-----|
| **Display** | 28px / 1.75rem | 600 | 1.15 | -0.02em | Page titles: "Home", "Agents", "Feed" |
| **Title** | 20px / 1.25rem | 600 | 1.2 | -0.01em | Section headers, card titles, modal titles |
| **Body** | 14px / 0.875rem | 400 | 1.5 | 0 | Primary reading text, descriptions, form help |
| **Label** | 13px / 0.8125rem | 500 | 1.4 | 0.01em | Table headers, form labels, nav items, badge text |
| **Caption** | 12px / 0.75rem | 400 | 1.4 | 0.01em | Timestamps, metadata, secondary info |
| **Mono** | 13px / 0.8125rem | 400 | 1.5 | 0 | Data values, agent IDs, cron expressions, token counts |

**Rules**:
- Headings use `--text-primary`. Body uses `--text-secondary`. Metadata uses `--text-tertiary`.
- All numeric data in tables uses `font-variant-numeric: tabular-nums` for alignment.
- Monospace for any value a user might copy (IDs, expressions, model names).

### Spacing Scale

Strict 4px base. Every margin, padding, and gap uses one of these values.

```css
--space-0:    0px;
--space-1:    4px;      /* Icon padding, tight inline gaps */
--space-2:    8px;      /* Between related items, badge padding */
--space-3:    12px;     /* Default component internal padding */
--space-4:    16px;     /* Card padding, form field gaps */
--space-6:    24px;     /* Between sections within a page */
--space-8:    32px;     /* Between major page sections */
--space-12:   48px;     /* Page top/bottom padding */
--space-16:   64px;     /* Hero areas (unused in dashboard context) */
```

**Rules**:
- Prefer spacing over borders to separate content sections.
- Cards use `--space-4` (16px) internal padding consistently.
- Table rows use `--space-3` (12px) vertical padding.
- Page content area has `--space-6` (24px) horizontal padding and `--space-8` (32px) top padding.

### Border Radius

```css
--radius-sm:   4px;     /* Badges, small elements */
--radius-md:   6px;     /* Buttons, inputs */
--radius-lg:   8px;     /* Cards, panels, table containers */
--radius-xl:   12px;    /* Modals, large overlays */
--radius-full: 9999px;  /* Pills, avatars, status dots */
```

---

## 4. Component Patterns

### Cards

```
Background:    --bg-raised
Border:        1px solid --border
Border radius: --radius-lg (8px)
Padding:       --space-4 (16px)
Shadow:        --shadow-sm
Hover:         --shadow-md (only if clickable)
```

### Buttons

| Variant | Background | Text | Border | Use |
|---------|-----------|------|--------|-----|
| **Primary** | --accent | #000 (black) | none | ONE per viewport. Create, Save, Confirm. |
| **Secondary** | --bg-raised | --text-primary | 1px --border | Secondary actions. Cancel, Back. |
| **Ghost** | transparent | --text-secondary | none | Tertiary actions. Filter toggles, icon buttons. |
| **Destructive** | transparent | --status-error | 1px --status-error | Delete, Disable. Goes solid red on confirm. |

All buttons: `--radius-md` (6px), 14px text, 500 weight, `--space-2` horizontal padding, 36px min height.

### Inputs

```
Background:    --bg-inset
Border:        1px solid --border
Border radius: --radius-md (6px)
Height:        36px
Font:          14px / Body
Focus:         2px ring --border-focus (green)
Placeholder:   --text-tertiary
```

### Tables

```
Container:     --bg-raised, --radius-lg, 1px --border
Header row:    --bg-inset background, Label typography, --text-tertiary
Body rows:     --space-3 vertical padding, bottom border --border-subtle
Hover:         --bg-hover background
Selected:      --accent-muted background
```

- No outer shadow on tables.
- Header text is uppercase Label style with tertiary color.
- Numeric columns right-aligned with tabular-nums.
- Action columns (edit, delete) right-aligned, icon buttons only (no text).

### Status Badges

| Status | Background | Text | Dot |
|--------|-----------|------|-----|
| **Delivered / Running / Active** | --status-success-bg | --status-success | Green dot |
| **Suppressed / Paused** | --bg-inset | --text-tertiary | Gray dot |
| **Error / Failed** | --status-error-bg | --status-error | Red dot |
| **Queued / Pending** | --status-info-bg | --status-info | Blue dot |

All badges: `--radius-full` (pill), Caption typography, `--space-1` vertical + `--space-2` horizontal padding. Include a 6px colored dot before the text.

### Empty States

Every page/table must have an empty state. Structure:

```
[Icon — 48px, --text-tertiary]
[Title — Title typography, --text-primary]
[Description — Body typography, --text-secondary, max 320px width, centered]
[CTA Button — Primary, if applicable]
```

Example: Agents page with zero agents:
- Icon: Bot
- Title: "No agents yet"
- Description: "Create your first AI agent with a custom persona, tools, and Telegram connection."
- CTA: "Create agent"

### Loading States

Skeleton screens, not spinners. Match the layout shape of the content being loaded:
- Table: Skeleton rows with gray bars matching column widths
- Cards: Skeleton cards with placeholder blocks for title/description
- Metrics: Skeleton with number placeholder (wider bar) and label placeholder (narrower bar)

Duration: Show skeleton for minimum 200ms (prevent flash). Animate with a subtle pulse (opacity 0.4 → 0.7).

### Toasts

Using sonner (already installed).
- Position: bottom-right
- Auto-dismiss: 4 seconds
- Success: green left border
- Error: red left border, 8 second dismiss
- No more than 3 visible at once

### Modals

```
Overlay:       rgba(0, 0, 0, 0.4)
Background:    --bg-raised
Border radius: --radius-xl (12px)
Shadow:        --shadow-lg
Width:         480px (small), 640px (medium)
Padding:       --space-6 (24px)
```

Reserve modals for destructive confirmations only (delete agent, bulk delete crons). Everything else uses inline interactions.

---

## 5. Page Specifications

### Home (`/`)

**Purpose**: Glanceable health dashboard. The first thing a user sees. Answers: "Is everything working? How active are my agents? What's the cost?"

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│  DISPLAY: Home                                       │
├─────────────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐               │
│  │Msgs  │ │Tokens│ │Errors│ │Agents│               │
│  │Today │ │Today │ │Today │ │Online│               │
│  │ 142  │ │ 48K  │ │  3   │ │ 4/4  │               │
│  └──────┘ └──────┘ └──────┘ └──────┘               │
├─────────────────────────────────────────────────────┤
│  TITLE: Agents                                       │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐       │
│  │ Agent Card │ │ Agent Card │ │ Agent Card │       │
│  │ Name       │ │ Name       │ │ Name       │       │
│  │ ● Online   │ │ ● Online   │ │ ○ Offline  │       │
│  │ Last: 2m   │ │ Last: 1h   │ │ Last: --   │       │
│  └────────────┘ └────────────┘ └────────────┘       │
├─────────────────────────────────────────────────────┤
│  TITLE: Recent Activity                              │
│  [Compact feed table — last 10 entries, all agents] │
│  [Link: "View all →" to /feed]                       │
└─────────────────────────────────────────────────────┘
```

**Metric cards**:
- 4 cards in a row (grid, equal width)
- Each shows: label (Caption), value (Display, mono), change indicator optional
- Data source: `GET /api/feed?agent_id=all&since={todayMidnight}`

**Agent cards**:
- Show all agents from `GET /api/platform/agents`
- Each card: name, description (1 line truncated), status dot (connected/disconnected), model name (mono), last activity time
- Click navigates to `/agents/[id]`

**Recent activity**:
- Compact table: Time, Agent, Source, Input (truncated), Status badge
- 10 rows, cross-agent (`agent_id=all`)
- "View all" link to `/feed`

**Polling**: Refresh metrics + activity every 30 seconds.

### Agents (`/agents`)

**Purpose**: View and manage the agent fleet.

**Layout**: Card grid (3 columns). Each card shows:
- Agent name (Title) + description (Body, 2 lines max)
- Status: connected/disconnected badge
- Model name (Mono, Caption size)
- Tool count + skill count (Caption)
- Cron count (Caption)
- Enabled/disabled toggle (top-right corner)

**Actions**:
- Click card → `/agents/[id]`
- "Create agent" primary button (top-right of page) → `/agents/new`

**Empty state**: "No agents yet" with create CTA.

### Agent Detail (`/agents/[id]`)

**Keep the existing sidebar editor layout.** It works. The current implementation uses a settings sidebar — no redesign needed, just apply the new design tokens.

**Addition**: Add a "Logs" tab that shows prompt traces filtered to this agent (from `/api/prompt-traces` filtered client-side or with a future `agent_id` param).

### Agent Creation Wizard (`/agents/new → persona → review`)

**This is the "red thread" — the signature interaction.**

3-step wizard with a progress bar at the top:

1. **Config** — Name, description, role, bot token, model selection
2. **Persona** — LLM generates persona + memory template. Show a "generating..." animation (pulsing card), then reveal the generated text with an edit option.
3. **Review** — Summary of everything. Edit buttons to go back to any step. "Create agent" primary CTA.

**Design notes**:
- Center-aligned, max-width 640px content area (not full-width)
- Step indicator: 3 circles connected by lines. Active = green filled. Complete = green check. Upcoming = gray outline.
- The persona generation step should feel like something is being *crafted*, not just loaded. Use a writing animation (text appearing line by line) when the persona streams in.

### Crons (`/crons`)

**Purpose**: Manage scheduled tasks.

**Layout**: Table with columns:
- Name (linked to edit page)
- Agent (badge)
- Schedule (Mono — cron expression + human-readable next run)
- Last run (Caption, relative time)
- Status badge (active/paused/one-shot)
- Actions (pause/resume toggle, edit, delete)

**Create cron**: "New cron" button → `/crons/new` (form page, not modal).

### Feed (`/feed`)

**Purpose**: Activity audit log. The reference page for "what happened."

**Layout**: Full-width table with filters above.

**Filters** (horizontal bar above table):
- Agent selector dropdown (default: "All agents")
- Status filter: All | Delivered | Suppressed | Error (toggle buttons)
- Source filter: All | Direct | Cron | Heartbeat | Webhook (toggle buttons)
- Search input (free text — filters client-side on input/output text)

**Table columns**:
- Time (Caption, relative — "2m ago", "1h ago", full timestamp on hover tooltip)
- Agent (badge with agent color)
- Source (icon + label — message bubble for direct, clock for cron, heart for heartbeat)
- Input (truncated, 1 line — expandable)
- Output (truncated, 1 line — expandable)
- Status (badge)
- Tokens (Mono — in/out, Caption size)
- Latency (Mono, Caption size)

**Row expansion**: Click a row to expand in-place and show full input + output text. No side panel (simpler).

**Polling**: Refresh every 30 seconds. Show a subtle "New activity" indicator at the top of the table if new entries arrive while user is scrolled down.

### Skills (`/skills`)

**Purpose**: Browse installed skills, see what's available, check eligibility.

**Layout**: Card grid (3 columns).

Each skill card:
- Name (Title)
- Description (Body, 3 lines max)
- Eligible badge: green "Ready" or amber "Missing requirements"
- If ineligible: list missing env vars / binaries in Caption
- "Used by" — list of agent names using this skill (Caption)

**No create/install in v1** — skills are file-based. Just browsing.

### Settings (`/settings`)

**Purpose**: Platform-wide configuration.

**Layout**: Tabbed interface.

**Tabs**:
1. **Global** — LLM tiers, default agent, observability, whisper, webhooks, server port
2. **Per-agent overrides** — Dropdown to select agent, then show settings that differ from global defaults (highlighted)

**Form pattern**: Section groups with Title headers. Each setting is a labeled row:
```
[Label]                    [Input/Select/Toggle]
[Help text in Caption]
```

Save button at bottom of each section (not auto-save — explicit confirmation).

---

## 6. Interaction Patterns

### Loading

| Context | Pattern |
|---------|---------|
| Page load | Skeleton screen matching layout shape |
| Table refresh | Keep current data visible, replace on arrival (no flash) |
| Form submit | Button shows spinner + "Saving..." text, disabled |
| Persona generation | Streaming text animation (line by line reveal) |

### Destructive actions

| Action | Pattern |
|--------|---------|
| Delete cron | Inline: button text changes "Delete" → "Confirm?" (red), auto-revert after 3s |
| Disable agent | Toggle with instant visual feedback, toast confirmation |
| Delete agent | Modal confirmation with agent name typed to confirm |

### Feedback

| Event | Pattern |
|-------|---------|
| Successful save | Toast: "Settings saved" (success, 4s) |
| Error | Toast: error message (error, 8s, with retry action if applicable) |
| Agent created | Toast: "Agent created" + redirect to agent detail |
| Cron created | Toast: "Cron created" + redirect to crons list |

### Data freshness

- Home page: polls every 30 seconds
- Feed page: polls every 30 seconds
- Agent/Cron detail pages: fetch once on mount, no polling
- Settings: fetch once on mount, no polling
- Show "Last updated: Xs ago" in page footer when polling is active

---

## 7. Design Principles

1. **Glanceable first** — The Home page must communicate system health in under 10 seconds. No reading required — status is conveyed through color and numbers.

2. **Green is currency** — The accent color (`--accent`) marks ONE primary action per viewport. If everything is green, nothing stands out. Spend it on: primary CTAs, active nav items, focus rings, success states.

3. **Spacing over borders** — Separate content with whitespace, not divider lines. Use `--border-subtle` only for table rows. Use spacing jumps (16px → 32px) to signal section breaks.

4. **Progressive disclosure** — Show essentials upfront. Expandable rows in tables. "Advanced" sections collapsed by default in Settings. The Feed shows truncated text; click to expand.

5. **Consistency is non-negotiable** — Same badge colors everywhere. Same card padding everywhere. Same button sizes everywhere. If you introduce a new pattern, it must be documented here first.

6. **Empty states are first impressions** — Every page must have a designed empty state. A new user with zero agents, zero crons, zero feed entries should feel guided, not lost.

7. **Data in mono** — Model names, cron expressions, agent IDs, token counts, latency numbers — anything a user might copy or compare gets `--font-mono`.

---

## 8. Backend API Surface

The UI consumes these endpoints. All served from the platform's HTTP server (default port 3847).

### Home page data

```
GET /api/platform/agents               → agent list with status
GET /api/feed?agent_id=all&since=X     → activity counts + token summary
GET /api/health                        → uptime, memory
```

### Agents

```
GET    /api/platform/agents            → list
POST   /api/platform/agents            → create
GET    /api/platform/agents/:id        → detail (config + persona + sub-agents)
PUT    /api/platform/agents/:id        → update config
PATCH  /api/platform/agents/:id/status → enable/disable
PUT    /api/platform/agents/:id/persona           → update persona
PUT    /api/platform/agents/:id/memory-template    → update memory template
PUT    /api/platform/agents/:id/sub-agents         → update sub-agents
GET    /api/platform/agents/:id/settings           → per-agent settings
PATCH  /api/platform/agents/:id/settings           → update settings
POST   /api/platform/agents/generate-persona       → LLM persona generation
```

### Crons

```
GET    /api/crons                      → list (optional ?agent_id=)
POST   /api/crons                      → create
GET    /api/crons/:id                  → detail
PUT    /api/crons/:id                  → update
DELETE /api/crons/:id                  → delete
```

### Feed

```
GET /api/feed?agent_id=all&status=X&since=X&limit=N
    → entries[], counts{}, tokens{totalIn, totalOut, count}
```

### Skills

```
GET /api/available-skills
    → skills[]{name, description, eligible, requires{env[], bins[]}, usedBy[]}
```

### Settings

```
GET   /api/settings                    → global settings
PATCH /api/settings                    → update global
GET   /api/platform/agents/:id/settings   → per-agent
PATCH /api/platform/agents/:id/settings   → update per-agent
```

### Supporting

```
GET /api/health                        → uptime, memory
GET /api/models                        → available LLM models
GET /api/available-tools               → tool name list
GET /api/prompt-traces                 → LLM traces for debugging
GET /api/logs                          → log browser endpoints
POST /api/restart                      → restart daemon
```
