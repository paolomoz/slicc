/**
 * Sprinkles Manager — accumulates user-clicked actions per scoop and dispatches
 * them as a single lick when the user clicks "do it".
 *
 * Instead of each button firing a separate lick immediately, buttons add actions
 * to a client-side queue. The "do it" button sends all accumulated actions as one
 * sprinkle lick to the target scoop.
 */

import type { SprinkleAction } from '../scoops/lick-manager.js';

/** Default sprinkle actions available on every scoop. */
export const DEFAULT_SPRINKLE_ACTIONS: readonly { id: string; label: string }[] = [
  { id: 'run', label: 'Run' },
  { id: 'test', label: 'Test' },
  { id: 'build', label: 'Build' },
  { id: 'lint', label: 'Lint' },
  { id: 'fix', label: 'Fix' },
  { id: 'review', label: 'Review' },
] as const;

export type SprinkleDispatchHandler = (scoopJid: string, actions: SprinkleAction[]) => void;

export class SprinklesManager {
  /** Pending actions per scoop JID. */
  private queues = new Map<string, SprinkleAction[]>();
  private dispatchHandler: SprinkleDispatchHandler | null = null;
  private changeListeners = new Set<(scoopJid: string) => void>();

  /** Register the handler that will be called when the user clicks "do it". */
  onDispatch(handler: SprinkleDispatchHandler): void {
    this.dispatchHandler = handler;
  }

  /** Listen for changes to a scoop's pending actions (for UI updates). */
  onChange(listener: (scoopJid: string) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Add an action to a scoop's pending queue. */
  addAction(scoopJid: string, label: string): void {
    const queue = this.queues.get(scoopJid) ?? [];
    const action: SprinkleAction = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label,
    };
    queue.push(action);
    this.queues.set(scoopJid, queue);
    this.notifyChange(scoopJid);
  }

  /** Remove a specific pending action by its id. */
  removeAction(scoopJid: string, actionId: string): void {
    const queue = this.queues.get(scoopJid);
    if (!queue) return;
    const idx = queue.findIndex(a => a.id === actionId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      if (queue.length === 0) {
        this.queues.delete(scoopJid);
      }
      this.notifyChange(scoopJid);
    }
  }

  /** Get the pending actions for a scoop. */
  getActions(scoopJid: string): SprinkleAction[] {
    return this.queues.get(scoopJid) ?? [];
  }

  /** Clear all pending actions for a scoop. */
  clear(scoopJid: string): void {
    if (this.queues.has(scoopJid)) {
      this.queues.delete(scoopJid);
      this.notifyChange(scoopJid);
    }
  }

  /** Dispatch all pending actions for a scoop as a single sprinkle lick, then clear. */
  dispatch(scoopJid: string): void {
    const queue = this.queues.get(scoopJid);
    if (!queue || queue.length === 0) return;
    const actions = [...queue];
    this.queues.delete(scoopJid);
    this.notifyChange(scoopJid);
    this.dispatchHandler?.(scoopJid, actions);
  }

  /** Check if a scoop has any pending actions. */
  hasPending(scoopJid: string): boolean {
    const queue = this.queues.get(scoopJid);
    return !!queue && queue.length > 0;
  }

  /** Get the count of pending actions for a scoop. */
  pendingCount(scoopJid: string): number {
    return this.queues.get(scoopJid)?.length ?? 0;
  }

  private notifyChange(scoopJid: string): void {
    for (const listener of this.changeListeners) {
      listener(scoopJid);
    }
  }
}
