/**
 * Sprinkles — per-scoop batch action buttons parsed from SPRINKLE.md files.
 *
 * Sprinkles let users accumulate actions into a batch, then send them all
 * as a single lick prompt. Think shopping cart: click actions to add them,
 * review the list, hit "Do it" to send everything at once.
 */

import { createLogger } from '../core/logger.js';
import type { VirtualFS } from '../fs/index.js';

const log = createLogger('sprinkles');

/** A single action button within a sprinkle */
export interface SprinkleAction {
  id: string;
  label: string;
}

/** A sprinkle definition (parsed from SPRINKLE.md) */
export interface Sprinkle {
  name: string;
  description: string;
  scoop?: string;
  context: string;
  actions: SprinkleAction[];
  path: string;
}

/** A queued action in the client-side batch */
export interface QueuedAction {
  sprinkleName: string;
  actionId: string;
  label: string;
}

interface SprinkleFrontmatter {
  name?: string;
  description?: string;
  scoop?: string;
}

/**
 * Parse YAML frontmatter from a SPRINKLE.md file.
 */
function parseFrontmatter(content: string): { metadata: SprinkleFrontmatter; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: content };
  }

  const [, yamlStr, body] = match;
  const metadata: SprinkleFrontmatter = {};

  for (const line of yamlStr.split('\n')) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    const trimmed = value.trim();
    switch (key) {
      case 'name': metadata.name = trimmed; break;
      case 'description': metadata.description = trimmed; break;
      case 'scoop': metadata.scoop = trimmed; break;
    }
  }

  return { metadata, body };
}

/**
 * Parse action lines from the markdown body.
 * Each `- **<id>**: <description>` in an `## Actions` section becomes an action.
 */
function parseActions(body: string): { actions: SprinkleAction[]; context: string } {
  const lines = body.split('\n');
  const actions: SprinkleAction[] = [];
  const contextLines: string[] = [];
  let inActionsSection = false;

  for (const line of lines) {
    // Detect ## Actions header
    if (/^##\s+Actions\s*$/i.test(line)) {
      inActionsSection = true;
      continue;
    }

    // A new ## section ends the Actions section
    if (inActionsSection && /^##\s+/.test(line)) {
      inActionsSection = false;
      contextLines.push(line);
      continue;
    }

    if (inActionsSection) {
      const actionMatch = line.match(/^-\s+\*\*([^*]+)\*\*:\s*(.+)$/);
      if (actionMatch) {
        actions.push({ id: actionMatch[1].trim(), label: actionMatch[2].trim() });
      }
    } else {
      contextLines.push(line);
    }
  }

  return { actions, context: contextLines.join('\n').trim() };
}

/**
 * Parse a single SPRINKLE.md file into a Sprinkle.
 * Returns null if the file is missing required fields or has no actions.
 */
export function parseSprinkle(content: string, path: string): Sprinkle | null {
  const { metadata, body } = parseFrontmatter(content);

  if (!metadata.name) {
    log.debug('Sprinkle missing name', { path });
    return null;
  }

  const { actions, context } = parseActions(body);

  if (actions.length === 0) {
    log.debug('Sprinkle has no actions', { path, name: metadata.name });
    return null;
  }

  return {
    name: metadata.name,
    description: metadata.description || '',
    scoop: metadata.scoop,
    context,
    actions,
    path,
  };
}

/**
 * Load sprinkles from a skills directory in VirtualFS.
 * Optionally filter by scoop name (returns global + scoop-specific sprinkles).
 */
export async function loadSprinkles(fs: VirtualFS, skillsDir: string, scoopName?: string): Promise<Sprinkle[]> {
  const sprinkles: Sprinkle[] = [];

  try {
    const entries = await fs.readDir(skillsDir);

    for (const entry of entries) {
      if (entry.type === 'directory') {
        const sprinklePath = `${skillsDir}/${entry.name}/SPRINKLE.md`;
        try {
          const content = await fs.readFile(sprinklePath, { encoding: 'utf-8' });
          const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
          const sprinkle = parseSprinkle(text, sprinklePath);
          if (sprinkle) {
            sprinkles.push(sprinkle);
          }
        } catch {
          // No SPRINKLE.md in this directory
        }
      }
    }
  } catch {
    log.debug('Skills directory not found', { dir: skillsDir });
  }

  // Filter: include global sprinkles (no scoop field) + scoop-specific matches
  const filtered = scoopName
    ? sprinkles.filter(s => !s.scoop || s.scoop === scoopName)
    : sprinkles.filter(s => !s.scoop);

  log.info('Sprinkles loaded', { count: filtered.length, dir: skillsDir, scoopName });
  return filtered;
}

/**
 * Compile queued actions into a single prompt string.
 */
export function compileSprinklePrompt(queue: QueuedAction[], sprinkles: Sprinkle[]): string {
  // Group actions by sprinkle
  const grouped = new Map<string, QueuedAction[]>();
  for (const action of queue) {
    const list = grouped.get(action.sprinkleName) || [];
    list.push(action);
    grouped.set(action.sprinkleName, list);
  }

  const parts: string[] = [];

  for (const [sprinkleName, actions] of grouped) {
    const sprinkle = sprinkles.find(s => s.name === sprinkleName);

    // Include context if present
    if (sprinkle?.context) {
      parts.push(sprinkle.context);
      parts.push('');
    }

    parts.push(`[Sprinkle: ${sprinkleName}]`);
    parts.push('Please perform the following actions:');
    parts.push('');
    actions.forEach((a, i) => {
      parts.push(`${i + 1}. ${a.label}`);
    });
  }

  return parts.join('\n');
}
