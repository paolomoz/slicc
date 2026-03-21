# Sprinkles: Batched Action Builder for Scoops

## Summary

Sprinkles are UI-driven action builders attached to scoops. Instead of firing individual licks per button click, sprinkle buttons **accumulate actions client-side**, then a dedicated fast model (Haiku) summarizes them into a single natural language prompt sent as one lick to the scoop.

**Ice cream metaphor**: Sprinkles are the toppings you pick before the scoop is served. You choose what you want, then it all gets applied at once.

---

## Design Decisions (Confirmed)

| Decision | Choice |
|----------|--------|
| Definition format | SPRINKLE.md (YAML frontmatter + markdown body) |
| UI surface | Auto-select: inline (≤3 actions) or floating panel (4+) |
| Prompt generation | Dedicated fast model (Haiku) for client-side LLM summary |
| Scope | Scoop-specific |
| Storage | `/workspace/skills/{skill-name}/SPRINKLE.md` alongside SKILL.md |

---

## SPRINKLE.md Format

```yaml
---
name: code-review
description: Review code changes with configurable focus
actions:
  - id: files
    type: file-picker
    label: "Files to review"
    multiple: true
    required: true

  - id: focus
    type: select
    label: "Review focus"
    options:
      - label: Security
        value: security
      - label: Performance
        value: performance
      - label: Readability
        value: readability
      - label: All
        value: all
    default: all

  - id: strict
    type: toggle
    label: "Strict mode (fail on warnings)"
    default: false

  - id: notes
    type: text
    label: "Additional notes"
    placeholder: "Any specific concerns?"
---

You are generating a prompt for a code review agent. The user has selected
the following actions:

{{actions_summary}}

Generate a clear, actionable prompt that tells the reviewer:
1. Which files to review
2. What aspects to focus on
3. Whether to use strict or lenient criteria
4. Any additional context from user notes

Keep the prompt concise and direct.
```

### Action Types

| Type | UI Widget | Value |
|------|-----------|-------|
| `button` | Click button (toggle on/off) | `boolean` |
| `toggle` | Switch/checkbox | `boolean` |
| `select` | Dropdown/radio group | `string` (selected value) |
| `multi-select` | Checkboxes | `string[]` (selected values) |
| `text` | Text input | `string` |
| `file-picker` | File browser integration | `string[]` (paths) |
| `number` | Number input with optional min/max/step | `number` |

---

## Architecture

### New Files

```
src/sprinkles/
  sprinkle-parser.ts      # Parse SPRINKLE.md (YAML frontmatter + markdown)
  sprinkle-manager.ts     # Load/manage sprinkle defs per scoop
  action-accumulator.ts   # Client-side state for accumulated actions
  sprinkle-summarizer.ts  # Fast model (Haiku) LLM call to generate prompt
  types.ts                # SprinkleDefinition, SprinkleAction, AccumulatedAction

src/ui/
  sprinkle-panel.ts       # Floating panel renderer
  sprinkle-inline.ts      # Inline (above chat input) renderer
  sprinkle-ui.ts          # Auto-selects panel vs inline, coordinates both
```

### Integration Points

```
SPRINKLE.md in /workspace/skills/{skill}/
  └─> SprinkleParser.parse()
    └─> SprinkleDefinition

ScoopContext creation (orchestrator.ts)
  └─> SprinkleManager.loadForScoop(scoopName)
    └─> Scans scoop's skills for SPRINKLE.md files
    └─> Returns SprinkleDefinition[]

UI scoop selection (main.ts / chat-panel.ts)
  └─> SprinkleUI.render(definitions)
    └─> Auto-selects inline vs panel
    └─> Renders action widgets
    └─> ActionAccumulator tracks user selections

User clicks "Do it"
  └─> ActionAccumulator.getAccumulated()
    └─> SprinkleSummarizer.summarize(definition, actions)
      └─> Calls Haiku with markdown body template + actions
      └─> Returns natural language prompt string
    └─> Dispatches as LickEvent to scoop (via existing lick pathway)
    └─> ActionAccumulator.reset()
```

---

## Implementation Steps

### Step 1: Core Types & Parser
**Files**: `src/sprinkles/types.ts`, `src/sprinkles/sprinkle-parser.ts`

- Define `SprinkleDefinition`, `SprinkleAction`, `ActionValue` types
- Parse YAML frontmatter from SPRINKLE.md (reuse or add `yaml` dep)
- Extract markdown body as the summarizer prompt template
- Validate action definitions (required fields, valid types)
- Tests: parser handles all action types, malformed YAML, missing fields

### Step 2: Action Accumulator
**Files**: `src/sprinkles/action-accumulator.ts`

- `ActionAccumulator` class: stateful per-sprinkle action collector
- Methods: `set(actionId, value)`, `toggle(actionId)`, `reset()`, `getAll()`, `getSummaryText()`
- `getSummaryText()` generates a structured text representation of accumulated actions (for the LLM summarizer input)
- Validates values against action type constraints (e.g., select value must be in options)
- Observable: emits change events for UI reactivity
- Tests: accumulate, reset, validation, serialization

### Step 3: Sprinkle Manager
**Files**: `src/sprinkles/sprinkle-manager.ts`

- `SprinkleManager` class: loads and caches sprinkle definitions per scoop
- Scans scoop's skill directories for SPRINKLE.md files
- Integrates with existing skills loading in `src/scoops/skills.ts`
- Method: `getForScoop(scoopName): SprinkleDefinition[]`
- Method: `reload(scoopName)` for hot-reload after skill install/uninstall
- Tests: loading, caching, multi-sprinkle per scoop

### Step 4: LLM Summarizer
**Files**: `src/sprinkles/sprinkle-summarizer.ts`

- `SprinkleSummarizer` class: generates natural language prompt from actions
- Takes `SprinkleDefinition` (contains markdown template) + accumulated actions
- Replaces `{{actions_summary}}` placeholder with `ActionAccumulator.getSummaryText()`
- Calls Haiku via pi-ai with the filled template as system prompt
- User message: "Generate the prompt."
- Returns the LLM's response as the final lick prompt string
- Fallback: if LLM call fails, send the raw `getSummaryText()` as the lick (degraded but functional)
- Config: model override in localStorage (`sprinkle-summarizer-model`)
- Tests: template filling, mock LLM call, fallback behavior

### Step 5: UI — Inline Renderer
**Files**: `src/ui/sprinkle-inline.ts`

- Renders when sprinkle has ≤3 actions
- Appears above chat input as a compact bar
- Action widgets: small buttons/toggles/dropdowns
- Shows accumulated action count badge
- "Do it" button (disabled until ≥1 required action filled)
- Integrates with ActionAccumulator for state

### Step 6: UI — Floating Panel
**Files**: `src/ui/sprinkle-panel.ts`

- Renders when sprinkle has 4+ actions
- Collapsible panel anchored to scoop's chat area
- Full-size widgets: file picker, text inputs, selects
- Shows accumulated actions as a live list/summary
- "Do it" button + "Clear" button
- Draggable/resizable (optional, can be deferred)

### Step 7: UI Coordinator
**Files**: `src/ui/sprinkle-ui.ts`

- `SprinkleUI` class: decides inline vs panel, manages lifecycle
- Listens for scoop selection changes → loads appropriate sprinkles
- Creates ActionAccumulator instances per sprinkle
- Coordinates "Do it" click → summarizer → lick dispatch
- Handles multiple sprinkles per scoop (tabs or accordion in panel)

### Step 8: Lick Integration
**Files**: Modify `src/scoops/lick-manager.ts`, `src/ui/main.ts`

- Add new lick type: `'sprinkle'` alongside `'webhook'` and `'cron'`
- `LickEvent` extended with `sprinkleId`, `sprinkleName` fields
- Route sprinkle licks through existing `routeLickToScoop()` pathway
- Chat rendering: sprinkle licks get a sprinkle icon (🍬) and show the generated prompt
- Persistence: same as other licks (IndexedDB via orchestrator DB)

### Step 9: Built-in Sprinkle Examples
**Files**: `src/defaults/workspace/skills/`

- Create 2-3 example SPRINKLE.md files for default skills
- Examples:
  - **Code Review sprinkle**: file picker + focus selector + strict toggle
  - **Refactor sprinkle**: file picker + pattern selector + scope toggle
  - **Deploy sprinkle**: environment select + dry-run toggle + notes text

### Step 10: Extension Compatibility
- Verify all components work in Chrome extension mode
- LLM summarizer: ensure API key access works in extension context
- File picker action type: integrate with VFS file browser
- No server dependencies (browser-first principle)

---

## Open Questions for Later

1. **Sprinkle versioning**: Should SPRINKLE.md support version fields for compatibility?
2. **Sprinkle marketplace**: Integration with `upskill` for installing sprinkles from ClawHub?
3. **Action dependencies**: Should actions conditionally show/hide based on other action values? (e.g., show "branch" field only when "deploy" toggle is on)
4. **Undo/history**: Should accumulated actions persist across page reloads?
5. **Sprinkle chaining**: Can one sprinkle's "Do it" trigger another sprinkle's setup?

---

## Dependencies

- YAML parser: Need `yaml` npm package (or lightweight alternative like `js-yaml`) for frontmatter parsing
- pi-ai: Already available for LLM summarizer (Haiku calls)
- No new server endpoints needed (browser-first)

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Haiku summarizer adds latency (~1-2s) | Fallback to raw action text if LLM fails or times out |
| SPRINKLE.md format too rigid | Start minimal, extend action types incrementally |
| UI complexity in extension mode | Auto-select inline for extension, panel for standalone |
| YAML parsing bundle size | Use lightweight parser or extract from existing deps |
