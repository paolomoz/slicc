/**
 * Scoops Panel - UI for managing conversation scoops.
 *
 * Provides:
 * - List of registered scoops
 * - Create/delete scoops
 * - Switch active scoop
 * - View scoop status
 * - Sprinkles: per-scoop action buttons that accumulate and dispatch as a single lick
 */

import type { RegisteredScoop, ScoopTabState } from '../scoops/types.js';
import { Orchestrator } from '../scoops/orchestrator.js';
import { SprinklesManager, DEFAULT_SPRINKLE_ACTIONS } from './sprinkles-manager.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('scoops-panel');

export interface ScoopsPanelCallbacks {
  /** Called when user selects a scoop */
  onScoopSelect: (scoop: RegisteredScoop) => void;
  /** Called when user sends a message to a scoop */
  onSendMessage: (scoopJid: string, text: string) => void;
}

export class ScoopsPanel {
  private container: HTMLElement;
  private orchestrator: Orchestrator | null = null;
  private callbacks: ScoopsPanelCallbacks;
  private selectedScoopJid: string | null = null;
  private scoopStatuses: Map<string, ScoopTabState['status']> = new Map();
  private sprinklesManager: SprinklesManager;
  private unsubSprinkles: (() => void) | null = null;

  constructor(container: HTMLElement, callbacks: ScoopsPanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.sprinklesManager = new SprinklesManager();
    this.render();

    // Re-render sprinkles UI when actions change
    this.unsubSprinkles = this.sprinklesManager.onChange((scoopJid) => {
      this.updateSprinklesUI(scoopJid);
    });
  }

  /** Get the sprinkles manager (for wiring dispatch handler in main.ts). */
  getSprinklesManager(): SprinklesManager {
    return this.sprinklesManager;
  }

  /** Set the orchestrator instance */
  setOrchestrator(orchestrator: Orchestrator): void {
    this.orchestrator = orchestrator;
    this.refreshScoops();
  }

  /** Update scoop status */
  updateScoopStatus(jid: string, status: ScoopTabState['status']): void {
    this.scoopStatuses.set(jid, status);
    this.refreshScoops();
  }

  /** Refresh the scoop list */
  refreshScoops(): void {
    if (!this.orchestrator) return;

    // Scoops first, cone last (cone holds the scoops)
    const allScoops = this.orchestrator.getScoops();
    const scoops = [...allScoops.filter(s => !s.isCone), ...allScoops.filter(s => s.isCone)];
    const listEl = this.container.querySelector('.scoops-list');
    if (!listEl) return;

    // Clear using safe DOM methods
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

    if (scoops.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'scoops-empty';
      empty.textContent = 'No scoops yet. Create one to start.';
      listEl.appendChild(empty);
      return;
    }

    for (const scoop of scoops) {
      const status = this.scoopStatuses.get(scoop.jid) ?? 'inactive';
      const isSelected = scoop.jid === this.selectedScoopJid;

      const item = document.createElement('div');
      item.className = `scoop-item ${isSelected ? 'selected' : ''} status-${status}`;
      item.dataset.jid = scoop.jid;

      // Top row: icon + info + delete
      const topRow = document.createElement('div');
      topRow.className = 'scoop-item__top';

      // Build DOM safely
      const iconEl = document.createElement('div');
      iconEl.className = scoop.isCone ? 'scoop-icon scoop-icon--cone' : 'scoop-icon scoop-icon--scoop';
      iconEl.textContent = scoop.isCone ? '\uD83C\uDF66' : '\uD83D\uDCA9';
      if (!scoop.isCone) {
        // Each scoop gets a unique hue based on its index
        const scoopIndex = scoops.filter(s => !s.isCone).indexOf(scoop);
        const hue = (scoopIndex * 72) % 360; // 72deg apart = 5 distinct colors before repeat
        iconEl.style.filter = `invert(0.85) sepia(1) saturate(4) hue-rotate(${hue}deg) brightness(1.05)`;
      }
      topRow.appendChild(iconEl);

      const infoEl = document.createElement('div');
      infoEl.className = 'scoop-info';

      const nameEl = document.createElement('div');
      nameEl.className = 'scoop-name';
      nameEl.textContent = scoop.assistantLabel;
      infoEl.appendChild(nameEl);

      const metaEl = document.createElement('div');
      metaEl.className = 'scoop-meta';

      const statusEl = document.createElement('span');
      statusEl.className = 'scoop-status';
      statusEl.textContent = status;
      metaEl.appendChild(statusEl);

      // Sprinkle pending count badge (next to status)
      if (!scoop.isCone) {
        const count = this.sprinklesManager.pendingCount(scoop.jid);
        if (count > 0) {
          const badge = document.createElement('span');
          badge.className = 'sprinkle-badge';
          badge.textContent = String(count);
          metaEl.appendChild(badge);
        }
      }

      infoEl.appendChild(metaEl);
      topRow.appendChild(infoEl);

      if (!scoop.isCone) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'scoop-delete';
        deleteBtn.title = 'Delete scoop';
        deleteBtn.textContent = '\u00d7';
        topRow.appendChild(deleteBtn);
      }

      item.appendChild(topRow);

      // Sprinkles section (non-cone scoops only)
      if (!scoop.isCone) {
        item.appendChild(this.createSprinklesSection(scoop));
      }

      topRow.addEventListener('click', (e) => {
        // Stop propagation so sprinkles clicks don't trigger selection
        if ((e.target as HTMLElement).closest('.scoop-delete')) {
          e.stopPropagation();
          this.deleteScoop(scoop.jid);
        } else {
          this.selectScoop(scoop);
        }
      });

      listEl.appendChild(item);
    }
  }

  /** Create the sprinkles section for a scoop item. */
  private createSprinklesSection(scoop: RegisteredScoop): HTMLElement {
    const section = document.createElement('div');
    section.className = 'sprinkles-section';
    section.dataset.scoopJid = scoop.jid;

    // Action buttons row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'sprinkles-actions';

    for (const action of DEFAULT_SPRINKLE_ACTIONS) {
      const btn = document.createElement('button');
      btn.className = 'sprinkle-action-btn';
      btn.textContent = action.label;
      btn.title = `Add "${action.label}" to pending actions`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sprinklesManager.addAction(scoop.jid, action.label);
      });
      actionsRow.appendChild(btn);
    }

    section.appendChild(actionsRow);

    // Pending pills + do-it / clear buttons
    const pendingRow = document.createElement('div');
    pendingRow.className = 'sprinkles-pending';
    pendingRow.dataset.scoopJid = scoop.jid;

    this.renderPendingPills(pendingRow, scoop.jid);
    section.appendChild(pendingRow);

    return section;
  }

  /** Render the pending action pills and do-it/clear buttons into the container. */
  private renderPendingPills(container: HTMLElement, scoopJid: string): void {
    while (container.firstChild) container.removeChild(container.firstChild);

    const actions = this.sprinklesManager.getActions(scoopJid);
    if (actions.length === 0) return;

    // Pills
    const pillsWrap = document.createElement('div');
    pillsWrap.className = 'sprinkles-pills';

    for (const action of actions) {
      const pill = document.createElement('span');
      pill.className = 'sprinkle-pill';

      const pillLabel = document.createElement('span');
      pillLabel.textContent = action.label;
      pill.appendChild(pillLabel);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'sprinkle-pill__remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove action';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sprinklesManager.removeAction(scoopJid, action.id);
      });
      pill.appendChild(removeBtn);

      pillsWrap.appendChild(pill);
    }

    container.appendChild(pillsWrap);

    // Buttons row
    const btnsRow = document.createElement('div');
    btnsRow.className = 'sprinkles-dispatch';

    const doItBtn = document.createElement('button');
    doItBtn.className = 'sprinkle-do-it-btn';
    doItBtn.textContent = 'Do it';
    doItBtn.title = 'Send all pending actions as a single lick';
    doItBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sprinklesManager.dispatch(scoopJid);
    });
    btnsRow.appendChild(doItBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'sprinkle-clear-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.title = 'Clear pending actions';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sprinklesManager.clear(scoopJid);
    });
    btnsRow.appendChild(clearBtn);

    container.appendChild(btnsRow);
  }

  /** Update only the sprinkles pending UI for a specific scoop (avoids full re-render). */
  private updateSprinklesUI(scoopJid: string): void {
    // Update pending row
    const pendingRow = this.container.querySelector(
      `.sprinkles-pending[data-scoop-jid="${scoopJid}"]`
    ) as HTMLElement | null;
    if (pendingRow) {
      this.renderPendingPills(pendingRow, scoopJid);
    }

    // Update badge in meta
    const scoopItem = this.container.querySelector(`.scoop-item[data-jid="${scoopJid}"]`);
    if (scoopItem) {
      const existingBadge = scoopItem.querySelector('.sprinkle-badge');
      const count = this.sprinklesManager.pendingCount(scoopJid);
      if (count > 0) {
        if (existingBadge) {
          existingBadge.textContent = String(count);
        } else {
          const metaEl = scoopItem.querySelector('.scoop-meta');
          if (metaEl) {
            const badge = document.createElement('span');
            badge.className = 'sprinkle-badge';
            badge.textContent = String(count);
            metaEl.appendChild(badge);
          }
        }
      } else {
        existingBadge?.remove();
      }
    }
  }

  /** Select a scoop */
  private selectScoop(scoop: RegisteredScoop): void {
    this.selectedScoopJid = scoop.jid;
    this.refreshScoops();
    this.callbacks.onScoopSelect(scoop);

    // Update URL state
    const url = new URL(window.location.href);
    if (scoop.isCone) {
      url.searchParams.delete('scoop');
    } else {
      url.searchParams.set('scoop', scoop.folder);
    }
    history.replaceState(null, '', url.toString());
  }

  /** Select scoop by folder name (for URL restoration) */
  selectScoopByFolder(folder: string): void {
    if (!this.orchestrator) return;
    const scoops = this.orchestrator.getScoops();
    const scoop = scoops.find(s => s.folder === folder);
    if (scoop) {
      this.selectScoop(scoop);
    }
  }

  /** Get selected scoop JID */
  getSelectedScoopJid(): string | null {
    return this.selectedScoopJid;
  }

  /** Delete a scoop */
  async deleteScoop(jid: string): Promise<void> {
    if (!this.orchestrator) return;

    const scoop = this.orchestrator.getScoop(jid);
    if (!scoop) return;

    if (scoop.isCone) {
      alert('Cannot delete the cone');
      return;
    }

    if (!confirm(`Delete scoop "${scoop.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await this.orchestrator.unregisterScoop(jid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(msg);
      return;
    }

    // Clear any pending sprinkles for the deleted scoop
    this.sprinklesManager.clear(jid);

    if (this.selectedScoopJid === jid) {
      this.selectedScoopJid = null;
    }

    this.refreshScoops();
    log.info('Scoop deleted', { jid, name: scoop.name });
  }

  /** Show create scoop dialog */
  private showCreateDialog(): void {
    const name = prompt('Enter scoop name:');
    if (!name?.trim()) return;

    this.createScoop(name.trim());
  }

  /** Create a new scoop */
  async createScoop(name: string, isCone = false): Promise<RegisteredScoop> {
    if (!this.orchestrator) {
      throw new Error('Orchestrator not set');
    }

    const folder = isCone ? 'cone' : this.sanitizeFolderName(name) + '-scoop';
    const jid = isCone ? `cone_${Date.now()}` : `scoop_${folder}_${Date.now()}`;

    const scoop: RegisteredScoop = {
      jid,
      name,
      folder,
      trigger: isCone ? undefined : `@${folder}`,
      requiresTrigger: !isCone,
      isCone,
      type: isCone ? 'cone' : 'scoop',
      assistantLabel: isCone ? 'sliccy' : folder,
      addedAt: new Date().toISOString(),
    };

    await this.orchestrator.registerScoop(scoop);
    this.refreshScoops();

    log.info('Scoop created', { jid, name, isCone });
    return scoop;
  }

  /** Sanitize a name into a valid folder name */
  private sanitizeFolderName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'scoop';
  }

  /** Render the panel */
  private render(): void {
    // Build DOM safely
    while (this.container.firstChild) this.container.removeChild(this.container.firstChild);

    const panel = document.createElement('div');
    panel.className = 'scoops-panel';

    const header = document.createElement('div');
    header.className = 'scoops-header';

    const title = document.createElement('h3');
    title.textContent = 'Scoops';
    header.appendChild(title);

    const addBtn = document.createElement('button');
    addBtn.className = 'scoops-add';
    addBtn.title = 'Create new scoop';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => this.showCreateDialog());
    header.appendChild(addBtn);

    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'scoops-list';
    panel.appendChild(list);

    this.container.appendChild(panel);

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .scoops-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #16162a;
        color: #e0e0e0;
      }

      .scoops-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid #2a2a4a;
      }

      .scoops-header h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }

      .scoops-add {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 4px;
        background: #e94560;
        color: white;
        font-size: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .scoops-add:hover {
        background: #ff6b8a;
      }

      .scoops-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }

      .scoops-empty {
        padding: 16px;
        text-align: center;
        color: #808090;
        font-size: 13px;
      }

      .scoop-item {
        display: flex;
        flex-direction: column;
        padding: 0;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.15s;
        margin-bottom: 4px;
      }

      .scoop-item__top {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
      }

      .scoop-item:hover {
        background: #1e1e3a;
      }

      .scoop-item.selected {
        background: #2a2a5a;
      }

      .scoop-icon {
        font-size: 20px;
        width: 32px;
        text-align: center;
      }

      .scoop-icon--cone {
        /* Clip off the ice cream ball, show only the cone */
        clip-path: polygon(0% 45%, 100% 45%, 100% 100%, 0% 100%);
        margin-top: -4px;
      }

      .scoop-icon--scoop {
        /* Per-scoop hue applied via inline style */
      }

      .scoop-info {
        flex: 1;
        min-width: 0;
      }

      .scoop-name {
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .scoop-meta {
        display: flex;
        gap: 8px;
        margin-top: 2px;
        font-size: 11px;
        color: #808090;
      }

      .scoop-status {
        padding: 1px 6px;
        border-radius: 3px;
        background: #2a2a4a;
      }

      .scoop-item.status-ready .scoop-status {
        background: #2d5a2d;
        color: #90ee90;
      }

      .scoop-item.status-processing .scoop-status {
        background: #5a5a2d;
        color: #eeee90;
      }

      .scoop-item.status-error .scoop-status {
        background: #5a2d2d;
        color: #ee9090;
      }

      .scoop-delete {
        width: 20px;
        height: 20px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: #808090;
        font-size: 16px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s, background 0.15s, color 0.15s;
      }

      .scoop-item:hover .scoop-delete {
        opacity: 1;
      }

      .scoop-delete:hover {
        background: #5a2d2d;
        color: #ee9090;
      }

      /* ── Sprinkles ─────────────────────────────────────── */

      .sprinkles-section {
        padding: 4px 12px 8px 44px; /* left indent to align under scoop name */
      }

      .sprinkles-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 4px;
      }

      .sprinkle-action-btn {
        padding: 2px 8px;
        border: 1px solid #3a3a5a;
        border-radius: 4px;
        background: #1e1e3a;
        color: #c0c0d0;
        font-size: 11px;
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s;
      }

      .sprinkle-action-btn:hover {
        background: #2a2a5a;
        border-color: #5a5a8a;
      }

      .sprinkle-badge {
        padding: 0 5px;
        border-radius: 8px;
        background: #e94560;
        color: white;
        font-size: 10px;
        font-weight: 600;
        min-width: 14px;
        text-align: center;
      }

      .sprinkles-pending {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .sprinkles-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
      }

      .sprinkle-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 6px;
        border-radius: 3px;
        background: #2d3a5a;
        color: #b0c0e0;
        font-size: 11px;
      }

      .sprinkle-pill__remove {
        border: none;
        background: transparent;
        color: #808090;
        font-size: 12px;
        cursor: pointer;
        padding: 0 1px;
        line-height: 1;
      }

      .sprinkle-pill__remove:hover {
        color: #ee9090;
      }

      .sprinkles-dispatch {
        display: flex;
        gap: 4px;
        margin-top: 2px;
      }

      .sprinkle-do-it-btn {
        padding: 3px 12px;
        border: none;
        border-radius: 4px;
        background: #e94560;
        color: white;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.12s;
      }

      .sprinkle-do-it-btn:hover {
        background: #ff6b8a;
      }

      .sprinkle-clear-btn {
        padding: 3px 8px;
        border: 1px solid #3a3a5a;
        border-radius: 4px;
        background: transparent;
        color: #808090;
        font-size: 11px;
        cursor: pointer;
        transition: background 0.12s, color 0.12s;
      }

      .sprinkle-clear-btn:hover {
        background: #2a2a4a;
        color: #c0c0d0;
      }
    `;
    this.container.appendChild(style);
  }

  /** Dispose the panel. */
  dispose(): void {
    this.unsubSprinkles?.();
  }
}
