/**
 * SprinkleBar — UI component for batch action buttons.
 *
 * Renders action buttons from loaded sprinkles above the chat textarea.
 * Users click buttons to toggle actions in a queue, then "Do it" to send
 * the entire batch as a single prompt.
 */

import type { Sprinkle, QueuedAction } from '../scoops/sprinkles.js';
import { compileSprinklePrompt } from '../scoops/sprinkles.js';
import { escapeHtml } from './message-renderer.js';

export class SprinkleBar {
  private container: HTMLElement;
  private sprinkles: Sprinkle[] = [];
  private queue: QueuedAction[] = [];
  private doItCallback: ((prompt: string) => void) | null = null;
  private buttonsEl!: HTMLElement;
  private queueEl!: HTMLElement;
  private doItBtn!: HTMLButtonElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  /** Set available sprinkles and re-render buttons. */
  setSprinkles(sprinkles: Sprinkle[]): void {
    this.sprinkles = sprinkles;
    this.queue = [];
    this.renderButtons();
    this.renderQueue();
  }

  /** Register callback for when "Do it" is clicked. */
  onDoIt(callback: (prompt: string) => void): void {
    this.doItCallback = callback;
  }

  /** Clear the queue. */
  clear(): void {
    this.queue = [];
    this.renderButtons();
    this.renderQueue();
  }

  /** Show the sprinkle bar. */
  show(): void {
    this.container.style.display = '';
  }

  /** Hide the sprinkle bar. */
  hide(): void {
    this.container.style.display = 'none';
  }

  private render(): void {
    this.container.className = 'sprinkle-bar';

    this.buttonsEl = document.createElement('div');
    this.buttonsEl.className = 'sprinkle-bar__buttons';
    this.container.appendChild(this.buttonsEl);

    this.queueEl = document.createElement('div');
    this.queueEl.className = 'sprinkle-bar__queue';
    this.container.appendChild(this.queueEl);

    this.doItBtn = document.createElement('button');
    this.doItBtn.className = 'sprinkle-bar__do-it';
    this.doItBtn.textContent = 'Do it';
    this.doItBtn.addEventListener('click', () => this.handleDoIt());
    this.container.appendChild(this.doItBtn);

    this.renderQueue();
  }

  private renderButtons(): void {
    this.buttonsEl.innerHTML = '';

    for (const sprinkle of this.sprinkles) {
      // Group label
      if (this.sprinkles.length > 1) {
        const label = document.createElement('span');
        label.className = 'sprinkle-bar__group-label';
        label.textContent = sprinkle.name;
        this.buttonsEl.appendChild(label);
      }

      for (const action of sprinkle.actions) {
        const btn = document.createElement('button');
        btn.className = 'sprinkle-bar__action';
        const isQueued = this.queue.some(
          q => q.sprinkleName === sprinkle.name && q.actionId === action.id
        );
        if (isQueued) {
          btn.classList.add('sprinkle-bar__action--active');
        }
        btn.textContent = action.label;
        btn.title = `${sprinkle.name}: ${action.label}`;
        btn.addEventListener('click', () => this.toggleAction(sprinkle.name, action));
        this.buttonsEl.appendChild(btn);
      }
    }
  }

  private renderQueue(): void {
    this.queueEl.innerHTML = '';

    if (this.queue.length === 0) {
      this.queueEl.style.display = 'none';
      this.doItBtn.style.display = 'none';
      return;
    }

    this.queueEl.style.display = '';
    this.doItBtn.style.display = '';

    for (const item of this.queue) {
      const el = document.createElement('div');
      el.className = 'sprinkle-bar__queue-item';

      const text = document.createElement('span');
      text.textContent = item.label;
      el.appendChild(text);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'sprinkle-bar__queue-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Remove from queue';
      removeBtn.addEventListener('click', () => {
        this.queue = this.queue.filter(
          q => !(q.sprinkleName === item.sprinkleName && q.actionId === item.actionId)
        );
        this.renderButtons();
        this.renderQueue();
      });
      el.appendChild(removeBtn);

      this.queueEl.appendChild(el);
    }
  }

  private toggleAction(sprinkleName: string, action: { id: string; label: string }): void {
    const idx = this.queue.findIndex(
      q => q.sprinkleName === sprinkleName && q.actionId === action.id
    );
    if (idx >= 0) {
      this.queue.splice(idx, 1);
    } else {
      this.queue.push({ sprinkleName, actionId: action.id, label: action.label });
    }
    this.renderButtons();
    this.renderQueue();
  }

  private handleDoIt(): void {
    if (this.queue.length === 0) return;
    const prompt = compileSprinklePrompt(this.queue, this.sprinkles);
    this.doItCallback?.(prompt);
    this.clear();
  }
}
