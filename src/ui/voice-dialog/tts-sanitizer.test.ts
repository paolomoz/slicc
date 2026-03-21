import { describe, it, expect, beforeEach } from 'vitest';
import { TTSSanitizer } from './tts-sanitizer.js';

describe('TTSSanitizer', () => {
  let sanitizer: TTSSanitizer;

  beforeEach(() => {
    sanitizer = new TTSSanitizer();
  });

  describe('push', () => {
    it('buffers until sentence boundary', () => {
      expect(sanitizer.push('Hello')).toBeNull();
      expect(sanitizer.push(' world')).toBeNull();
      expect(sanitizer.push('. Next')).toBe('Hello world.');
    });

    it('handles question marks as boundaries', () => {
      expect(sanitizer.push('Ready? ')).toBe('Ready?');
    });

    it('handles exclamation marks as boundaries', () => {
      expect(sanitizer.push('Done! ')).toBe('Done!');
    });

    it('keeps remainder in buffer', () => {
      sanitizer.push('First. ');
      expect(sanitizer.push('Second. ')).toBe('Second.');
    });
  });

  describe('flush', () => {
    it('returns remaining buffer', () => {
      sanitizer.push('Partial text');
      expect(sanitizer.flush()).toBe('Partial text');
    });

    it('returns null when buffer is empty', () => {
      expect(sanitizer.flush()).toBeNull();
    });

    it('clears buffer after flush', () => {
      sanitizer.push('text');
      sanitizer.flush();
      expect(sanitizer.flush()).toBeNull();
    });
  });

  describe('sanitization rules', () => {
    it('strips fenced code blocks', () => {
      const result = sanitizer.push('I added ```const x = 1;``` the variable. ');
      // Sentence boundary at ". " after "variable" triggers emit
      expect(result).toBe('I added the variable.');
    });

    it('strips inline backticks but keeps content', () => {
      const result = sanitizer.push('Use the `readFile` function. ');
      expect(result).toBe('Use the readFile function.');
    });

    it('strips bold markers', () => {
      const result = sanitizer.push('This is **important** text. ');
      expect(result).toBe('This is important text.');
    });

    it('strips italic markers', () => {
      const result = sanitizer.push('This is *italic* text. ');
      expect(result).toBe('This is italic text.');
    });

    it('strips header markers', () => {
      sanitizer.push('## Summary\n');
      expect(sanitizer.flush()).toBe('Summary');
    });

    it('strips URLs but keeps anchor text', () => {
      const result = sanitizer.push('Check [the docs](https://example.com) here. ');
      expect(result).toBe('Check the docs here.');
    });

    it('strips bare URLs', () => {
      const result = sanitizer.push('Visit https://example.com/page for details. ');
      expect(result).toBe('Visit for details.');
    });

    it('collapses multiple newlines', () => {
      // "Line one." + newlines triggers sentence boundary at ". "
      // after newline collapse, so "Line one." is emitted by push
      const pushed = sanitizer.push('Line one.\n\n\nLine two');
      const flushed = sanitizer.flush();
      // The newlines collapse to a space, creating "Line one. Line two"
      // which hits the sentence boundary after "one."
      expect(pushed).toBe('Line one.');
      expect(flushed).toBe('Line two');
    });

    it('returns null for entirely stripped content', () => {
      sanitizer.push('```\nconst x = 1;\n```');
      expect(sanitizer.flush()).toBeNull();
    });
  });

  describe('reset', () => {
    it('clears buffer state', () => {
      sanitizer.push('partial');
      sanitizer.reset();
      expect(sanitizer.flush()).toBeNull();
    });
  });

  describe('streaming integration', () => {
    it('handles token-by-token streaming', () => {
      const results: string[] = [];
      const tokens = ['I', "'ll", ' fix', ' the', ' bug', '.', ' ', 'The', ' issue', ' was', ' simple', '.', ' '];
      for (const t of tokens) {
        const r = sanitizer.push(t);
        if (r) results.push(r);
      }
      const flushed = sanitizer.flush();
      if (flushed) results.push(flushed);

      expect(results).toEqual(["I'll fix the bug.", 'The issue was simple.']);
    });
  });
});
