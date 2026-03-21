/**
 * Echo Canceller — prevents TTS audio from being picked up by the mic
 * and misinterpreted as user speech.
 *
 * Three-layer approach:
 * 1. Browser AEC (baseline via getUserMedia constraints)
 * 2. Energy-gated detection (raise threshold during TTS playback)
 * 3. TTS-aware STT gating (anti-echo text matching + persistence check)
 */

import { createLogger } from '../../core/logger.js';

const log = createLogger('echo-canceller');

/** Minimum duration of speech (ms) before triggering barge-in during TTS. */
const BARGE_IN_PERSISTENCE_MS = 500;

/** RMS energy threshold multiplier when TTS is playing. */
const TTS_THRESHOLD_MULTIPLIER = 3.0;

export class EchoCanceller {
  private ctx: AudioContext;
  private analyser: AnalyserNode | null = null;
  private dataArray: Float32Array<ArrayBuffer> | null = null;
  private ttsPlaying = false;
  private currentTTSText = '';
  private speechStartTime: number | null = null;
  private bargeInThreshold: number;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  /** Fires when genuine user speech is detected during TTS playback. */
  onBargeIn: (() => void) | null = null;

  constructor(audioContext: AudioContext, bargeInThreshold = 0.02) {
    this.ctx = audioContext;
    this.bargeInThreshold = bargeInThreshold;
  }

  /** Connect mic stream for energy monitoring. */
  connectMicStream(stream: MediaStream): void {
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.dataArray = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;

    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(this.analyser);
    // Don't connect analyser to destination — we only want to read energy, not play mic audio

    // Start periodic check
    this.checkInterval = setInterval(() => this.checkForBargeIn(), 100);
    log.info('Echo canceller connected to mic stream');
  }

  /** Notify that TTS is playing/stopped (adjusts thresholds). */
  setTTSPlaying(playing: boolean): void {
    this.ttsPlaying = playing;
    if (!playing) {
      this.speechStartTime = null;
    }
  }

  /** Provide current TTS text for anti-echo matching. */
  setCurrentTTSText(text: string): void {
    this.currentTTSText = text.toLowerCase();
  }

  /** Returns true if genuine user speech is detected. */
  isUserSpeaking(): boolean {
    if (!this.analyser || !this.dataArray) return false;
    const energy = this.getRMSEnergy();
    const threshold = this.ttsPlaying
      ? this.bargeInThreshold * TTS_THRESHOLD_MULTIPLIER
      : this.bargeInThreshold;
    return energy > threshold;
  }

  /** Update the barge-in threshold. */
  setBargeInThreshold(threshold: number): void {
    this.bargeInThreshold = threshold;
  }

  dispose(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.analyser?.disconnect();
    this.analyser = null;
    this.dataArray = null;
  }

  /** Check if anti-echo text match says the speech is just echo. */
  isEchoMatch(transcript: string): boolean {
    if (!this.currentTTSText || !transcript) return false;
    const lower = transcript.toLowerCase();
    // If the transcript is a substring of the current TTS text, it's likely echo
    return this.currentTTSText.includes(lower);
  }

  private getRMSEnergy(): number {
    if (!this.analyser || !this.dataArray) return 0;
    this.analyser.getFloatTimeDomainData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i] * this.dataArray[i];
    }
    return Math.sqrt(sum / this.dataArray.length);
  }

  private checkForBargeIn(): void {
    if (!this.ttsPlaying) return;

    const speaking = this.isUserSpeaking();

    if (speaking) {
      if (!this.speechStartTime) {
        this.speechStartTime = Date.now();
      } else if (Date.now() - this.speechStartTime >= BARGE_IN_PERSISTENCE_MS) {
        log.info('Barge-in detected');
        this.speechStartTime = null;
        this.onBargeIn?.();
      }
    } else {
      this.speechStartTime = null;
    }
  }
}

/**
 * Request mic stream with echo cancellation constraints.
 * This is Layer 1 — browser built-in AEC.
 */
export async function getMicStreamWithAEC(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}
