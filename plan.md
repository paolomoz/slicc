# Sprinkles: Batch Action System for Scoops

## Overview

Sprinkles are per-scoop UI controls that let users accumulate actions into a batch, then send them all as a single lick. Instead of each button firing an immediate lick (causing LLM queue overload), buttons add actions to a client-side list. A "Do it" button sends the full batch as one lick prompt.

Think of it like a shopping cart: click actions to add them, review the list, hit "Do it" to send everything at once.

## Sprinkle Definition Format

Sprinkles are defined in `SPRINKLE.md` files (alongside `SKILL.md` in skill directories) with YAML frontmatter:

```markdown
---
name: code-review
description: Code review actions
scoop: reviewer          # optional: auto-attach to scoops with this name
---

# Code Review

## Actions

- **fix-lint**: Fix all lint errors in the changed files
- **add-types**: Add TypeScript type annotations to untyped functions
- **add-tests**: Write unit tests for uncovered functions
- **refactor**: Refactor duplicated code into shared utilities
```

### Parsing rules:
- Each `- **<id>**: <description>` in an `## Actions` section becomes a button
- The `id` is the action key, the `description` becomes both the button label and the text sent in the batch prompt
- The markdown body (outside Actions) serves as context/instructions prepended to the batch prompt

### Built-in sprinkles
A few generic sprinkles ship as defaults in `src/defaults/workspace/skills/`:
- **quick-actions**: Generic primitives like "Summarize changes", "Explain this code", "Fix errors"

Per the "both" answer: built-in defaults live in `src/defaults/`, user-extensible via workspace `SPRINKLE.md` files.

## Types

New file: `src/scoops/sprinkles.ts`

```typescript
/** A single action button within a sprinkle */
export interface SprinkleAction {
  id: string;           // e.g. "fix-lint"
  label: string;        // e.g. "Fix all lint errors in the changed files"
}

/** A sprinkle definition (parsed from SPRINKLE.md) */
export interface Sprinkle {
  name: string;         // from frontmatter
  description: string;  // from frontmatter
  scoop?: string;       // optional scoop name to auto-attach
  context: string;      // markdown body (non-Actions content)
  actions: SprinkleAction[];
  path: string;         // VFS path to the SPRINKLE.md
}

/** A queued action in the client-side batch */
export interface QueuedAction {
  sprinkleName: string;
  actionId: string;
  label: string;
}
```

## Architecture

### Layer responsibilities

1. **Parsing** (`src/scoops/sprinkles.ts`):
   - `parseSprinkle(content, path)` — parse a single SPRINKLE.md into a `Sprinkle`
   - `loadSprinkles(fs, scoopName?)` — scan `/workspace/skills/` for SPRINKLE.md files, filter by scoop affinity
   - Built-in sprinkles loaded via `import.meta.glob` (same pattern as skills)

2. **State** (client-side, in the UI layer):
   - `SprinkleBar` class holds the queued actions array
   - Actions are added/removed purely in-memory (no IndexedDB, no persistence needed)
   - "Do it" compiles the queue into a prompt string and dispatches as a lick

3. **UI** (`src/ui/sprinkle-bar.ts`):
   - Renders below the chat input area (or above it, TBD during implementation)
   - Shows available action buttons grouped by sprinkle name
   - Shows queued actions as a simple checklist with X to remove
   - "Do it" button appears when queue is non-empty
   - Disappears when viewing the cone (sprinkles are per-scoop only)

4. **Dispatch** (through existing lick routing):
   - "Do it" creates a `ChannelMessage` with channel `'sprinkle'`
   - Routes through `orchestrator.handleMessage()` — same path as webhook/cron licks
   - No new lick type needed in LickManager — this is purely client-initiated

### Prompt compilation

When the user clicks "Do it", the queued actions compile into a single prompt:

```
[Sprinkle: code-review]
Please perform the following actions:

1. Fix all lint errors in the changed files
2. Add TypeScript type annotations to untyped functions
3. Write unit tests for uncovered functions
```

The sprinkle's `context` markdown (body content outside the Actions section) is prepended as additional instructions if present.

## Implementation Steps

### Step 1: Sprinkle parser (`src/scoops/sprinkles.ts`)
- Types: `SprinkleAction`, `Sprinkle`, `QueuedAction`
- `parseSprinkle(content: string, path: string): Sprinkle | null`
- `loadSprinkles(fs: VirtualFS | RestrictedFS, scoopName?: string): Promise<Sprinkle[]>`
- Load built-in sprinkles from `import.meta.glob` (same as skills.ts pattern)
- Unit tests in `sprinkles.test.ts`

### Step 2: Default built-in sprinkle
- Create `src/defaults/workspace/skills/quick-actions/SPRINKLE.md` with generic actions
- Actions: "Summarize changes", "Explain the code", "Fix errors", "Add comments"

### Step 3: SprinkleBar UI (`src/ui/sprinkle-bar.ts`)
- `SprinkleBar` class:
  - `constructor(container: HTMLElement)`
  - `setSprinkles(sprinkles: Sprinkle[])` — render action buttons
  - `onDoIt(callback: (prompt: string) => void)` — register dispatch callback
  - `clear()` — reset queue
  - `hide() / show()` — toggle visibility
- Internal state: `queuedActions: QueuedAction[]`
- Renders:
  - Row of action buttons (grouped by sprinkle, each button = one action)
  - Below buttons: simple checklist of queued actions (appears when queue non-empty)
  - "Do it" button (appears when queue non-empty)
- Clicking an action button adds it to the queue (toggle: click again to remove)
- Clicking X next to a queued item removes it
- CSS: inline styles (matching existing codebase pattern — no external CSS files)

### Step 4: Wire into ChatPanel / main.ts
- ChatPanel gets a `SprinkleBar` instance rendered below the input area
- On scoop switch (`switchToContext`):
  - Load sprinkles for the new scoop via `loadSprinkles(fs, scoopName)`
  - Update the SprinkleBar with `setSprinkles()`
  - Hide for cone, show for scoops
- "Do it" callback:
  - Compiles queue into prompt string
  - Creates `ChannelMessage` with `channel: 'sprinkle'`
  - Sends via `orchestrator.handleMessage()`
  - Adds the message to chat panel as a user message (similar to `addLickMessage`)
  - Clears the sprinkle bar queue

### Step 5: Scoop-specific sprinkle loading
- When scoops are created/initialized, load their sprinkles based on:
  1. Global sprinkles (no `scoop` field in frontmatter)
  2. Scoop-specific sprinkles (where `scoop` matches the scoop name)
- Cache loaded sprinkles per scoop in the orchestrator or UI layer

## Files Changed/Created

| File | Action | Description |
|------|--------|-------------|
| `src/scoops/sprinkles.ts` | **Create** | Parser, types, loader |
| `src/scoops/sprinkles.test.ts` | **Create** | Unit tests for parser/loader |
| `src/ui/sprinkle-bar.ts` | **Create** | UI component for action buttons + queue |
| `src/defaults/workspace/skills/quick-actions/SPRINKLE.md` | **Create** | Built-in generic actions |
| `src/ui/chat-panel.ts` | **Edit** | Mount SprinkleBar, wire dispatch |
| `src/ui/main.ts` | **Edit** | Load sprinkles on scoop switch, wire "Do it" to orchestrator |
| `src/ui/types.ts` | **Edit** | Add `'sprinkle'` to channel type if needed |
| `src/scoops/types.ts` | **Edit** | (Possibly) no changes — ChannelMessage.channel is already `string` |

## What this does NOT change

- LickManager — sprinkles don't go through webhooks/cron, they're client-initiated
- ScoopContext / Agent — receives the prompt as a normal message, no special handling
- Orchestrator core — uses existing `handleMessage()` path
- Skills system — sprinkles are parallel to skills, not a replacement

## Open questions for implementation

1. Should the sprinkle bar go above or below the chat input textarea?
2. Should action buttons show a count badge when the same action is queued multiple times, or disallow duplicates?
3. Should the "Do it" button be styled prominently (primary color) or subtly?
