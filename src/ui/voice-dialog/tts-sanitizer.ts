/**
 * TTS Sanitizer — lightweight safety net for stripping accidental markdown/code
 * from agent responses before they reach the TTS provider.
 *
 * The voice-dialog SKILL.md is the primary mechanism for voice-friendly output.
 * This sanitizer catches the edge cases where the agent ignores the skill.
 */

/** Sentence-ending punctuation followed by whitespace or end-of-string. */
const SENTENCE_BOUNDARY = /([.!?])\s+/;

export class TTSSanitizer {
  private buffer = '';

  /**
   * Feed streaming tokens. Returns sanitized text ready for TTS when a
   * sentence boundary is reached, or null if still buffering.
   */
  push(token: string): string | null {
    this.buffer += token;
    const match = this.buffer.match(SENTENCE_BOUNDARY);
    if (!match) return null;

    // Split at the sentence boundary — emit the sentence, keep the rest
    const idx = match.index! + match[0].length;
    const sentence = this.buffer.slice(0, idx);
    this.buffer = this.buffer.slice(idx);
    return sanitize(sentence);
  }

  /** Flush any remaining buffered text. */
  flush(): string | null {
    if (!this.buffer) return null;
    const result = sanitize(this.buffer);
    this.buffer = '';
    return result;
  }

  /** Reset state between turns. */
  reset(): void {
    this.buffer = '';
  }
}

/** Apply all sanitization rules to a chunk of text. */
function sanitize(text: string): string | null {
  let s = text;

  // 1. Strip fenced code blocks (``` ... ```)
  s = s.replace(/```[\s\S]*?```/g, '');

  // 2. Strip inline backticks (keep the word inside)
  s = s.replace(/`([^`]*)`/g, '$1');

  // 3. Flatten bold/italic markers
  s = s.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  s = s.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');

  // 4. Strip header markers
  s = s.replace(/^#{1,6}\s+/gm, '');

  // 5. Strip URLs (leave anchor text if present)
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/https?:\/\/\S+/g, '');

  // 6. Collapse multiple newlines into a space
  s = s.replace(/\n{2,}/g, ' ');
  s = s.replace(/\n/g, ' ');

  // Clean up extra whitespace
  s = s.replace(/\s{2,}/g, ' ').trim();

  // 7. If everything was stripped, return "Done."
  if (!s) return null;
  return s;
}
