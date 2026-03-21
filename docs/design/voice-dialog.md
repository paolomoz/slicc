# Voice Dialog Design

## Overview

A natural voice conversation mode for SLICC where the user speaks, the agent responds with synthesized speech, and the user can interrupt (barge-in) at any time. Separate from the existing voice-input-only toggle.

## Decisions

| Concern | Decision |
|---------|----------|
| TTS Provider | ElevenLabs (WebSocket streaming) |
| What gets spoken | Narrative text only (auto-strip code, diffs, tool results) |
| Interruption | Barge-in (user speech stops TTS immediately) |
| Echo handling | Web Audio API echo cancellation |
| Listen cycle | Starts immediately, overlaps with TTS |
| Activation | Separate "voice dialog" button, independent of voice-input toggle |
| API key storage | localStorage (consistent with LLM provider keys) |
| Agent voice behavior | SKILL.md file (skills-over-code principle) |

---

## Architecture

### New Modules

```
src/ui/voice-dialog/
  voice-dialog.ts        # VoiceDialog class — orchestrates the full loop
  tts-provider.ts        # TTS provider interface + ElevenLabs implementation
  narrative-extractor.ts # Strips code/diffs/structured content from agent output
  echo-canceller.ts      # Web Audio API echo cancellation pipeline
  audio-player.ts        # Streaming audio playback with barge-in support
```

### Component Relationships

```
┌──────────────────────────────────────────────────────────────┐
│  VoiceDialog (orchestrator)                                  │
│                                                              │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │ VoiceInput  │   │ AudioPlayer  │   │ NarrativeExtract │  │
│  │ (existing)  │◄─►│  (new)       │   │ (new)            │  │
│  └──────┬──────┘   └──────┬───────┘   └────────┬─────────┘  │
│         │                 │                     │            │
│         │          ┌──────┴───────┐             │            │
│         │          │ EchoCanceller│             │            │
│         └─────────►│  (new)       │             │            │
│                    └──────┬───────┘             │            │
│                           │                     │            │
│                    ┌──────┴───────┐             │            │
│                    │ TTSProvider  │◄────────────┘            │
│                    │ (ElevenLabs) │                           │
│                    └──────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

---

## Detailed Design

### 1. VoiceDialog (voice-dialog.ts)

The top-level state machine that orchestrates the full speak-listen-respond loop.

**States:**
```
IDLE → LISTENING → PROCESSING → SPEAKING → LISTENING
                                    ↑          │
                                    └──────────┘  (barge-in)
```

- `IDLE`: Dialog mode off. No mic, no TTS.
- `LISTENING`: Mic open, STT active, waiting for user speech. May overlap with SPEAKING.
- `PROCESSING`: User utterance sent to agent, waiting for response.
- `SPEAKING`: TTS playing agent response. Mic still open (echo-cancelled).

**Barge-in transition:** While in SPEAKING state, if the echo canceller detects genuine user speech (not echo), immediately:
1. Stop TTS playback (`AudioPlayer.stop()`)
2. Cancel any pending TTS chunks
3. Transition to LISTENING (already there since mic was open)
4. Accumulate the new utterance normally

**Interface:**
```typescript
interface VoiceDialogConfig {
  ttsApiKey: string;
  ttsVoiceId: string;
  ttsModel?: string;              // default: 'eleven_turbo_v2_5'
  onStateChange: (state: VoiceDialogState) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onTTSText: (text: string) => void;  // narrative text being spoken
  onError: (error: string) => void;
  lang?: string;                  // STT language, default 'en-US'
}

class VoiceDialog {
  start(): Promise<void>;
  stop(): void;
  isActive(): boolean;
  getState(): VoiceDialogState;

  // Called by chat panel when agent response arrives
  speakResponse(fullResponse: string): void;
}
```

**Lifecycle:**
1. User clicks dialog button → `start()` → init AudioContext, EchoCanceller, mic stream, STT
2. User speaks → existing VoiceInput transcription pipeline → auto-send at 2.5s silence
3. Agent streams response → `speakResponse()` called with full text at turn end
4. NarrativeExtractor strips code → TTSProvider streams audio → AudioPlayer plays
5. If user speaks during playback → EchoCanceller flags real speech → barge-in → TTS stops
6. Loop back to step 2

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

**CORS note:** ElevenLabs WebSocket API allows direct browser connections with the API key in the initial message. No server proxy needed. In CLI mode, this works directly. In extension mode, add `wss://api.elevenlabs.io/*` to `host_permissions` in manifest.json.

### 3. NarrativeExtractor (narrative-extractor.ts)

Parses agent responses and extracts only the parts suitable for speech.

**Rules:**
1. Strip fenced code blocks (``` ... ```)
2. Strip inline code (`backtick content`)
3. Strip tool call results and structured output
4. Strip file paths longer than ~30 chars (speak short paths like "index.ts", skip "/src/ui/voice-dialog/echo-canceller.ts")
5. Strip markdown formatting (bold, italic, headers → plain text)
6. Strip tables
7. Strip URLs
8. Collapse whitespace and normalize punctuation for natural speech cadence
9. If nothing remains after stripping → return a short fallback like "Done."

**Sentence-level streaming:**
The extractor should emit text sentence-by-sentence as the agent streams, so TTS can start before the full response is ready:

```typescript
class NarrativeExtractor {
  // Feed raw markdown chunks as they stream in
  push(chunk: string): void;

  // Get next complete sentence(s) ready for TTS
  flush(): string | null;

  // Reset state
  reset(): void;

  // Extract all narrative from a complete response
  static extract(markdown: string): string;
}
```

Buffering strategy: accumulate chunks until a sentence boundary (`.`, `!`, `?` followed by space/newline). When a complete sentence is detected and it survives the stripping rules, emit it. This lets TTS start after the first sentence rather than waiting for the full response.

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

### 6. UI Integration

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

**Chat panel hooks:**
- On `turn_end` event: if voice dialog active, pass response through `NarrativeExtractor` → `VoiceDialog.speakResponse()`
- On barge-in: show visual indicator that TTS was interrupted
- Voice dialog button disabled during agent processing (response not yet available)
- Existing voice-input-only mode continues to work independently

---

## Data Flow

```
┌─────────────────────── Voice Dialog Loop ──────────────────────┐
│                                                                │
│  User speaks                                                   │
│      │                                                         │
│      ▼                                                         │
│  Mic → EchoCanceller → Web Speech API (STT)                   │
│      │                                                         │
│      ▼                                                         │
│  VoiceInput.onTranscript() → textarea preview                  │
│      │                                                         │
│      ▼  (2.5s silence)                                         │
│  VoiceInput.onAutoSend() → orchestrator.handleMessage()        │
│      │                                                         │
│      ▼                                                         │
│  Agent processes (tools, code, etc.)                           │
│      │                                                         │
│      ▼  (turn_end event)                                       │
│  NarrativeExtractor.extract(response)                          │
│      │                                                         │
│      ▼                                                         │
│  TTSProvider.synthesize(narrative) → streaming audio chunks     │
│      │                                                         │
│      ▼                                                         │
│  AudioPlayer.enqueue(chunks) → speakers                        │
│      │                                    │                    │
│      │    ┌───── Barge-in? ◄──────────────┘                    │
│      │    │  (EchoCanceller detects real speech)                │
│      │    │                                                    │
│      │    ▼                                                    │
│      │  AudioPlayer.stop()                                     │
│      │  TTSProvider.abort()                                    │
│      │  → back to "User speaks"                                │
│      │                                                         │
│      ▼  (TTS finishes naturally)                               │
│  AudioPlayer.onComplete → ready for next utterance             │
│  → back to "User speaks"                                       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Extension Mode Considerations

- **WebSocket to ElevenLabs**: Requires `wss://api.elevenlabs.io/*` in manifest.json `host_permissions`
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

1. **NarrativeExtractor** — pure logic, fully testable, no dependencies
2. **TTSProvider** (ElevenLabs) — WebSocket streaming, testable with mocks
3. **AudioPlayer** — Web Audio API playback with queue and stop
4. **EchoCanceller** — Web Audio API analysis pipeline
5. **VoiceDialog** — orchestrator wiring everything together
6. **UI integration** — button, settings panel, chat panel hooks
7. **Extension manifest** — host_permissions for ElevenLabs WebSocket
