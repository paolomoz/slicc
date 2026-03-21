/**
 * Chat Panel — message list + input area with streaming support.
 *
 * Displays user messages, assistant messages, and tool results.
 * Connects to an AgentHandle for sending messages and receiving events.
 */

import type { AgentHandle, AgentEvent, ChatMessage, ToolCall } from './types.js';
import { renderMessageContent, renderToolInput, escapeHtml } from './message-renderer.js';
import { SessionStore } from './session-store.js';
import { createLogger } from '../core/logger.js';
import { VoiceInput, getVoiceAutoSend, getVoiceLang } from './voice-input.js';
import { VoiceDialog, loadVoiceDialogConfig, VOICE_DIALOG_KEYS } from './voice-dialog/index.js';
import type { VoiceDialogState } from './voice-dialog/index.js';

const log = createLogger('chat-panel');

/** Generate a simple unique ID. */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Cycling face emojis for user messages */
const USER_FACES = ['😀', '😊', '🙂', '😄', '😎', '🤔', '😁', '🤗'];
let userFaceIndex = 0;

/** Get the next user face emoji (cycles through the list) */
function getNextUserFace(): string {
  const face = USER_FACES[userFaceIndex];
  userFaceIndex = (userFaceIndex + 1) % USER_FACES.length;
  return face;
}

/** Tool icons by name */
const TOOL_ICONS: Record<string, string> = {
  bash: '⚙️',
  browser: '🌐',
  read_file: '📖',
  write_file: '✏️',
  edit_file: '✏️',
  javascript: '📜',
  delegate_to_scoop: '🥄',
  send_message: '💬',
  schedule_task: '⏰',
  list_scoops: '📋',
  list_tasks: '📋',
  register_scoop: '🍨',
  update_global_memory: '🧠',
};

/** Get icon for a tool */
function getToolIcon(toolName: string): string {
  return TOOL_ICONS[toolName] ?? '🔧';
}

export class ChatPanel {
  private container: HTMLElement;
  private messagesEl!: HTMLElement;
  private inputArea!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private micBtn!: HTMLButtonElement;
  private voiceInput: VoiceInput | null = null;
  private voiceMode = false;
  private voiceDialog: VoiceDialog | null = null;
  private voiceDialogMode = false;
  private dialogBtn!: HTMLButtonElement;
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;
  private messages: ChatMessage[] = [];
  private agent: AgentHandle | null = null;
  private unsubscribe: (() => void) | null = null;
  private isStreaming = false;
  private currentStreamId: string | null = null;
  private sessionStore: SessionStore;
  private sessionId: string;
  private readOnly = false;
  private terminalOutputCallback: ((text: string) => void) | null = null;
  private currentScoopName: string | null = null; // null = cone, string = scoop name
  private autoScrollAttached = true;
  private lastScrollTop = 0;
  private jumpPill!: HTMLElement;
  private onDeleteQueuedMessage: ((messageId: string) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.sessionStore = new SessionStore();
    this.sessionId = 'default';
    this.render();
  }

  /** Wire up the agent handle. Can be called after construction. */
  setAgent(agent: AgentHandle): void {
    // Unsubscribe from previous agent
    this.unsubscribe?.();
    this.agent = agent;
    this.unsubscribe = agent.onEvent((ev) => this.handleAgentEvent(ev));
  }

  /** Set a callback for terminal output events. */
  onTerminalOutput(cb: (text: string) => void): void {
    this.terminalOutputCallback = cb;
  }

  /** Set a callback for deleting queued messages (removes from orchestrator DB + queue). */
  setDeleteQueuedMessageCallback(cb: (messageId: string) => void): void {
    this.onDeleteQueuedMessage = cb;
  }

  /** Initialize session persistence and restore messages. */
  async initSession(sessionId?: string): Promise<void> {
    await this.sessionStore.init();
    this.sessionId = sessionId ?? 'default';

    const session = await this.sessionStore.load(this.sessionId);
    if (session && session.messages.length > 0) {
      // Clear stale streaming state from previous session
      this.messages = session.messages.map((m) => ({
        ...m,
        isStreaming: false,
      }));
      this.renderMessages();
    }
  }

  /** Clear the current session and reset messages. */
  async clearSession(): Promise<void> {
    this.messages = [];
    this.renderMessages();
    await this.sessionStore.delete(this.sessionId);
  }

  /** Switch to a different scoop's chat context. */
  async switchToContext(contextId: string, readOnly: boolean, scoopName?: string): Promise<void> {
    // Save current session first
    await this.persistSessionAsync();

    // Reset streaming state — prevents stale isStreaming from a different scoop
    // from locking the input in the new context
    this.setStreamingState(false);
    this.currentStreamId = null;

    // Switch
    this.sessionId = contextId;
    this.currentScoopName = scoopName ?? null; // null means cone
    this.setReadOnly(readOnly);

    // Load the new session
    const session = await this.sessionStore.load(this.sessionId);
    if (session && session.messages.length > 0) {
      this.messages = session.messages.map((m) => ({
        ...m,
        isStreaming: false,
      }));
    } else {
      this.messages = [];
    }
    this.renderMessages();
  }

  /** Set read-only mode (hide input for non-cone scoops). */
  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    if (this.inputArea) {
      this.inputArea.style.display = readOnly ? 'none' : '';
    }
  }

  /** Persist session (async, awaitable). */
  private async persistSessionAsync(): Promise<void> {
    try {
      await this.sessionStore.saveMessages(this.sessionId, this.messages);
    } catch {
      // Silently ignore persistence errors
    }
  }

  /** Lock/unlock input based on external processing state (e.g., cone auto-activated by scoop notification). */
  setProcessing(busy: boolean): void {
    if (busy) {
      this.setStreamingState(true);
    } else {
      this.setStreamingState(false);
    }
  }

  /** Add a system message (for scoop summaries in cone chat). */
  addSystemMessage(content: string): void {
    const msg: ChatMessage = {
      id: uid(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    this.appendMessageEl(msg);
    this.persistSession();
  }

  /** Add a lick message (webhook/cron event). */
  addLickMessage(id: string, content: string, channel: 'webhook' | 'cron'): void {
    const msg: ChatMessage = {
      id,
      role: 'user',
      content,
      timestamp: Date.now(),
      source: 'lick',
      channel,
    };
    this.messages.push(msg);
    this.appendMessageEl(msg);
    this.persistSession();
  }

  /** Get current messages. */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /** Load a set of messages (from external buffer) and render them. */
  loadMessages(messages: ChatMessage[]): void {
    this.messages = messages.map(m => ({ ...m, isStreaming: false }));
    this.renderMessages();
    this.persistSession();
  }

  /** Clear all messages from the display (doesn't affect session store). */
  clear(): void {
    this.messages = [];
    this.renderMessages();
  }

  /** Add a user message to the display (for history loading). */
  addUserMessage(content: string): void {
    const msg: ChatMessage = {
      id: uid(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    this.appendMessageEl(msg);
  }

  /** Remove a queued message from the UI and notify the orchestrator to remove it from DB/queue. */
  private deleteQueuedMessage(messageId: string): void {
    const idx = this.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    this.messages.splice(idx, 1);
    const el = this.messagesEl.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) el.remove();
    this.persistSession();
    this.onDeleteQueuedMessage?.(messageId);
  }

  private render(): void {
    this.container.innerHTML = '';
    this.container.classList.add('chat');

    // Messages area
    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'chat__messages';
    this.container.appendChild(this.messagesEl);

    this.messagesEl.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      if (distanceFromBottom <= 250) {
        this.autoScrollAttached = true;
        this.hideJumpPill();
      } else if (scrollTop < this.lastScrollTop) {
        this.autoScrollAttached = false;
      }

      this.lastScrollTop = scrollTop;
    }, { passive: true });

    // Input area
    this.inputArea = document.createElement('div');
    const inputArea = this.inputArea;
    inputArea.className = 'chat__input-area';

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'chat__textarea';
    this.textarea.placeholder = 'Type a message... (Enter to send)';
    this.textarea.rows = 1;

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'chat__send-btn';
    this.sendBtn.innerHTML = '&#9654;'; // ▶
    this.sendBtn.title = 'Send message';

    this.stopBtn = document.createElement('button');
    this.stopBtn.className = 'chat__stop-btn';
    this.stopBtn.innerHTML = '&#9632;'; // ■
    this.stopBtn.title = 'Stop generation';
    this.stopBtn.style.display = 'none';

    this.micBtn = document.createElement('button');
    this.micBtn.className = 'chat__mic-btn';
    // Static SVG mic icon — safe, no user content
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path1 = document.createElementNS(svgNs, 'path');
    path1.setAttribute('d', 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z');
    const path2 = document.createElementNS(svgNs, 'path');
    path2.setAttribute('d', 'M19 10v2a7 7 0 0 1-14 0v-2');
    const line1 = document.createElementNS(svgNs, 'line');
    line1.setAttribute('x1', '12'); line1.setAttribute('y1', '19');
    line1.setAttribute('x2', '12'); line1.setAttribute('y2', '23');
    const line2 = document.createElementNS(svgNs, 'line');
    line2.setAttribute('x1', '8'); line2.setAttribute('y1', '23');
    line2.setAttribute('x2', '16'); line2.setAttribute('y2', '23');
    svg.append(path1, path2, line1, line2);
    this.micBtn.appendChild(svg);
    this.micBtn.title = 'Voice input (Ctrl+Shift+V)';

    // Voice dialog button (headphones icon)
    this.dialogBtn = document.createElement('button');
    this.dialogBtn.className = 'chat__dialog-btn';
    const dialogSvg = document.createElementNS(svgNs, 'svg');
    dialogSvg.setAttribute('width', '16');
    dialogSvg.setAttribute('height', '16');
    dialogSvg.setAttribute('viewBox', '0 0 24 24');
    dialogSvg.setAttribute('fill', 'none');
    dialogSvg.setAttribute('stroke', 'currentColor');
    dialogSvg.setAttribute('stroke-width', '2');
    dialogSvg.setAttribute('stroke-linecap', 'round');
    dialogSvg.setAttribute('stroke-linejoin', 'round');
    const headPath = document.createElementNS(svgNs, 'path');
    headPath.setAttribute('d', 'M3 18v-6a9 9 0 0 1 18 0v6');
    const leftEar = document.createElementNS(svgNs, 'path');
    leftEar.setAttribute('d', 'M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z');
    const rightEar = document.createElementNS(svgNs, 'path');
    rightEar.setAttribute('d', 'M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z');
    dialogSvg.append(headPath, leftEar, rightEar);
    this.dialogBtn.appendChild(dialogSvg);
    this.dialogBtn.title = 'Voice dialog (Ctrl+Shift+D)';

    inputArea.appendChild(this.textarea);
    inputArea.appendChild(this.micBtn);
    inputArea.appendChild(this.dialogBtn);
    inputArea.appendChild(this.sendBtn);
    inputArea.appendChild(this.stopBtn);
    this.container.appendChild(inputArea);

    // "New activity" pill — shown when auto-scroll is detached
    this.jumpPill = document.createElement('button');
    this.jumpPill.className = 'chat__jump-pill';
    this.jumpPill.textContent = '\u2193 New activity';
    this.jumpPill.addEventListener('click', () => {
      this.autoScrollAttached = true;
      this.hideJumpPill();
      this.scrollToBottom(true);
    });
    this.container.appendChild(this.jumpPill);

    // Event listeners
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.textarea.addEventListener('input', () => {
      // Auto-resize textarea
      this.textarea.style.height = 'auto';
      this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + 'px';
    });

    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.stopBtn.addEventListener('click', () => {
      this.agent?.stop();
      // Clear all remaining queued badges since these messages won't be processed
      for (const msg of this.messages) {
        if (msg.queued) {
          msg.queued = false;
          this.updateMessageEl(msg.id);
        }
      }
      this.setStreamingState(false);
    });

    // Voice input
    this.voiceInput = new VoiceInput({
      onTranscript: (text, _isFinal) => {
        this.textarea.value = text;
        this.textarea.style.height = 'auto';
        this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + 'px';
      },
      onStateChange: (state) => {
        if (state === 'error') {
          this.voiceMode = false;
          this.micBtn.classList.remove('chat__mic-btn--active', 'chat__mic-btn--listening');
        } else if (this.voiceMode) {
          // In voice mode, keep --listening on unless we're actively streaming
          // (streaming state manages the visual via setStreamingState).
          // Don't let transient idle states during stop→start flicker the button.
          if (state === 'listening') {
            this.micBtn.classList.add('chat__mic-btn--listening');
          }
          // Don't remove --listening on 'idle' in voice mode — setStreamingState handles it
        } else {
          this.micBtn.classList.toggle('chat__mic-btn--listening', state === 'listening');
        }
      },
      onError: (error) => {
        log.debug('Voice input error', { error });
        // In voice mode, suppress "no speech detected" — silence between turns is normal
        if (this.voiceMode && error.includes('No speech detected')) return;
        this.addSystemMessage(error);
      },
      autoSend: true, // always auto-send in voice mode
      onAutoSend: (text) => {
        this.textarea.value = text;
        this.sendMessage();
      },
      onAutoDisable: () => {
        this.voiceMode = false;
        this.micBtn.classList.remove('chat__mic-btn--active', 'chat__mic-btn--listening');
        this.addSystemMessage('Voice mode disabled after 2 minutes of inactivity.');
      },
      lang: getVoiceLang(),
    });

    this.micBtn.addEventListener('click', () => {
      this.toggleVoiceMode();
    });

    this.dialogBtn.addEventListener('click', () => {
      this.toggleVoiceDialogMode();
    });

    // Keyboard shortcuts: Ctrl+Shift+V (voice input), Ctrl+Shift+D (voice dialog)
    this.keydownListener = (e) => {
      if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'V') {
          e.preventDefault();
          this.toggleVoiceMode();
        } else if (e.key === 'D') {
          e.preventDefault();
          this.toggleVoiceDialogMode();
        }
      }
    };
    document.addEventListener('keydown', this.keydownListener);
  }

  private toggleVoiceMode(): void {
    this.voiceMode = !this.voiceMode;
    this.micBtn.classList.toggle('chat__mic-btn--active', this.voiceMode);
    if (this.voiceMode) {
      this.voiceInput?.start();
    } else {
      this.voiceInput?.stop();
    }
  }

  private toggleVoiceDialogMode(): void {
    this.voiceDialogMode = !this.voiceDialogMode;

    if (this.voiceDialogMode) {
      const config = loadVoiceDialogConfig({
        onStateChange: (state) => this.updateDialogButtonState(state),
        onTranscript: (text, isFinal) => {
          this.textarea.value = text;
          this.textarea.style.height = 'auto';
          this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + 'px';
        },
        onTTSText: (_text) => {
          // Could show spoken text in UI if desired
        },
        onError: (error) => {
          log.debug('Voice dialog error', { error });
          this.addSystemMessage(error);
        },
      });

      if (!config) {
        this.voiceDialogMode = false;
        this.addSystemMessage('Voice dialog requires an ElevenLabs API key. Set it in localStorage key "voice-dialog-tts-key".');
        return;
      }

      // Disable regular voice mode if active
      if (this.voiceMode) {
        this.voiceMode = false;
        this.micBtn.classList.remove('chat__mic-btn--active', 'chat__mic-btn--listening');
        this.voiceInput?.stop();
      }

      this.voiceDialog = new VoiceDialog(config);
      this.voiceDialog.start();
      this.updateDialogButtonState('LISTENING');
    } else {
      this.voiceDialog?.stop();
      this.voiceDialog = null;
      this.updateDialogButtonState('IDLE');
    }
  }

  private updateDialogButtonState(state: VoiceDialogState): void {
    this.dialogBtn.classList.remove(
      'chat__dialog-btn--active',
      'chat__dialog-btn--listening',
      'chat__dialog-btn--speaking',
      'chat__dialog-btn--filling',
    );

    switch (state) {
      case 'LISTENING':
        this.dialogBtn.classList.add('chat__dialog-btn--active', 'chat__dialog-btn--listening');
        break;
      case 'FILLING':
        this.dialogBtn.classList.add('chat__dialog-btn--active', 'chat__dialog-btn--filling');
        break;
      case 'SPEAKING':
        this.dialogBtn.classList.add('chat__dialog-btn--active', 'chat__dialog-btn--speaking');
        break;
      case 'IDLE':
      default:
        break;
    }
  }

  /** Get the VoiceDialog instance (for wiring tool events from main.ts). */
  getVoiceDialog(): VoiceDialog | null {
    return this.voiceDialog;
  }

  private sendMessage(): void {
    const text = this.textarea.value.trim();
    if (!text) return;

    // User action — always re-attach auto-scroll
    this.autoScrollAttached = true;
    this.hideJumpPill();

    const isQueued = this.isStreaming;
    const msg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      queued: isQueued || undefined,
    };
    this.messages.push(msg);
    this.appendMessageEl(msg);
    this.persistSession();

    // Clear input
    this.textarea.value = '';
    this.textarea.style.height = 'auto';

    // Only lock input if not already streaming (first message triggers streaming)
    if (!this.isStreaming) {
      this.setStreamingState(true);
    }

    // Send to agent (orchestrator persists & queues if the cone is busy)
    this.agent?.sendMessage(text, msg.id);

    // Notify voice dialog (starts filler immediately)
    this.voiceDialog?.onUserMessage(text);
  }

  private handleAgentEvent(event: AgentEvent): void {
    log.debug('Agent event', { type: event.type });
    switch (event.type) {
      case 'message_start':
        this.handleMessageStart(event.messageId);
        break;
      case 'content_delta':
        this.handleContentDelta(event.messageId, event.text);
        break;
      case 'content_done':
        this.handleContentDone(event.messageId);
        break;
      case 'tool_use_start':
        this.handleToolUseStart(event.messageId, event.toolName, event.toolInput);
        break;
      case 'tool_result':
        this.handleToolResult(event.messageId, event.toolName, event.result, event.isError);
        break;
      case 'turn_end':
        this.handleTurnEnd(event.messageId);
        break;
      case 'error':
        this.handleError(event.error);
        break;
      case 'screenshot':
        break;
      case 'terminal_output':
        this.terminalOutputCallback?.(event.text);
        break;
    }
  }

  private handleMessageStart(messageId: string): void {
    this.setStreamingState(true);
    this.currentStreamId = messageId;

    const msg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      toolCalls: [],
    };
    this.messages.push(msg);
    this.appendMessageEl(msg);
  }

  private handleContentDelta(messageId: string, text: string): void {
    const msg = this.findMessage(messageId);
    if (!msg) return;
    msg.content += text;
    this.updateMessageEl(messageId);

    // Feed streaming tokens to voice dialog for TTS
    this.voiceDialog?.feedToken(text);
  }

  private handleContentDone(messageId: string): void {
    const msg = this.findMessage(messageId);
    if (!msg) return;
    msg.isStreaming = false;
    this.updateMessageEl(messageId);
  }

  private handleToolUseStart(messageId: string, toolName: string, toolInput: unknown): void {
    const msg = this.findMessage(messageId);
    if (!msg) return;
    if (!msg.toolCalls) msg.toolCalls = [];
    msg.toolCalls.push({
      id: uid(),
      name: toolName,
      input: toolInput,
    });
    this.updateMessageEl(messageId);

    // Feed tool start to voice dialog filler
    if (this.voiceDialog && typeof toolInput === 'object' && toolInput !== null) {
      this.voiceDialog.feedToolStart(toolName, toolInput as Record<string, unknown>);
    }
  }

  private handleToolResult(messageId: string, toolName: string, result: string, isError?: boolean): void {
    const msg = this.findMessage(messageId);
    if (!msg || !msg.toolCalls) return;
    // Find the most recent tool call matching this name that has no result yet
    const tc = [...msg.toolCalls].reverse().find((t) => t.name === toolName && t.result === undefined);
    if (tc) {
      // Strip inline image data from stored result to avoid bloating conversation history.
      // The image is rendered by createToolCallEl from a transient property, not persisted.
      const imgMatch = result.match(/<img:(data:image\/[^>]+)>/);
      tc.result = result.replace(/<img:data:image\/[^>]+>/g, '').trim();
      if (imgMatch) {
        tc._screenshotDataUrl = imgMatch[1];
      }
      tc.isError = isError;
    }
    this.updateMessageEl(messageId);

    // Feed tool result to voice dialog filler
    const summary = result.length > 100 ? result.slice(0, 100) + '...' : result;
    this.voiceDialog?.feedToolResult(toolName, summary);
  }

  private handleTurnEnd(_messageId: string): void {
    this.setStreamingState(false);
    this.currentStreamId = null;
    this.persistSession();

    // Signal voice dialog that the response is complete
    this.voiceDialog?.endResponse();
  }

  private handleError(error: string): void {
    this.setStreamingState(false);
    this.currentStreamId = null;

    // If we have an active assistant message, append the error
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
      lastMsg.isStreaming = false;
      lastMsg.content += `\n\n**Error:** ${error}`;
      this.updateMessageEl(lastMsg.id);
    } else {
      // Show as a system-like error message
      const msg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: `**Error:** ${error}`,
        timestamp: Date.now(),
      };
      this.messages.push(msg);
      this.appendMessageEl(msg);
    }
    this.persistSession();
  }

  private setStreamingState(streaming: boolean): void {
    this.isStreaming = streaming;
    // Show stop button during streaming, send button otherwise — but keep textarea enabled
    this.stopBtn.style.display = streaming ? 'flex' : 'none';
    this.sendBtn.style.display = streaming ? 'none' : 'flex';
    // Textarea stays enabled so the user can queue follow-up messages
    this.textarea.disabled = false;
    // Mic button stays enabled during streaming so user can toggle voice mode off
    if (streaming) {
      if (this.voiceInput?.isListening()) {
        this.voiceInput.stop();
      }
      // In voice mode, explicitly remove listening visual during streaming
      this.micBtn.classList.remove('chat__mic-btn--listening');
      // When a new turn starts, clear the queued badge on only the oldest queued message
      // (it's the one being processed now). Leave the rest queued.
      const oldestQueued = this.messages.find(m => m.queued);
      if (oldestQueued) {
        oldestQueued.queued = false;
        this.updateMessageEl(oldestQueued.id);
      }
    }
    if (!streaming) {
      if (this.voiceMode) {
        // Voice mode: auto-restart listening when the agent finishes.
        // Pre-set the listening class to avoid a visual flicker during
        // the async getUserMedia → recognition start gap.
        this.micBtn.classList.add('chat__mic-btn--listening');
        this.voiceInput?.start();
      } else {
        this.textarea.focus();
      }
    }
  }

  private findMessage(id: string): ChatMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  // -- DOM rendering --

  private renderMessages(): void {
    this.messagesEl.innerHTML = '';
    for (const msg of this.messages) {
      const el = this.createMessageEl(msg);
      this.messagesEl.appendChild(el);
    }
    this.autoScrollAttached = true;
    this.hideJumpPill();
    this.scrollToBottom(true);
  }

  private appendMessageEl(msg: ChatMessage): void {
    const el = this.createMessageEl(msg);
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  private updateMessageEl(messageId: string): void {
    const msg = this.findMessage(messageId);
    if (!msg) return;
    const existing = this.messagesEl.querySelector(`[data-msg-id="${messageId}"]`);
    if (existing) {
      const newEl = this.createMessageEl(msg);
      existing.replaceWith(newEl);
    }
    this.scrollToBottom();
  }

  private createMessageEl(msg: ChatMessage): HTMLElement {
    // Licks (webhook/cron) get their own compact style like tool calls
    const isLick = msg.source === 'lick' || msg.channel === 'webhook' || msg.channel === 'cron';
    if (isLick) {
      const wrapper = document.createElement('div');
      wrapper.className = 'msg-group';
      wrapper.setAttribute('data-msg-id', msg.id);
      wrapper.appendChild(this.createLickEl(msg));
      return wrapper;
    }

    // Use a fragment-like wrapper for messages with tool calls
    // so tool calls appear outside the message bubble
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-group';
    wrapper.setAttribute('data-msg-id', msg.id);

    const el = document.createElement('div');
    el.className = `msg msg--${msg.role}${msg.queued ? ' msg--queued' : ''}`;

    // Determine icon and label based on role, source, and current context
    let icon: string;
    let label: string;
    const isInScoopThread = this.currentScoopName !== null;

    if (msg.role === 'user') {
      if (msg.source === 'delegation' || msg.channel === 'delegation') {
        // Delegation instructions from sliccy
        icon = '🥄';
        label = 'sliccy';
      } else {
        icon = getNextUserFace();
        label = 'You';
      }
    } else if (isInScoopThread) {
      // In a scoop thread, all assistant messages show the scoop icon/name
      icon = '💩';
      label = `@${this.currentScoopName}`;
    } else if (msg.source && msg.source !== 'cone') {
      // Scoop message in cone view
      icon = '💩';
      label = msg.source;
    } else {
      // Main agent (sliccy / cone)
      icon = '🍦';
      label = 'sliccy';
    }

    // Role label with icon
    const roleEl = document.createElement('div');
    roleEl.className = 'msg__role';
    roleEl.innerHTML = `<span class="msg__icon">${icon}</span> ${escapeHtml(label)}`;
    // Queued badge + delete button
    if (msg.queued) {
      const badge = document.createElement('span');
      badge.className = 'msg__queued-badge';
      badge.textContent = 'queued';
      roleEl.appendChild(badge);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'msg__queued-delete';
      deleteBtn.textContent = '\u00d7'; // ×
      deleteBtn.title = 'Remove queued message';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteQueuedMessage(msg.id);
      });
      roleEl.appendChild(deleteBtn);
    }
    el.appendChild(roleEl);

    // For lick messages in cone view, wrap content in collapsible
    const isLickInCone = (msg.source === 'lick' || msg.channel === 'webhook' || msg.channel === 'cron') && this.sessionId === 'session-cone';
    // For scoop messages in cone view, wrap in collapsible
    const isScoopInCone = msg.source && msg.source !== 'cone' && msg.source !== 'lick' && msg.role === 'assistant' && this.sessionId === 'session-cone';

    if (isLickInCone || isScoopInCone) {
      // Collapsed by default
      const details = document.createElement('details');
      details.className = 'msg__collapsible';

      const summary = document.createElement('summary');
      summary.className = 'msg__summary';
      const preview = msg.content.slice(0, 60).replace(/\n/g, ' ');
      summary.textContent = preview + (msg.content.length > 60 ? '...' : '');
      details.appendChild(summary);

      const contentEl = document.createElement('div');
      contentEl.className = 'msg__content';
      contentEl.innerHTML = renderMessageContent(msg.content);
      details.appendChild(contentEl);

      el.appendChild(details);
    } else {
      // Normal expanded content
      const contentEl = document.createElement('div');
      contentEl.className = 'msg__content';
      contentEl.innerHTML = renderMessageContent(msg.content);
      if (msg.isStreaming) {
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        contentEl.appendChild(cursor);
      }
      el.appendChild(contentEl);
    }

    // Only show the message bubble if there's actual content
    const hasContent = msg.content.trim().length > 0;
    if (hasContent) {
      wrapper.appendChild(el);
    }

    // Tool calls rendered outside the message bubble for compact display
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        wrapper.appendChild(this.createToolCallEl(tc));
      }
    }

    return wrapper;
  }

  /** Create a lick element (webhook/cron event) styled like tool calls */
  private createLickEl(msg: ChatMessage): HTMLElement {
    const el = document.createElement('details');
    el.className = 'lick';

    const channelType = msg.channel === 'webhook' ? 'Webhook' : msg.channel === 'cron' ? 'Cron' : 'Event';

    // Summary shows tongue emoji and type
    const summary = document.createElement('summary');
    summary.className = 'lick__header';
    summary.innerHTML = `<span class="lick__icon">👅</span> <span class="lick__type">${channelType}</span>`;

    // Add brief preview
    const preview = document.createElement('span');
    preview.className = 'lick__preview';
    // Extract a meaningful preview from the content
    const contentPreview = msg.content.replace(/\[Webhook Event:.*?\]\n```json\n?/s, '').slice(0, 50);
    preview.textContent = contentPreview.replace(/\n/g, ' ') + (contentPreview.length >= 50 ? '...' : '');
    summary.appendChild(preview);

    el.appendChild(summary);

    // Details content
    const details = document.createElement('div');
    details.className = 'lick__details';
    details.innerHTML = renderMessageContent(msg.content);
    el.appendChild(details);

    return el;
  }

  private createToolCallEl(tc: ToolCall): HTMLElement {
    const icon = getToolIcon(tc.name);

    // Use <details> for collapsible behavior - collapsed by default, expand on hover/click
    const el = document.createElement('details');
    el.className = 'tool-call';

    // Summary shows icon and tool name
    const summary = document.createElement('summary');
    summary.className = 'tool-call__header';
    summary.innerHTML = `<span class="tool-call__icon">${icon}</span> <span class="tool-call__name">${escapeHtml(tc.name)}</span>`;

    // Add brief input preview to summary
    if (tc.input !== undefined) {
      const preview = document.createElement('span');
      preview.className = 'tool-call__preview';
      const inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input);
      preview.textContent = inputStr.slice(0, 40) + (inputStr.length > 40 ? '...' : '');
      summary.appendChild(preview);
    }

    // Status indicator
    if (tc.result === undefined) {
      const spinner = document.createElement('span');
      spinner.className = 'tool-call__spinner';
      spinner.textContent = '⏳';
      summary.appendChild(spinner);
    } else if (tc.isError) {
      const errorIcon = document.createElement('span');
      errorIcon.className = 'tool-call__error-icon';
      errorIcon.textContent = '❌';
      summary.appendChild(errorIcon);
    } else {
      const checkIcon = document.createElement('span');
      checkIcon.className = 'tool-call__check-icon';
      checkIcon.textContent = '✅';
      summary.appendChild(checkIcon);
    }

    el.appendChild(summary);

    // Details content (shown on expand)
    const details = document.createElement('div');
    details.className = 'tool-call__details';

    if (tc.input !== undefined) {
      const inputEl = document.createElement('div');
      inputEl.className = 'tool-call__input';
      const inputLabel = document.createElement('div');
      inputLabel.className = 'tool-call__label';
      inputLabel.textContent = 'Input:';
      inputEl.appendChild(inputLabel);
      const inputCode = document.createElement('pre');
      inputCode.innerHTML = renderToolInput(tc.input);
      inputEl.appendChild(inputCode);
      details.appendChild(inputEl);
    }

    if (tc.result !== undefined) {
      const resultEl = document.createElement('div');
      resultEl.className = `tool-call__result${tc.isError ? ' tool-call__result--error' : ''}`;
      const resultLabel = document.createElement('div');
      resultLabel.className = 'tool-call__label';
      resultLabel.textContent = tc.isError ? 'Error:' : 'Result:';
      resultEl.appendChild(resultLabel);
      const resultPre = document.createElement('pre');
      resultPre.textContent = tc.result;
      resultEl.appendChild(resultPre);
      details.appendChild(resultEl);
    }

    // Render screenshot thumbnail from transient data (not persisted in messages)
    const screenshotUrl = tc._screenshotDataUrl;
    if (screenshotUrl) {
      const imgEl = document.createElement('img');
      imgEl.src = screenshotUrl;
      imgEl.className = 'tool-call__screenshot';
      imgEl.title = 'Click to view full size';
      imgEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const w = window.open('about:blank');
        if (w) {
          const fullImg = w.document.createElement('img');
          fullImg.src = screenshotUrl;
          w.document.title = 'Screenshot';
          w.document.body.style.margin = '0';
          w.document.body.style.background = '#1a1a2e';
          w.document.body.appendChild(fullImg);
        }
      });
      details.appendChild(imgEl);
    }

    el.appendChild(details);

    return el;
  }

  private scrollToBottom(force = false): void {
    if (!force && !this.autoScrollAttached) {
      this.showJumpPill();
      return;
    }
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      this.lastScrollTop = this.messagesEl.scrollTop;
    });
  }

  private showJumpPill(): void {
    this.jumpPill.classList.add('chat__jump-pill--visible');
  }

  private hideJumpPill(): void {
    this.jumpPill.classList.remove('chat__jump-pill--visible');
  }

  private persistSession(): void {
    // Fire-and-forget save
    this.sessionStore.saveMessages(this.sessionId, this.messages).catch(() => {
      // Silently ignore persistence errors
    });
  }

  /** Dispose the panel. */
  dispose(): void {
    this.unsubscribe?.();
    this.voiceInput?.destroy();
    this.voiceDialog?.stop();
    this.voiceDialog = null;
    if (this.keydownListener) {
      document.removeEventListener('keydown', this.keydownListener);
      this.keydownListener = null;
    }
    this.container.innerHTML = '';
  }
}
