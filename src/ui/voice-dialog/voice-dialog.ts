/**
 * Voice Dialog — orchestrates the full speak-listen-respond loop.
 *
 * State machine: IDLE → LISTENING → FILLING → SPEAKING → LISTENING
 *
 * Manages VoiceInput (STT), EchoCanceller, AudioPlayer, TTSProvider,
 * TTSSanitizer, and VoiceFiller. A single ElevenLabs WebSocket session
 * is shared between filler and Claude for seamless voice handover.
 */

import { createLogger } from '../../core/logger.js';
import { VoiceInput } from '../voice-input.js';
import { TTSSanitizer } from './tts-sanitizer.js';
import { ElevenLabsTTSProvider } from './tts-provider.js';
import type { TTSProvider } from './tts-provider.js';
import { AudioPlayer } from './audio-player.js';
import { EchoCanceller, getMicStreamWithAEC } from './echo-canceller.js';
import { VoiceFiller } from './voice-filler.js';

const log = createLogger('voice-dialog');

export type VoiceDialogState = 'IDLE' | 'LISTENING' | 'FILLING' | 'SPEAKING';

export interface VoiceDialogConfig {
  ttsApiKey: string;
  ttsVoiceId: string;
  ttsModel?: string;
  fillerApiKey?: string;
  fillerModel?: string;
  fillerBaseUrl?: string;
  onStateChange: (state: VoiceDialogState) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onTTSText: (text: string) => void;
  onError: (error: string) => void;
  lang?: string;
}

export class VoiceDialog {
  private config: VoiceDialogConfig;
  private state: VoiceDialogState = 'IDLE';
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private voiceInput: VoiceInput | null = null;
  private ttsProvider: TTSProvider | null = null;
  private audioPlayer: AudioPlayer | null = null;
  private echoCanceller: EchoCanceller | null = null;
  private sanitizer: TTSSanitizer;
  private filler: VoiceFiller | null = null;
  private fillerEnabled: boolean;

  constructor(config: VoiceDialogConfig) {
    this.config = config;
    this.sanitizer = new TTSSanitizer();
    this.fillerEnabled = !!(config.fillerApiKey && config.fillerBaseUrl);
  }

  async start(): Promise<void> {
    if (this.state !== 'IDLE') return;

    try {
      // Initialize AudioContext
      this.audioContext = new AudioContext();

      // Get mic with AEC
      this.micStream = await getMicStreamWithAEC();

      // Initialize TTS provider
      this.ttsProvider = new ElevenLabsTTSProvider({
        apiKey: this.config.ttsApiKey,
        voiceId: this.config.ttsVoiceId,
        model: this.config.ttsModel ?? 'eleven_turbo_v2_5',
      });
      await this.ttsProvider.connect();

      // Initialize AudioPlayer
      this.audioPlayer = new AudioPlayer(this.audioContext);

      // Wire TTS audio to player
      this.ttsProvider.onAudio = (chunk) => {
        this.audioPlayer?.enqueue(chunk);
      };

      // When all audio finishes playing naturally
      this.audioPlayer.onComplete = () => {
        if (this.state === 'SPEAKING' || this.state === 'FILLING') {
          this.setState('LISTENING');
        }
      };

      // Initialize EchoCanceller
      this.echoCanceller = new EchoCanceller(
        this.audioContext,
        parseFloat(localStorage.getItem('voice-dialog-barge-in-threshold') ?? '0.02'),
      );
      this.echoCanceller.connectMicStream(this.micStream);

      // Barge-in handler — works from FILLING and SPEAKING
      this.echoCanceller.onBargeIn = () => {
        if (this.state === 'SPEAKING' || this.state === 'FILLING') {
          log.info('Barge-in from', this.state);
          this.handleBargeIn();
        }
      };

      // Initialize VoiceFiller (if configured)
      if (this.fillerEnabled) {
        this.filler = new VoiceFiller({
          apiKey: this.config.fillerApiKey!,
          model: this.config.fillerModel ?? 'llama-3.3-70b',
          baseUrl: this.config.fillerBaseUrl!,
        });
        this.filler.onText = (text) => {
          this.ttsProvider?.send(text);
          this.config.onTTSText(text);
        };
      }

      // Initialize VoiceInput (STT)
      this.voiceInput = new VoiceInput({
        onTranscript: (text, isFinal) => {
          this.config.onTranscript(text, isFinal);
        },
        onStateChange: () => {},
        onError: (error) => {
          this.config.onError(error);
        },
        autoSend: true,
        onAutoSend: () => {
          // Auto-send is handled externally — the chat panel's onAutoSend fires
        },
        lang: this.config.lang ?? 'en-US',
      });

      this.setState('LISTENING');
      this.voiceInput.start();

      log.info('Voice dialog started', { fillerEnabled: this.fillerEnabled });
    } catch (err: any) {
      log.error('Failed to start voice dialog', err);
      this.config.onError(`Voice dialog failed to start: ${err.message}`);
      this.cleanup();
    }
  }

  stop(): void {
    this.cleanup();
    this.setState('IDLE');
    log.info('Voice dialog stopped');
  }

  isActive(): boolean {
    return this.state !== 'IDLE';
  }

  getState(): VoiceDialogState {
    return this.state;
  }

  /** Called immediately when user message is sent — starts filler. */
  onUserMessage(message: string): void {
    if (!this.isActive()) return;

    this.sanitizer.reset();

    if (this.filler) {
      this.setState('FILLING');
      this.echoCanceller?.setTTSPlaying(true);
      this.filler.startFilling(message);
    }
  }

  /** Feed tool events to filler for progressively smarter narration. */
  feedToolStart(toolName: string, args: Record<string, unknown>): void {
    if (!this.isActive() || !this.filler) return;
    this.filler.feedToolStart(toolName, args);
  }

  feedToolResult(toolName: string, resultSummary: string): void {
    if (!this.isActive() || !this.filler) return;
    this.filler.feedToolResult(toolName, resultSummary);
  }

  /** Feed streaming tokens from Claude's text response — triggers handover. */
  feedToken(token: string): void {
    if (!this.isActive()) return;

    // Trigger handover from filler on first token
    if (this.state === 'FILLING' && this.filler) {
      this.filler.prepareHandover().then(() => {
        // Filler done — now in SPEAKING mode with Claude's voice
      });
      this.setState('SPEAKING');
    } else if (this.state !== 'SPEAKING') {
      this.setState('SPEAKING');
      this.echoCanceller?.setTTSPlaying(true);
    }

    // Push token through sanitizer
    const clean = this.sanitizer.push(token);
    if (clean) {
      this.ttsProvider?.send(clean);
      this.echoCanceller?.setCurrentTTSText(clean);
      this.config.onTTSText(clean);
    }
  }

  /** Signal that Claude's response is complete (flushes remaining audio). */
  endResponse(): void {
    if (!this.isActive()) return;

    // Flush any remaining text in the sanitizer
    const remaining = this.sanitizer.flush();
    if (remaining) {
      this.ttsProvider?.send(remaining);
      this.config.onTTSText(remaining);
    }

    // Tell TTS to flush its buffer
    this.ttsProvider?.flush();

    // Update filler context
    this.filler?.updateContext('Turn completed.');

    // AudioPlayer.onComplete will transition back to LISTENING
    // If nothing was playing (empty response), transition now
    if (!this.audioPlayer?.isPlaying()) {
      this.setState('LISTENING');
      this.echoCanceller?.setTTSPlaying(false);
    }
  }

  /** Update volume. */
  setVolume(volume: number): void {
    this.audioPlayer?.setVolume(volume);
  }

  // --- Internal ---

  private handleBargeIn(): void {
    // Stop TTS playback
    this.audioPlayer?.stop();

    // If filling, abort filler inference
    if (this.state === 'FILLING') {
      this.filler?.stop();
    }

    // Cancel pending TTS chunks
    this.ttsProvider?.abort();

    // Reconnect TTS for next turn
    this.reconnectTTS();

    // Clear echo state
    this.echoCanceller?.setTTSPlaying(false);
    this.echoCanceller?.setCurrentTTSText('');

    // Reset sanitizer
    this.sanitizer.reset();

    this.setState('LISTENING');
  }

  private async reconnectTTS(): Promise<void> {
    try {
      await this.ttsProvider?.connect();
      // Re-wire audio callback
      if (this.ttsProvider) {
        this.ttsProvider.onAudio = (chunk) => {
          this.audioPlayer?.enqueue(chunk);
        };
      }
    } catch (err) {
      log.error('Failed to reconnect TTS after barge-in', err);
    }
  }

  private setState(state: VoiceDialogState): void {
    if (this.state === state) return;
    const prev = this.state;
    this.state = state;
    log.debug('State transition', { from: prev, to: state });
    this.config.onStateChange(state);
  }

  private cleanup(): void {
    this.voiceInput?.stop();
    this.voiceInput?.destroy();
    this.voiceInput = null;

    this.filler?.stop();
    this.filler = null;

    this.audioPlayer?.stop();
    this.audioPlayer?.dispose();
    this.audioPlayer = null;

    this.ttsProvider?.disconnect();
    this.ttsProvider = null;

    this.echoCanceller?.dispose();
    this.echoCanceller = null;

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.sanitizer.reset();
    this.state = 'IDLE';
  }
}

// localStorage keys
export const VOICE_DIALOG_KEYS = {
  enabled: 'voice-dialog-enabled',
  ttsKey: 'voice-dialog-tts-key',
  ttsVoice: 'voice-dialog-tts-voice',
  ttsModel: 'voice-dialog-tts-model',
  volume: 'voice-dialog-volume',
  bargeInThreshold: 'voice-dialog-barge-in-threshold',
  fillerKey: 'voice-dialog-filler-key',
  fillerModel: 'voice-dialog-filler-model',
  fillerUrl: 'voice-dialog-filler-url',
} as const;

/** Load voice dialog config from localStorage. Returns null if TTS key missing. */
export function loadVoiceDialogConfig(
  callbacks: Pick<VoiceDialogConfig, 'onStateChange' | 'onTranscript' | 'onTTSText' | 'onError'>,
): VoiceDialogConfig | null {
  const ttsKey = localStorage.getItem(VOICE_DIALOG_KEYS.ttsKey);
  if (!ttsKey) return null;

  return {
    ttsApiKey: ttsKey,
    ttsVoiceId: localStorage.getItem(VOICE_DIALOG_KEYS.ttsVoice) || '21m00Tcm4TlvDq8ikWAM',
    ttsModel: localStorage.getItem(VOICE_DIALOG_KEYS.ttsModel) || 'eleven_turbo_v2_5',
    fillerApiKey: localStorage.getItem(VOICE_DIALOG_KEYS.fillerKey) || undefined,
    fillerModel: localStorage.getItem(VOICE_DIALOG_KEYS.fillerModel) || 'llama-3.3-70b',
    fillerBaseUrl: localStorage.getItem(VOICE_DIALOG_KEYS.fillerUrl) || 'https://api.cerebras.ai/v1',
    ...callbacks,
    lang: localStorage.getItem('voice-lang') || 'en-US',
  };
}
