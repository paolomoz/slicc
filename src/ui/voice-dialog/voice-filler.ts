/**
 * Voice Filler — generates instant spoken responses using a fast-inference LLM
 * (Cerebras/Groq) to eliminate silence while Claude processes.
 *
 * Three phases:
 *   Phase 0: Immediate acknowledgment (~200ms) based on user message
 *   Phase 1: Tool dispatch narration (batched)
 *   Phase 2: Tool result observation (batched)
 *
 * Shares the ElevenLabs WebSocket with Claude for seamless handover.
 */

import { createLogger } from '../../core/logger.js';

const log = createLogger('voice-filler');

export interface VoiceFillerConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** Debounce window for batching rapid-fire tool events. */
const BATCH_DEBOUNCE_MS = 800;
/** Max tools per batch before forcing emit. */
const BATCH_CAP = 5;
/** Handover timeout — hard cut filler after this many ms. */
const HANDOVER_TIMEOUT_MS = 500;

interface ToolEvent {
  type: 'start' | 'result';
  toolName: string;
  detail: string; // args summary or result summary
}

export class VoiceFiller {
  private config: VoiceFillerConfig;
  private abortController: AbortController | null = null;
  private rollingContext = '';
  private batchBuffer: ToolEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private _stopped = false;
  private handoverResolve: (() => void) | null = null;
  private isGenerating = false;

  /** Output callback — feeds text into the shared ElevenLabs WS via TTSSanitizer. */
  onText: ((text: string) => void) | null = null;

  constructor(config: VoiceFillerConfig) {
    this.config = config;
  }

  /** Phase 0: React to user prompt immediately. */
  startFilling(userMessage: string): void {
    this._stopped = false;
    const prompt = this.buildPhase0Prompt(userMessage);
    this.generate(prompt);
  }

  /** Phase 1: Tool dispatched — narrate the action (with batching). */
  feedToolStart(toolName: string, args: Record<string, unknown>): void {
    if (this._stopped) return;
    const detail = summarizeArgs(args);
    this.addToBatch({ type: 'start', toolName, detail });
  }

  /** Phase 2: Tool result arrived — observe the outcome (with batching). */
  feedToolResult(toolName: string, resultSummary: string): void {
    if (this._stopped) return;
    this.addToBatch({ type: 'result', toolName, detail: resultSummary });
  }

  /**
   * Signal that Claude's text is starting — finish current sentence and yield.
   * Returns a Promise that resolves when the filler is done (or after 500ms hard cut).
   */
  async prepareHandover(): Promise<void> {
    this._stopped = true;
    this.clearBatch();

    if (!this.isGenerating) return;

    return new Promise<void>((resolve) => {
      this.handoverResolve = resolve;

      // Hard cut after HANDOVER_TIMEOUT_MS
      setTimeout(() => {
        if (this.handoverResolve === resolve) {
          log.info('Handover timeout — hard cut');
          this.abortGeneration();
          this.handoverResolve = null;
          resolve();
        }
      }, HANDOVER_TIMEOUT_MS);
    });
  }

  /** Update rolling context after each completed turn. */
  updateContext(turnSummary: string): void {
    // Keep last 2-3 sentences of context
    const sentences = (this.rollingContext + ' ' + turnSummary).trim().split(/[.!?]\s+/);
    this.rollingContext = sentences.slice(-3).join('. ');
    if (this.rollingContext && !this.rollingContext.endsWith('.')) {
      this.rollingContext += '.';
    }
  }

  /** Get current context summary. */
  getContextSummary(): string {
    return this.rollingContext;
  }

  /** Stop all filler activity. */
  stop(): void {
    this._stopped = true;
    this.clearBatch();
    this.abortGeneration();
  }

  // --- Batching ---

  private addToBatch(event: ToolEvent): void {
    this.batchBuffer.push(event);

    // Cap: emit immediately if batch is large enough
    if (this.batchBuffer.length >= BATCH_CAP) {
      this.flushBatch();
      return;
    }

    // Reset debounce timer
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushBatch();
    }, BATCH_DEBOUNCE_MS);
  }

  private flushBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.batchBuffer.length === 0 || this._stopped) return;

    const events = [...this.batchBuffer];
    this.batchBuffer.length = 0;

    const prompt = this.buildBatchPrompt(events);
    this.generate(prompt);
  }

  private clearBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.batchBuffer.length = 0;
  }

  // --- LLM Inference ---

  private async generate(prompt: string): Promise<void> {
    if (this._stopped) return;

    this.abortGeneration();
    const controller = new AbortController();
    this.abortController = controller;
    this.isGenerating = true;

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 60,
          temperature: 0.7,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        log.error('Filler LLM request failed', { status: response.status });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;
            if (token && !this._stopped) {
              this.onText?.(token);
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        log.error('Filler generation failed', err);
      }
    } finally {
      this.isGenerating = false;
      if (this.abortController === controller) {
        this.abortController = null;
      }
      // If handover was waiting for us, resolve it
      if (this.handoverResolve) {
        const resolve = this.handoverResolve;
        this.handoverResolve = null;
        resolve();
      }
    }
  }

  private abortGeneration(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isGenerating = false;
  }

  // --- Prompt Construction ---

  private buildPhase0Prompt(userMessage: string): string {
    const context = this.rollingContext
      ? `\nContext: ${this.rollingContext}`
      : '';
    return `You are a voice assistant helping a developer. The user just said:
"${userMessage}"
${context}
Generate a brief, natural spoken acknowledgment (1 sentence, max 10 words).
Be specific to what they asked. Don't just say "sure" or "okay".
Examples: "Let me check that file." / "On it, I'll run the tests."`;
  }

  private buildBatchPrompt(events: ToolEvent[]): string {
    const isResults = events[0].type === 'result';

    if (isResults) {
      const items = events.map(e => `- ${e.toolName}: ${e.detail}`).join('\n');
      return `The assistant just completed these actions:
${items}
Generate a brief spoken observation (1 sentence, max 15 words).
IMPORTANT: Describe what you SEE, not what you CONCLUDE.
- Say "I see some test failures" NOT "I'll fix the failing tests"
- Say "the file has about 40 lines" NOT "the bug is on line 12"
Never promise actions or state conclusions. Leave that to the main response.`;
    }

    const items = events.map(e => `- ${e.toolName}(${e.detail})`).join('\n');
    return `The assistant is performing these actions:
${items}
Generate a brief spoken summary (1 sentence, max 12 words).
Example: "Reading through a few files in the auth module."`;
  }
}

/** Summarize tool args to a short string for prompts. */
function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length <= 80) {
      parts.push(`"${value}"`);
    } else if (typeof value === 'string') {
      parts.push(`"${value.slice(0, 40)}..."`);
    }
  }
  return parts.join(', ') || JSON.stringify(args).slice(0, 60);
}
