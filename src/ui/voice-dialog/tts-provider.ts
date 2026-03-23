/**
 * TTS Provider — abstract interface + ElevenLabs WebSocket implementation.
 *
 * Text is sent incrementally as sentences arrive. Audio chunks are yielded
 * as ArrayBuffers for the AudioPlayer. A single WebSocket session is shared
 * between filler and Claude for seamless voice handover.
 */

import { createLogger } from '../../core/logger.js';

const log = createLogger('tts-provider');

export interface TTSProviderConfig {
  apiKey: string;
  voiceId: string;
  model: string;
}

export interface TTSProvider {
  connect(): Promise<void>;
  disconnect(): void;
  /** Send text to be synthesized. Audio chunks arrive via onAudio callback. */
  send(text: string): void;
  /** Flush remaining buffered text and signal end of input. */
  flush(): void;
  /** Cancel in-flight synthesis and discard pending chunks. */
  abort(): void;
  /** Whether the provider is connected. */
  isConnected(): boolean;
  /** Callback for receiving audio chunks. */
  onAudio: ((chunk: ArrayBuffer) => void) | null;
  /** Callback when all audio for a flush has been received. */
  onFlushComplete: (() => void) | null;
}

const KEEPALIVE_INTERVAL_MS = 15_000;

export class ElevenLabsTTSProvider implements TTSProvider {
  private config: TTSProviderConfig;
  private ws: WebSocket | null = null;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private _connected = false;

  onAudio: ((chunk: ArrayBuffer) => void) | null = null;
  onFlushComplete: (() => void) | null = null;

  constructor(config: TTSProviderConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.ws) this.disconnect();

    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}/stream-input?model_id=${this.config.model}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    return new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        // Send initial configuration
        ws.send(JSON.stringify({
          text: ' ',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          xi_api_key: this.config.apiKey,
        }));
        this._connected = true;
        this.startKeepalive();
        log.info('ElevenLabs WS connected');
        resolve();
      };

      ws.onerror = (e) => {
        log.error('ElevenLabs WS error', e);
        if (!this._connected) reject(new Error('WebSocket connection failed'));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.audio) {
            // Decode base64 audio to ArrayBuffer
            const binary = atob(data.audio);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            this.onAudio?.(bytes.buffer);
          }
          if (data.isFinal) {
            this.onFlushComplete?.();
          }
        } catch (err) {
          log.error('Failed to parse ElevenLabs message', err);
        }
      };

      ws.onclose = () => {
        this._connected = false;
        this.stopKeepalive();
        log.info('ElevenLabs WS closed');
      };
    });
  }

  disconnect(): void {
    this.stopKeepalive();
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WebSocket.OPEN) {
        // Send close signal
        try {
          this.ws.send(JSON.stringify({ text: '' }));
        } catch {}
        this.ws.close();
      }
      this.ws = null;
    }
    this._connected = false;
  }

  send(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot send — WS not open');
      return;
    }
    this.ws.send(JSON.stringify({ text }));
    this.resetKeepalive();
  }

  flush(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ text: '', flush: true }));
    this.resetKeepalive();
  }

  abort(): void {
    // Disconnect and discard everything
    this.disconnect();
  }

  isConnected(): boolean {
    return this._connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Update config (e.g., after settings change). Requires reconnect. */
  updateConfig(config: Partial<TTSProviderConfig>): void {
    Object.assign(this.config, config);
  }

  // --- Keepalive ---

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ text: ' ' }));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private resetKeepalive(): void {
    this.stopKeepalive();
    this.startKeepalive();
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }
}
