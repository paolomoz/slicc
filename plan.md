# Sprinkles: Batched Action Builder for Scoops

## Summary

Sprinkles are UI-driven action builders attached to scoops. Instead of firing individual licks per button click, sprinkle buttons **accumulate actions client-side**, then an LLM summarizes them into a single natural language prompt sent as one lick to the scoop.

**Ice cream metaphor**: Sprinkles are the toppings you pick before the scoop is served. You choose what you want, then it all gets applied at once.

---

## Design Decisions (Confirmed)

| Decision | Choice |
|----------|--------|
| Definition format | SPRINKLE.md (JSON frontmatter + markdown body) — no YAML dependency |
| UI surface | Auto-select: inline (≤3 visible actions) or floating panel (4+) |
| Prompt generation | LLM summary: Haiku when Anthropic-compatible key available, otherwise scoop's own model |
| Scope | Scoop-specific |
| Storage | `/workspace/skills/{skill-name}/SPRINKLE.md` alongside SKILL.md |
| Conditional actions | V1 — actions can show/hide based on other action values |

---

## SPRINKLE.md Format

Uses **JSON frontmatter** (delimited by `---json` / `---`) to avoid a YAML dependency. The markdown body after the frontmatter is the summarizer prompt template.

````markdown
---json
{
  "name": "code-review",
  "description": "Review code changes with configurable focus",
  "actions": [
    {
      "id": "files",
      "type": "file-picker",
      "label": "Files to review",
      "multiple": true,
      "required": true
    },
    {
      "id": "focus",
      "type": "select",
      "label": "Review focus",
      "options": [
        { "label": "Security", "value": "security" },
        { "label": "Performance", "value": "performance" },
        { "label": "Readability", "value": "readability" },
        { "label": "All", "value": "all" }
      ],
      "default": "all"
    },
    {
      "id": "strict",
      "type": "toggle",
      "label": "Strict mode (fail on warnings)",
      "default": false
    },
    {
      "id": "branch",
      "type": "text",
      "label": "Target branch",
      "placeholder": "e.g. main",
      "showWhen": { "strict": true }
    },
    {
      "id": "notes",
      "type": "text",
      "label": "Additional notes",
      "placeholder": "Any specific concerns?"
    }
  ]
}
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
````

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

### Conditional Actions (`showWhen`)

Actions can declare a `showWhen` object that maps other action IDs to expected values. The action is only visible (and its value only included in the summary) when **all** conditions are met.

```json
{
  "id": "branch",
  "type": "text",
  "label": "Target branch",
  "showWhen": { "strict": true }
}
```

Rules:
- **Boolean match**: `{ "strict": true }` — show when `strict` toggle is on
- **String match**: `{ "focus": "security" }` — show when `focus` select equals "security"
- **Array includes**: `{ "focus": ["security", "performance"] }` — show when `focus` is one of the listed values
- **Multiple conditions**: All must match (AND logic). OR is achieved by defining separate actions.
- Hidden actions are excluded from the accumulated state and the summary text.
- The UI re-evaluates visibility on every action change.

---

## Architecture

### New Files

```
src/sprinkles/
  sprinkle-parser.ts      # Parse SPRINKLE.md (JSON frontmatter + markdown)
  sprinkle-manager.ts     # Load/manage sprinkle defs per scoop
  action-accumulator.ts   # Client-side state for accumulated actions
  sprinkle-summarizer.ts  # LLM summary (Haiku or scoop model fallback)
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

- Define `SprinkleDefinition`, `SprinkleAction`, `ActionValue`, `ShowWhenCondition` types
- Parse JSON frontmatter from SPRINKLE.md (delimited by `---json` / `---`, parsed with `JSON.parse` — no deps)
- Extract markdown body as the summarizer prompt template
- Validate action definitions (required fields, valid types, `showWhen` references valid action IDs)
- Tests: parser handles all action types, malformed JSON, missing fields, conditional action validation

### Step 2: Action Accumulator
**Files**: `src/sprinkles/action-accumulator.ts`

- `ActionAccumulator` class: stateful per-sprinkle action collector
- Methods: `set(actionId, value)`, `toggle(actionId)`, `reset()`, `getAll()`, `getVisible()`, `getSummaryText()`
- `getVisible()` evaluates `showWhen` conditions against current state, returns only visible actions and their values
- `getSummaryText()` generates a structured text representation of **visible** accumulated actions (for the LLM summarizer input)
- Validates values against action type constraints (e.g., select value must be in options)
- Hidden actions' values are retained in state (so toggling a condition back shows previous selections) but excluded from `getVisible()` and `getSummaryText()`
- Observable: emits change events for UI reactivity (including visibility changes)
- Tests: accumulate, reset, validation, serialization, conditional visibility

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
- **Model selection logic** (uses `getAccounts()` from `provider-settings.ts`):
  1. If an Anthropic-compatible account exists (provider `anthropic`, `amazon-bedrock`, `bedrock-camp`, or `azure-ai-foundry`), use Haiku via that account's credentials
  2. Otherwise, use the scoop's current model (via `resolveCurrentModel()`)
  3. This keeps summarization cheap/fast when possible, but always works regardless of provider
- Calls the selected model via pi-ai with the filled template as system prompt
- User message: "Generate the prompt."
- Returns the LLM's response as the final lick prompt string
- Fallback: if LLM call fails, send the raw `getSummaryText()` as the lick (degraded but functional)
- Tests: template filling, mock LLM call, fallback behavior, model selection logic

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
- **Visibility-aware layout**: counts only initially visible actions (those without `showWhen` or whose conditions are met at defaults) to decide inline vs panel. Re-evaluates if conditional actions push visible count past threshold.
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
3. **Undo/history**: Should accumulated actions persist across page reloads?
4. **Sprinkle chaining**: Can one sprinkle's "Do it" trigger another sprinkle's setup?
5. **OR logic for showWhen**: Currently AND-only. Should we support `showWhenAny` for OR conditions?

---

## Dependencies

- **No new dependencies** — JSON frontmatter parsed with built-in `JSON.parse`, no YAML library needed
- pi-ai: Already available for LLM summarizer (Haiku calls)
- provider-settings.ts: Already exports `getAccounts()` and `resolveCurrentModel()` for model selection
- No new server endpoints needed (browser-first)

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Summarizer adds latency (~1-2s) | Fallback to raw action text if LLM fails or times out |
| SPRINKLE.md format too rigid | Start minimal, extend action types incrementally |
| UI complexity in extension mode | Auto-select inline for extension, panel for standalone |
| Conditional actions create complex state | `showWhen` is AND-only, values retained when hidden, simple evaluation |
| Non-Anthropic providers can't use Haiku | Graceful fallback to scoop's own model |
