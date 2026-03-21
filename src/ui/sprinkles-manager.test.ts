import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SprinklesManager, DEFAULT_SPRINKLE_ACTIONS } from './sprinkles-manager.js';

describe('SprinklesManager', () => {
  let mgr: SprinklesManager;

  beforeEach(() => {
    mgr = new SprinklesManager();
  });

  describe('addAction / getActions', () => {
    it('adds an action and retrieves it', () => {
      mgr.addAction('scoop1', 'Run');
      const actions = mgr.getActions('scoop1');
      expect(actions).toHaveLength(1);
      expect(actions[0].label).toBe('Run');
      expect(actions[0].id).toBeTruthy();
    });

    it('returns empty array for unknown scoop', () => {
      expect(mgr.getActions('unknown')).toEqual([]);
    });

    it('accumulates multiple actions', () => {
      mgr.addAction('scoop1', 'Run');
      mgr.addAction('scoop1', 'Test');
      mgr.addAction('scoop1', 'Build');
      expect(mgr.getActions('scoop1')).toHaveLength(3);
      expect(mgr.getActions('scoop1').map(a => a.label)).toEqual(['Run', 'Test', 'Build']);
    });

    it('keeps scoop queues independent', () => {
      mgr.addAction('scoop1', 'Run');
      mgr.addAction('scoop2', 'Test');
      expect(mgr.getActions('scoop1')).toHaveLength(1);
      expect(mgr.getActions('scoop2')).toHaveLength(1);
    });
  });

  describe('removeAction', () => {
    it('removes a specific action by id', () => {
      mgr.addAction('s1', 'Run');
      mgr.addAction('s1', 'Test');
      const id = mgr.getActions('s1')[0].id;
      mgr.removeAction('s1', id);
      expect(mgr.getActions('s1')).toHaveLength(1);
      expect(mgr.getActions('s1')[0].label).toBe('Test');
    });

    it('does nothing for unknown action id', () => {
      mgr.addAction('s1', 'Run');
      mgr.removeAction('s1', 'nonexistent');
      expect(mgr.getActions('s1')).toHaveLength(1);
    });

    it('does nothing for unknown scoop', () => {
      mgr.removeAction('unknown', 'id');
      expect(mgr.getActions('unknown')).toEqual([]);
    });
  });

  describe('clear', () => {
    it('clears all pending actions for a scoop', () => {
      mgr.addAction('s1', 'Run');
      mgr.addAction('s1', 'Test');
      mgr.clear('s1');
      expect(mgr.getActions('s1')).toEqual([]);
      expect(mgr.hasPending('s1')).toBe(false);
    });

    it('does not affect other scoops', () => {
      mgr.addAction('s1', 'Run');
      mgr.addAction('s2', 'Test');
      mgr.clear('s1');
      expect(mgr.getActions('s2')).toHaveLength(1);
    });
  });

  describe('hasPending / pendingCount', () => {
    it('returns false/0 for empty scoop', () => {
      expect(mgr.hasPending('s1')).toBe(false);
      expect(mgr.pendingCount('s1')).toBe(0);
    });

    it('returns true/count after adding', () => {
      mgr.addAction('s1', 'A');
      mgr.addAction('s1', 'B');
      expect(mgr.hasPending('s1')).toBe(true);
      expect(mgr.pendingCount('s1')).toBe(2);
    });
  });

  describe('dispatch', () => {
    it('calls the dispatch handler with accumulated actions and clears them', () => {
      const handler = vi.fn();
      mgr.onDispatch(handler);
      mgr.addAction('s1', 'Run');
      mgr.addAction('s1', 'Test');

      mgr.dispatch('s1');

      expect(handler).toHaveBeenCalledTimes(1);
      const [jid, actions] = handler.mock.calls[0];
      expect(jid).toBe('s1');
      expect(actions).toHaveLength(2);
      expect(actions[0].label).toBe('Run');
      expect(actions[1].label).toBe('Test');

      // Queue should be cleared after dispatch
      expect(mgr.getActions('s1')).toEqual([]);
      expect(mgr.hasPending('s1')).toBe(false);
    });

    it('does nothing when queue is empty', () => {
      const handler = vi.fn();
      mgr.onDispatch(handler);
      mgr.dispatch('s1');
      expect(handler).not.toHaveBeenCalled();
    });

    it('works without a handler (no crash)', () => {
      mgr.addAction('s1', 'Run');
      expect(() => mgr.dispatch('s1')).not.toThrow();
      expect(mgr.getActions('s1')).toEqual([]);
    });
  });

  describe('onChange', () => {
    it('fires listener on addAction', () => {
      const listener = vi.fn();
      mgr.onChange(listener);
      mgr.addAction('s1', 'Run');
      expect(listener).toHaveBeenCalledWith('s1');
    });

    it('fires listener on removeAction', () => {
      mgr.addAction('s1', 'Run');
      const listener = vi.fn();
      mgr.onChange(listener);
      const id = mgr.getActions('s1')[0].id;
      mgr.removeAction('s1', id);
      expect(listener).toHaveBeenCalledWith('s1');
    });

    it('fires listener on clear', () => {
      mgr.addAction('s1', 'Run');
      const listener = vi.fn();
      mgr.onChange(listener);
      mgr.clear('s1');
      expect(listener).toHaveBeenCalledWith('s1');
    });

    it('fires listener on dispatch', () => {
      mgr.addAction('s1', 'Run');
      const listener = vi.fn();
      mgr.onChange(listener);
      mgr.dispatch('s1');
      expect(listener).toHaveBeenCalledWith('s1');
    });

    it('unsubscribes when returned function is called', () => {
      const listener = vi.fn();
      const unsub = mgr.onChange(listener);
      unsub();
      mgr.addAction('s1', 'Run');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('DEFAULT_SPRINKLE_ACTIONS', () => {
    it('has expected default actions', () => {
      expect(DEFAULT_SPRINKLE_ACTIONS.length).toBeGreaterThanOrEqual(4);
      const labels = DEFAULT_SPRINKLE_ACTIONS.map(a => a.label);
      expect(labels).toContain('Run');
      expect(labels).toContain('Test');
      expect(labels).toContain('Build');
    });
  });
});
