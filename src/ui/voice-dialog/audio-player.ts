/**
 * Audio Player — streaming audio playback with instant stop for barge-in.
 *
 * Queues decoded audio chunks and plays them sequentially via
 * AudioBufferSourceNode. On stop(), all playback halts immediately.
 */

import { createLogger } from '../../core/logger.js';

const log = createLogger('audio-player');

export class AudioPlayer {
  private ctx: AudioContext;
  private gainNode: GainNode;
  private queue: AudioBuffer[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private _isPlaying = false;
  private _volume = 0.8;

  /** Fires when all queued audio finishes playing. */
  onComplete: (() => void) | null = null;

  constructor(audioContext: AudioContext) {
    this.ctx = audioContext;
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this._volume;
    this.gainNode.connect(this.ctx.destination);
  }

  /** Queue an audio chunk (raw bytes) for sequential playback. */
  async enqueue(audioData: ArrayBuffer): Promise<void> {
    try {
      const audioBuffer = await this.ctx.decodeAudioData(audioData.slice(0));
      this.queue.push(audioBuffer);
      if (!this._isPlaying) {
        this.playNext();
      }
    } catch (err) {
      log.error('Failed to decode audio data', err);
    }
  }

  /** Immediately stop all playback (barge-in). */
  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {}
      this.currentSource = null;
    }
    this.queue.length = 0;
    this._isPlaying = false;
  }

  /** Is audio currently playing? */
  isPlaying(): boolean {
    return this._isPlaying;
  }

  /** Set playback volume (0-1). */
  setVolume(volume: number): void {
    this._volume = Math.max(0, Math.min(1, volume));
    this.gainNode.gain.value = this._volume;
  }

  /** Get the GainNode for echo canceller reference. */
  getGainNode(): GainNode {
    return this.gainNode;
  }

  dispose(): void {
    this.stop();
    this.gainNode.disconnect();
  }

  private playNext(): void {
    if (this.queue.length === 0) {
      this._isPlaying = false;
      this.onComplete?.();
      return;
    }

    this._isPlaying = true;
    const buffer = this.queue.shift()!;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);
    this.currentSource = source;

    source.onended = () => {
      if (this.currentSource === source) {
        source.disconnect();
        this.currentSource = null;
        this.playNext();
      }
    };

    source.start();
  }
}
