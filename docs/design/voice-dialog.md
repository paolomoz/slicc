# Voice Dialog Design

## Overview

A natural voice conversation mode for SLICC where the user speaks, the agent responds with synthesized speech, and the user can interrupt (barge-in) at any time. Separate from the existing voice-input-only toggle.

## Decisions

| Concern | Decision |
|---------|----------|
| TTS Provider | ElevenLabs (WebSocket streaming) |
| What gets spoken | Skill-driven conversational output + lightweight sanitizer |
| Interruption | Barge-in (user speech stops TTS immediately) |
| Echo handling | Web Audio API echo cancellation |
| Listen cycle | Starts immediately, overlaps with TTS |
| Activation | Separate "voice dialog" button, independent of voice-input toggle |
| API key storage | localStorage (consistent with LLM provider keys) |
| Agent voice behavior | SKILL.md file (skills-over-code principle) |
| Silence filling | Fast-inference LLM (Cerebras/Groq) for instant acknowledgment + progress narration |
| Filler-to-Claude handover | Single ElevenLabs WebSocket session, sentence-boundary cutover |

---

## Architecture

### New Modules

```
src/ui/voice-dialog/
  voice-dialog.ts        # VoiceDialog class — orchestrates the full loop
  voice-filler.ts        # Fast-inference LLM filler for zero-silence UX
  tts-provider.ts        # TTS provider interface + ElevenLabs implementation
  tts-sanitizer.ts       # Lightweight safety net: strips accidental markdown/code
  echo-canceller.ts      # Web Audio API echo cancellation pipeline
  audio-player.ts        # Streaming audio playback with barge-in support
```

### Component Relationships

```
┌────────────────────────────────────────────────────────────────────┐
│  VoiceDialog (orchestrator)                                        │
│                                                                    │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐        │
│  │ VoiceInput  │   │ AudioPlayer  │   │ TTSSanitizer     │        │
│  │ (existing)  │◄─►│  (new)       │   │ (~50 lines)      │        │
│  └──────┬──────┘   └──────┬───────┘   └────────┬─────────┘        │
│         │                 │                     │                  │
│         │          ┌──────┴───────┐             │                  │
│         │          │ EchoCanceller│             │                  │
│         └─────────►│  (new)       │             │                  │
│                    └──────┬───────┘             │                  │
│                           │                     │                  │
│  ┌──────────────┐  ┌──────┴───────┐             │                  │
│  │ VoiceFiller  │─►│ TTSProvider  │◄────────────┘                  │
│  │ (fast LLM)   │  │ (ElevenLabs) │                                │
│  └──────────────┘  └──────────────┘  ┌────────┐                   │
│         │                            │ SKILL  │                   │
│         │  Both filler + Claude      │ .md    │                   │
│         │  share one ElevenLabs WS   └────────┘                   │
│         │  session = seamless voice                                │
└────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Design

### 1. VoiceDialog (voice-dialog.ts)

The top-level state machine that orchestrates the full speak-listen-respond loop.

**States:**
```
IDLE → LISTENING → FILLING → SPEAKING → LISTENING
                      │ ↑        ↑          │
                      │ │        └──────────┘  (barge-in)
                      │ │        │
                      └─┘────────┘  (filler → Claude handover)

Barge-in works from ANY non-IDLE state:
  FILLING  + user speech → stop filler + TTS → LISTENING
  SPEAKING + user speech → stop Claude TTS   → LISTENING
```

- `IDLE`: Dialog mode off. No mic, no TTS.
- `LISTENING`: Mic open, STT active, waiting for user speech. May overlap with SPEAKING.
- `FILLING`: Filler LLM generating spoken acknowledgments/progress while Claude processes. TTS playing filler audio. Transitions to SPEAKING when Claude starts streaming text.
- `SPEAKING`: TTS playing Claude's response. Mic still open (echo-cancelled).

**Barge-in transition:** While in FILLING or SPEAKING state, if the echo canceller detects genuine user speech (not echo), immediately:
1. Stop TTS playback (`AudioPlayer.stop()`)
2. If FILLING: abort filler LLM inference (`VoiceFiller.stop()`)
3. Cancel any pending TTS chunks (`TTSProvider.abort()`)
4. Abort Claude's in-flight response if desired (optional — user can configure)
5. Transition to LISTENING (mic was already open)
6. Accumulate the new utterance normally

**Interface:**
```typescript
interface VoiceDialogConfig {
  ttsApiKey: string;
  ttsVoiceId: string;
  ttsModel?: string;              // default: 'eleven_turbo_v2_5'
  fillerApiKey: string;           // Cerebras/Groq API key
  fillerModel: string;            // fast model ID
  fillerBaseUrl: string;          // inference endpoint
  onStateChange: (state: VoiceDialogState) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onTTSText: (text: string) => void;  // text being spoken (filler or Claude)
  onError: (error: string) => void;
  lang?: string;                  // STT language, default 'en-US'
}

class VoiceDialog {
  start(): Promise<void>;
  stop(): void;
  isActive(): boolean;
  getState(): VoiceDialogState;

  // Called immediately when user message is sent — starts filler
  onUserMessage(message: string): void;

  // Feed tool events to filler for progressively smarter narration
  feedToolStart(toolName: string, args: Record<string, unknown>): void;
  feedToolResult(toolName: string, resultSummary: string): void;

  // Feed streaming tokens from Claude's text response — triggers handover from filler
  feedToken(token: string): void;

  // Signal that Claude's response is complete (flushes remaining audio)
  endResponse(): void;
}
```

**Lifecycle:**
1. User clicks dialog button → `start()` → init AudioContext, EchoCanceller, mic stream, STT
2. User speaks → existing VoiceInput transcription pipeline → auto-send at 2.5s silence
3. Message sent → `onUserMessage()` → filler LLM starts speaking immediately (~200ms)
4. Claude dispatches tools → `feedToolStart/Result()` → filler narrates progress
5. Claude starts streaming text → `feedToken()` → filler wraps up → Claude's voice takes over (same WS)
6. Claude tokens piped through TTSSanitizer → TTSProvider → AudioPlayer (speech continues seamlessly)
7. If user speaks during playback → EchoCanceller flags real speech → barge-in → TTS stops
8. Loop back to step 2

### 2. TTSProvider (tts-provider.ts)

Abstract interface + ElevenLabs implementation. Designed for future OpenAI/other providers.

**Interface:**
```typescript
interface TTSProvider {
  connect(): Promise<void>;
  disconnect(): void;
  synthesize(text: string): AsyncGenerator<ArrayBuffer>;  // streaming audio chunks
  abort(): void;  // cancel in-flight synthesis
}

interface TTSProviderConfig {
  apiKey: string;
  voiceId: string;
  model: string;
}
```

**ElevenLabs Implementation:**

Uses the ElevenLabs WebSocket streaming API (`wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`):

```
Client                          ElevenLabs WS
  │                                  │
  ├─── { text: "Hello, I...",  ────►│
  │      voice_settings: {...},      │
  │      xi_api_key: "..." }         │
  │                                  │
  │◄─── { audio: "<base64>",  ──────┤  (chunk 1, ~200ms)
  │       isFinal: false }           │
  │                                  │
  ├─── { text: " created the  ────►│
  │      function." }                │
  │                                  │
  │◄─── { audio: "<base64>",  ──────┤  (chunk 2)
  │       isFinal: false }           │
  │                                  │
  ├─── { text: "",            ─────►│  (flush signal)
  │      flush: true }               │
  │                                  │
  │◄─── { audio: "<base64>",  ──────┤  (final chunk)
  │       isFinal: true }            │
  └──────────────────────────────────┘
```

- Text sent incrementally as narrative sentences arrive
- Audio chunks decoded and yielded as ArrayBuffer
- `abort()` closes WebSocket, discards pending chunks
- Reconnects automatically on next `synthesize()` call

**Voice settings stored in localStorage:**
- `voice-dialog-tts-key`: ElevenLabs API key
- `voice-dialog-tts-voice`: Voice ID (default: a preset natural voice)
- `voice-dialog-tts-model`: Model ID (default: `eleven_turbo_v2_5`)

**WebSocket session lifetime and keepalive:**

ElevenLabs closes idle WebSocket connections after **20 seconds of inactivity** (no text messages sent). During a filler→Claude pipeline, gaps can exceed this — e.g., Claude reads a large file (tool takes 3s), thinks (5s), then starts another tool (2s more). The filler might not have anything to say during part of this window.

Keepalive strategy:
1. TTSProvider sends a **single space `{ text: " " }`** every 15 seconds when the WS is open but no text is flowing
2. ElevenLabs ignores whitespace-only text (no audio generated, no billing)
3. Keepalive starts automatically when the WS opens and stops when it closes
4. The keepalive timer resets on every real text send (filler or Claude)
5. If the WS closes unexpectedly mid-turn, TTSProvider reconnects transparently — the filler/Claude text pipeline doesn't know or care

```typescript
// Inside ElevenLabsTTSProvider
private keepaliveInterval: ReturnType<typeof setInterval> | null = null;

private startKeepalive(): void {
  this.keepaliveInterval = setInterval(() => {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ text: ' ' }));
    }
  }, 15_000);
}

private resetKeepalive(): void {
  if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
  this.startKeepalive();
}
```

This is a non-issue for most turns (filler keeps the WS active). The keepalive is a safety net for the edge case where filler is disabled or between batched tool events.

**CORS note:** ElevenLabs WebSocket API allows direct browser connections with the API key in the initial message. No server proxy needed. In CLI mode, this works directly. In extension mode, add `wss://api.elevenlabs.io/*` to `host_permissions` in manifest.json.

### 3. TTSSanitizer (tts-sanitizer.ts)

**The skill is the primary mechanism.** The voice-dialog SKILL.md instructs the agent to write conversational, voice-friendly responses — no code blocks, no tables, no markdown formatting. The agent's text response is already optimized for TTS.

The TTSSanitizer is a **lightweight safety net** (~50 lines) for when the agent occasionally ignores the skill:

**Rules (applied to the streaming token output):**
1. Strip fenced code blocks (``` ... ```) — agent sometimes can't resist
2. Strip inline backticks (keep the word inside, drop the backticks)
3. Flatten markdown bold/italic markers (`**text**` → `text`)
4. Strip header markers (`## Foo` → `Foo`)
5. Strip URLs (leave anchor text if present)
6. Collapse multiple newlines into sentence breaks
7. If the entire response was stripped → emit "Done."

**What it does NOT do:**
- No sentence detection or buffering — the skill ensures responses are already short and conversational
- No markdown parsing library — simple regex passes are sufficient
- No table detection — the skill says "don't use tables"

**Streaming integration:**
Tokens flow directly from the LLM stream through the sanitizer to the ElevenLabs WebSocket. The sanitizer operates on a small buffer (accumulates until a sentence boundary: `.!?` + whitespace), then emits clean text. This means TTS starts speaking after the agent's first sentence (~1-2s into streaming).

```typescript
class TTSSanitizer {
  // Feed streaming tokens, returns sanitized text ready for TTS (or null if buffering)
  push(token: string): string | null;

  // Flush any remaining buffered text
  flush(): string | null;

  // Reset state between turns
  reset(): void;
}
```

**Why skill + sanitizer beats a full NarrativeExtractor:**
- Zero added latency — tokens go straight from LLM to TTS
- No lossy stripping — the agent writes for voice in the first place
- The sanitizer catches edge cases, not the common path
- Much less code to maintain (~50 lines vs ~300+)

### 4. EchoCanceller (echo-canceller.ts)

Prevents TTS audio from being picked up by the mic and misinterpreted as user speech.

**Three-layer approach:**

**Layer 1: Browser AEC (baseline)**
Request mic with echo cancellation enabled:
```typescript
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
})
```
Chrome's built-in AEC handles most echo. But it's not perfect, especially with external speakers.

**Layer 2: Energy-gated detection**
While TTS is playing, raise the speech detection threshold. Use Web Audio API `AnalyserNode` on the mic stream to compute RMS energy. Only consider speech "real" if energy exceeds a dynamic threshold that accounts for TTS playback volume.

```
┌─────────┐    ┌──────────────┐    ┌──────────────┐
│ Mic     ├───►│ AnalyserNode ├───►│ Energy Gate  │
│ Stream  │    │ (FFT/RMS)    │    │ (threshold)  │
└─────────┘    └──────────────┘    └──────┬───────┘
                                          │
                                   speech detected?
                                          │
                                   ┌──────▼───────┐
                                   │ Barge-in     │
                                   │ trigger      │
                                   └──────────────┘

┌─────────┐    ┌──────────────┐
│ TTS     ├───►│ GainNode     ├───► speakers
│ Audio   │    │ (volume)     │
└─────────┘    └──────────────┘
         │
         └───► energy reference for threshold
```

**Layer 3: TTS-aware STT gating**
When TTS is actively playing audio:
- Buffer STT results but don't trigger auto-send
- Only accept speech as "real user input" if:
  - Energy is above threshold (Layer 2), AND
  - The transcribed text doesn't match the TTS text being spoken (anti-echo check), AND
  - Speech persists for >500ms (not a transient blip)

When all three conditions are met → barge-in triggered.

**Interface:**
```typescript
class EchoCanceller {
  constructor(audioContext: AudioContext);

  // Connect mic stream for monitoring
  connectMicStream(stream: MediaStream): void;

  // Notify that TTS is playing/stopped (adjusts thresholds)
  setTTSPlaying(playing: boolean): void;

  // Provide current TTS text for anti-echo matching
  setCurrentTTSText(text: string): void;

  // Returns true if genuine user speech is detected
  isUserSpeaking(): boolean;

  // Event callback
  onBargeIn: (() => void) | null;

  dispose(): void;
}
```

### 5. AudioPlayer (audio-player.ts)

Manages streaming audio playback with instant stop for barge-in.

**Implementation:**
Uses Web Audio API `AudioBufferSourceNode` for precise control:

```typescript
class AudioPlayer {
  constructor(audioContext: AudioContext);

  // Queue audio chunks for sequential playback
  enqueue(audioData: ArrayBuffer): Promise<void>;

  // Immediately stop all playback (barge-in)
  stop(): void;

  // Is audio currently playing?
  isPlaying(): boolean;

  // Callback when all queued audio finishes
  onComplete: (() => void) | null;

  dispose(): void;
}
```

**Chunk management:**
- Incoming ArrayBuffers are decoded via `audioContext.decodeAudioData()`
- Decoded AudioBuffers queued in a playlist
- Each buffer played via a new `AudioBufferSourceNode` connected to the AudioContext destination
- On `stop()`: disconnect current source node, clear queue, reset playback state
- All audio routed through a GainNode (for volume control and EchoCanceller reference)

### 6. VoiceFiller (voice-filler.ts)

Generates instant spoken responses using a fast-inference LLM (Cerebras/Groq, ~1000-2000 tok/s) to eliminate silence while Claude processes. The filler and Claude share a single ElevenLabs WebSocket session, making the handover acoustically invisible.

**The core UX problem:** Claude's tool-use loops (read file → edit → run tests) can take 5-30 seconds. Without filler, the user hears nothing during this time. With filler, they hear a continuous voice narrating what's happening.

**Three-phase filler timeline:**

```
Time ───────────────────────────────────────────────────────────────────────►

0ms              200ms              2-5s                 5-15s
│                │                  │                    │
User stops       Filler speaks     Tool results          Claude streams
speaking         (from prompt      arrive, filler        text, handover
                  alone)           narrates progress
│                │                  │                    │
▼                ▼                  ▼                    ▼
"fix the null    "Sure, let me     "Okay, I see the     "The issue is
 pointer in       take a look       handler — it's       that req.user
 auth"            at that."         about 40 lines."     is accessed
                                                         before the
                                                         middleware
                                                         runs..."
```

**Phase 0 — Prompt acknowledgment (immediate, ~200ms):**
The filler sees only the user's message + a rolling context summary. It generates a brief, specific acknowledgment. This is the highest-value phase: it eliminates the *entire* dead silence gap.

Filler prompt:
```
You are a voice assistant helping a developer. The user just said:
"{user_message}"

Context: {rolling_context_summary}

Generate a brief, natural spoken acknowledgment (1 sentence, max 10 words).
Be specific to what they asked. Don't just say "sure" or "okay".
Examples: "Let me check that file." / "On it, I'll run the tests."
```

**Phase 1 — Tool dispatch narration:**
As Claude dispatches tools, the filler receives tool names and arguments. It generates progress updates:
- `read_file("src/auth/handler.ts")` → "I'm opening the auth handler now."
- `bash("npm test")` → "Running the tests."
- `edit_file(...)` → "Making some changes to the file."

Filler prompt for Phase 1:
```
The assistant is currently performing this action: {tool_name}({tool_args_summary})
Generate a brief spoken status update (1 sentence, max 12 words).
Use natural language. Examples: "Opening that file now." / "Running the tests."
```

**Phase 2 — Tool result narration:**
Tool results arrive. The filler can make substantive (but non-conclusive) observations:
- Test output with failures → "Okay, looks like there are some test failures."
- File contents → "I see the handler — it's about 40 lines."

Filler prompt for Phase 2:
```
The assistant just completed: {tool_name}
Result summary: {result_summary}
Generate a brief spoken observation (1 sentence, max 15 words).
IMPORTANT: Describe what you SEE, not what you CONCLUDE.
- Say "I see some test failures" NOT "I'll fix the failing tests"
- Say "the file has about 40 lines" NOT "the bug is on line 12"
Never promise actions or state conclusions. Leave that to the main response.
```

**Rapid-fire tool batching:**

Claude often dispatches multiple tools in quick succession (read 3 files, then edit, then run tests). Narrating each individually would produce choppy, overwhelming audio. The filler batches rapid-fire events:

```
Tool events timeline:

0ms     read_file("auth.ts")     ─┐
50ms    read_file("middleware.ts") ─┤  within 800ms window
200ms   read_file("types.ts")    ─┘
                                    → batched: "Reading a few files in the auth module."

1500ms  edit_file("auth.ts")       → standalone (>800ms gap): "Making some changes now."

2000ms  bash("npm test")           → standalone: "Running the tests."
```

**Batching rules:**
1. On `feedToolStart()`, start an 800ms debounce timer
2. If another `feedToolStart()` arrives within 800ms, accumulate it into the batch
3. When the timer fires (no new tool for 800ms), generate ONE filler sentence for the batch
4. Batch prompt includes all accumulated tool names/args:
   ```
   The assistant is performing these actions:
   - read_file("src/auth/handler.ts")
   - read_file("src/auth/middleware.ts")
   - read_file("src/auth/types.ts")
   Generate a brief spoken summary (1 sentence, max 12 words).
   Example: "Reading through a few files in the auth module."
   ```
5. `feedToolResult()` follows the same batching — multiple results within 800ms get one observation

**Why 800ms?** Fast enough that the user doesn't notice a gap (filler was already speaking from Phase 0 or a prior narration). Slow enough to catch Claude's typical burst patterns (parallel tool calls resolve within ~200-500ms of each other).

**Cap:** If a batch accumulates more than 5 tools, emit immediately without waiting for the timer. At that point, a summary like "Working through several files" is better than waiting.

**Handover to Claude:**

When Claude starts streaming its text response, the filler must yield. The handover works because both filler and Claude feed text into the **same open ElevenLabs WebSocket session**:

```
ElevenLabs WS receives:
  msg 1: { text: "Sure, let me take a look. " }          ← filler (Phase 0)
  msg 2: { text: "Opening the auth handler now. " }       ← filler (Phase 1)
  msg 3: { text: "I see the file, about 40 lines. " }    ← filler (Phase 2)
  ── handover point ──
  msg 4: { text: "The issue is that req dot user " }      ← Claude
  msg 5: { text: "is accessed before the middleware " }   ← Claude
  msg 6: { text: "runs." }                                ← Claude

ElevenLabs treats all messages as one continuous utterance.
Same voice, same prosody, no audible seam.
```

The handover sequence:
1. Claude's first text token arrives → `VoiceFiller.prepareHandover()` called
2. Filler finishes its current sentence (does NOT start a new one)
3. ~200ms pause while Claude's first sentence buffers in TTSSanitizer
4. Claude's first clean sentence emitted → sent to the same WS → audio continues

**Handover timeout (500ms hard cut):**

`prepareHandover()` returns a Promise that resolves when the filler finishes its current sentence. But the filler might be mid-inference or waiting on a slow response. To prevent blocking Claude's voice:

```
prepareHandover() called
    │
    ├─── filler finishes sentence within 500ms? → resolve, clean transition
    │
    └─── 500ms elapsed, filler still generating? → hard cut:
              1. Abort filler inference immediately
              2. Discard any partial sentence in filler buffer
              3. Send a brief silence gap to ElevenLabs (empty text + flush)
              4. Resolve promise → Claude's text starts flowing
```

The 500ms budget is generous — at ~1500 tok/s, the filler can generate ~30 tokens (a full sentence) in 200ms. The timeout only fires if the filler LLM itself is slow or hung. The user hears at most a brief pause (~200ms of silence from the flush), then Claude's voice picks up.

**Rolling context summary:**

The filler maintains a 2-3 sentence summary of the conversation, updated after each turn. This lets Phase 0 acknowledgments reference prior context:
- Without context: "Let me look at that."
- With context: "Let me check the auth handler we were working on."

The summary is updated cheaply by the filler LLM itself after each turn completes (a single fast inference call).

**Safety: filler never makes promises or conclusions:**

The filler prompt is carefully constrained:
- Phase 0: Acknowledge intent, never commit to outcome
- Phase 1: Narrate actions, never predict results
- Phase 2: Observe results, never diagnose causes
- Conclusions and actions are exclusively Claude's domain

This means the filler can never contradict Claude. "I see some test failures" is always true if the tests failed, regardless of what Claude says about them.

**Graceful degradation:**

If the filler LLM is unavailable (no API key, network error, rate limit):
- Voice dialog works exactly as before — silence during tool use, then Claude's response
- No error shown unless explicitly configured; filler is an enhancement, not a requirement
- The `voice-dialog-filler-key` localStorage key being empty disables filler silently

**Interface:**
```typescript
interface VoiceFillerConfig {
  apiKey: string;           // Cerebras/Groq API key
  model: string;            // fast model ID (e.g., 'llama-3.3-70b')
  baseUrl: string;          // inference endpoint URL
}

class VoiceFiller {
  constructor(config: VoiceFillerConfig);

  // Phase 0: React to user prompt immediately
  startFilling(userMessage: string): void;

  // Phase 1: Tool dispatched — narrate the action
  feedToolStart(toolName: string, args: Record<string, unknown>): void;

  // Phase 2: Tool result arrived — observe the outcome
  feedToolResult(toolName: string, resultSummary: string): void;

  // Signal that Claude's text is starting — finish current sentence and yield
  prepareHandover(): Promise<void>;

  // Output — feeds into the shared ElevenLabs WS via TTSSanitizer
  onText: ((text: string) => void) | null;

  // Update rolling context after each completed turn
  updateContext(turnSummary: string): void;

  // Get current context summary (for debugging/display)
  getContextSummary(): string;

  stop(): void;
}
```

### 7. UI Integration

**New button** in chat panel (next to existing mic button):
- Icon: headphones or waveform icon (distinct from mic icon)
- Shortcut: `Ctrl+Shift+D` / `Cmd+Shift+D` (D for dialog)
- States:
  - **Off**: Default gray
  - **Active/Listening**: Purple border (dialog mode on, listening)
  - **Speaking**: Animated waveform or pulsing speaker icon
  - **Processing**: Spinner or thinking indicator

**Settings panel additions:**
- ElevenLabs API key input (password field)
- Voice selector (dropdown, fetched from ElevenLabs `/voices` API)
- Model selector (turbo_v2_5, multilingual_v2, etc.)
- TTS volume slider
- Test button ("Play sample")
- Filler section (collapsible):
  - Fast inference API key (password field)
  - Endpoint URL (text field, default Cerebras)
  - Model selector (text field, default llama-3.3-70b)
  - Enable/disable filler toggle (independent of voice dialog toggle)

**Chat panel hooks:**
- On user message sent: if voice dialog active, call `VoiceDialog.onUserMessage(text)` to start filler
- On tool dispatch: call `VoiceDialog.feedToolStart(name, args)` for filler narration
- On tool result: call `VoiceDialog.feedToolResult(name, summary)` for filler observation
- On streaming tokens: pipe each token through `VoiceDialog.feedToken()` (triggers handover + Claude TTS)
- On `turn_end` event: call `VoiceDialog.endResponse()` to flush remaining audio
- On barge-in: show visual indicator that TTS was interrupted
- Existing voice-input-only mode continues to work independently

---

## Data Flow

```
┌──────────────────────── Voice Dialog Loop ───────────────────────────┐
│                                                                      │
│  User speaks                                                         │
│      │                                                               │
│      ▼                                                               │
│  Mic → EchoCanceller → Web Speech API (STT)                         │
│      │                                                               │
│      ▼                                                               │
│  VoiceInput.onTranscript() → textarea preview                        │
│      │                                                               │
│      ▼  (2.5s silence)                                               │
│  VoiceInput.onAutoSend() → orchestrator.handleMessage()              │
│      │                                                               │
│      ├──► Claude starts processing (tools, thinking)                 │
│      │                                                               │
│      └──► VoiceFiller.startFilling(userMessage)  ← IMMEDIATE        │
│               │                                                      │
│               ▼  (~200ms)                                            │
│           Phase 0: "Sure, let me look at that."                      │
│               │        │                                             │
│               ▼        └──► TTSSanitizer ──► ElevenLabs WS ──► Audio │
│           Tool dispatched                                            │
│               │                                                      │
│               ▼                                                      │
│           Phase 1: "Opening the auth handler now."                   │
│               │        │                                             │
│               ▼        └──► same WS ──► Audio (seamless)             │
│           Tool result arrives                                        │
│               │                                                      │
│               ▼                                                      │
│           Phase 2: "I see the file, about 40 lines."                 │
│               │        │                                             │
│               ▼        └──► same WS ──► Audio (seamless)             │
│                                                                      │
│      Claude starts streaming text                                    │
│               │                                                      │
│               ▼                                                      │
│           VoiceFiller.prepareHandover()                               │
│           (filler finishes current sentence, yields)                 │
│               │                                                      │
│               ▼  ── handover ──                                      │
│                                                                      │
│  Claude tokens ──► TTSSanitizer ──► same WS ──► Audio (seamless)     │
│      │                                                               │
│      │                                      │                        │
│      │    ┌───── Barge-in? ◄────────────────┘                        │
│      │    │  (EchoCanceller detects real speech)                      │
│      │    │                                                          │
│      │    ▼                                                          │
│      │  AudioPlayer.stop() + VoiceFiller.stop()                      │
│      │  TTSProvider.abort()                                          │
│      │  → back to "User speaks"                                      │
│      │                                                               │
│      ▼  (TTS finishes naturally)                                     │
│  AudioPlayer.onComplete → VoiceFiller.updateContext()                │
│  → back to "User speaks"                                             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Extension Mode Considerations

- **WebSocket to ElevenLabs**: Requires `wss://api.elevenlabs.io/*` in manifest.json `host_permissions`
- **Filler LLM endpoint**: Requires `https://api.cerebras.ai/*` and `https://api.groq.com/*` in manifest.json `host_permissions` (both added so users can switch providers without extension update). Custom endpoints require the user to add their own `host_permissions` entry or use CLI mode.
- **AudioContext**: Works in side panel (no CSP issue)
- **Mic access**: Reuses existing popup-based permission flow from voice-input
- **API key storage**: localStorage (same pattern as provider API keys)

## Settings (localStorage keys)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `voice-dialog-enabled` | boolean | false | Persistent toggle state |
| `voice-dialog-tts-key` | string | '' | ElevenLabs API key |
| `voice-dialog-tts-voice` | string | '21m00Tcm4TlvDq8ikWAM' | Voice ID (Rachel default) |
| `voice-dialog-tts-model` | string | 'eleven_turbo_v2_5' | TTS model |
| `voice-dialog-volume` | number | 0.8 | TTS volume (0-1) |
| `voice-dialog-barge-in-threshold` | number | 0.02 | Energy threshold for barge-in |
| `voice-dialog-filler-key` | string | '' | Cerebras/Groq API key (empty = filler disabled) |
| `voice-dialog-filler-model` | string | 'llama-3.3-70b' | Fast inference model ID |
| `voice-dialog-filler-url` | string | 'https://api.cerebras.ai/v1' | Fast inference endpoint |

## Voice Dialog Skill

A `SKILL.md` file installed into `/workspace/skills/voice-dialog/` when voice dialog mode is active. This follows SLICC's skills-over-code principle — the agent's voice behavior is defined in natural language, not hardcoded.

**`SKILL.md` content (draft):**

```markdown
# Voice Dialog

You are in voice conversation mode. The user is speaking to you and hearing your responses read aloud.

## Response Style
- Write concise, conversational responses. Prefer short sentences.
- Avoid walls of text. If the answer is complex, give a summary first, then ask if the user wants details.
- Use natural spoken language, not written/formal language.
- Say "I'll" not "I will", "can't" not "cannot", etc.

## Code and Technical Content
- When you write or modify code, describe what you did in plain words: "I added a login function that validates the email and password."
- Do NOT read code aloud or include code snippets in your spoken text.
- Code, diffs, and file contents will be shown visually — you don't need to describe them line by line.
- For file paths, use just the filename: "the index file" not "/src/ui/components/index.ts".

## Structured Responses
- Avoid bullet lists, tables, and numbered steps in your voice responses.
- If you need to list things, weave them into sentences: "The three issues are X, Y, and Z."
- Skip markdown formatting entirely (no bold, headers, etc.).

## Turn-Taking
- Keep responses short enough to speak in 10-15 seconds when possible.
- If the task requires a long response, break it into chunks and pause for confirmation.
- End with a brief question or prompt when the next step is ambiguous: "Want me to go ahead?" or "Anything else?"
```

**Activation:** When `VoiceDialog.start()` is called, the skill is dynamically installed. When `VoiceDialog.stop()` is called, it's uninstalled. This uses the existing `skill install` / `skill uninstall` shell command infrastructure.

**Bundling:** The skill file is included in `src/defaults/workspace/skills/voice-dialog/SKILL.md` as a bundled default skill (loaded via `import.meta.glob`), but only activated when voice dialog mode is on.

## Implementation Order

1. **Voice Dialog Skill** — SKILL.md file, the foundation that shapes agent output for voice
2. **TTSSanitizer** — lightweight safety net (~50 lines), pure logic, fully testable
3. **TTSProvider** (ElevenLabs) — WebSocket streaming, testable with mocks
4. **AudioPlayer** — Web Audio API playback with queue and stop
5. **EchoCanceller** — Web Audio API analysis pipeline
6. **VoiceFiller** — fast-inference LLM client, three-phase generation, handover logic
7. **VoiceDialog** — orchestrator wiring everything together, streaming token pipeline + filler coordination
8. **UI integration** — button, settings panel (TTS + filler keys), chat panel hooks for token streaming + tool events
9. **Extension manifest** — host_permissions for ElevenLabs WebSocket (`wss://api.elevenlabs.io/*`) + filler endpoints (`https://api.cerebras.ai/*`, `https://api.groq.com/*`)
