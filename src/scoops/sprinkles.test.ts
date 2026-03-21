/**
 * Tests for sprinkles — parsing SPRINKLE.md files, loading, and prompt compilation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';
import { VirtualFS } from '../fs/virtual-fs.js';
import { parseSprinkle, loadSprinkles, compileSprinklePrompt } from './sprinkles.js';
import type { QueuedAction, Sprinkle } from './sprinkles.js';

describe('Sprinkles', () => {
  describe('parseSprinkle', () => {
    it('parses a valid SPRINKLE.md with frontmatter and actions', () => {
      const content = `---
name: code-review
description: Code review actions
scoop: reviewer
---

# Code Review

## Actions

- **fix-lint**: Fix all lint errors in the changed files
- **add-types**: Add TypeScript type annotations to untyped functions
- **add-tests**: Write unit tests for uncovered functions
`;
      const result = parseSprinkle(content, '/skills/review/SPRINKLE.md');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('code-review');
      expect(result!.description).toBe('Code review actions');
      expect(result!.scoop).toBe('reviewer');
      expect(result!.actions).toHaveLength(3);
      expect(result!.actions[0]).toEqual({ id: 'fix-lint', label: 'Fix all lint errors in the changed files' });
      expect(result!.actions[1]).toEqual({ id: 'add-types', label: 'Add TypeScript type annotations to untyped functions' });
      expect(result!.actions[2]).toEqual({ id: 'add-tests', label: 'Write unit tests for uncovered functions' });
      expect(result!.context).toContain('# Code Review');
      expect(result!.path).toBe('/skills/review/SPRINKLE.md');
    });

    it('returns null when name is missing', () => {
      const content = `---
description: No name
---

## Actions

- **foo**: Do foo
`;
      expect(parseSprinkle(content, '/test.md')).toBeNull();
    });

    it('returns null when there are no actions', () => {
      const content = `---
name: empty
---

# Just some context, no actions section
`;
      expect(parseSprinkle(content, '/test.md')).toBeNull();
    });

    it('extracts context from non-Actions sections', () => {
      const content = `---
name: test
---

# Instructions

Follow these rules carefully.

## Actions

- **do-thing**: Do the thing

## Notes

Some extra notes.
`;
      const result = parseSprinkle(content, '/test.md');
      expect(result).not.toBeNull();
      expect(result!.context).toContain('# Instructions');
      expect(result!.context).toContain('Follow these rules carefully.');
      expect(result!.context).toContain('## Notes');
      expect(result!.context).toContain('Some extra notes.');
      expect(result!.context).not.toContain('do-thing');
    });

    it('handles content without frontmatter', () => {
      const content = `# No Frontmatter

## Actions

- **action1**: First action
`;
      // No frontmatter means no name, so should return null
      expect(parseSprinkle(content, '/test.md')).toBeNull();
    });

    it('handles optional scoop field', () => {
      const content = `---
name: global-actions
description: Available to all scoops
---

## Actions

- **summarize**: Summarize the current state
`;
      const result = parseSprinkle(content, '/test.md');
      expect(result).not.toBeNull();
      expect(result!.scoop).toBeUndefined();
    });
  });

  describe('loadSprinkles', () => {
    let vfs: VirtualFS;

    beforeAll(async () => {
      vfs = await VirtualFS.create({ dbName: 'test-sprinkles', wipe: true });
    });

    it('loads sprinkles from subdirectories', async () => {
      await vfs.mkdir('/skills/review', { recursive: true });
      await vfs.writeFile('/skills/review/SPRINKLE.md', `---
name: review
description: Review actions
---

## Actions

- **lint**: Fix lint errors
- **types**: Add types
`);
      const sprinkles = await loadSprinkles(vfs, '/skills');
      expect(sprinkles).toHaveLength(1);
      expect(sprinkles[0].name).toBe('review');
      expect(sprinkles[0].actions).toHaveLength(2);
    });

    it('filters by scoop name', async () => {
      await vfs.mkdir('/skills2/global', { recursive: true });
      await vfs.mkdir('/skills2/specific', { recursive: true });
      await vfs.writeFile('/skills2/global/SPRINKLE.md', `---
name: global
description: Global actions
---

## Actions

- **help**: Get help
`);
      await vfs.writeFile('/skills2/specific/SPRINKLE.md', `---
name: specific
description: Only for reviewer
scoop: reviewer
---

## Actions

- **review**: Do review
`);

      // With scoop name: gets global + matching
      const filtered = await loadSprinkles(vfs, '/skills2', 'reviewer');
      expect(filtered).toHaveLength(2);

      // With different scoop name: gets only global
      const other = await loadSprinkles(vfs, '/skills2', 'builder');
      expect(other).toHaveLength(1);
      expect(other[0].name).toBe('global');

      // Without scoop name: gets only global
      const noScoop = await loadSprinkles(vfs, '/skills2');
      expect(noScoop).toHaveLength(1);
      expect(noScoop[0].name).toBe('global');
    });

    it('returns empty array for missing directory', async () => {
      const result = await loadSprinkles(vfs, '/nonexistent');
      expect(result).toEqual([]);
    });

    it('skips directories without SPRINKLE.md', async () => {
      await vfs.mkdir('/skills3/no-sprinkle', { recursive: true });
      await vfs.writeFile('/skills3/no-sprinkle/SKILL.md', '---\nname: skill\n---\nJust a skill.');
      const result = await loadSprinkles(vfs, '/skills3');
      expect(result).toEqual([]);
    });
  });

  describe('compileSprinklePrompt', () => {
    const sprinkles: Sprinkle[] = [
      {
        name: 'code-review',
        description: 'Code review actions',
        context: 'Review all changed files carefully.',
        actions: [
          { id: 'fix-lint', label: 'Fix all lint errors' },
          { id: 'add-tests', label: 'Write unit tests' },
        ],
        path: '/skills/review/SPRINKLE.md',
      },
      {
        name: 'deploy',
        description: 'Deploy actions',
        context: '',
        actions: [
          { id: 'build', label: 'Build the project' },
        ],
        path: '/skills/deploy/SPRINKLE.md',
      },
    ];

    it('compiles a single action into a prompt', () => {
      const queue: QueuedAction[] = [
        { sprinkleName: 'code-review', actionId: 'fix-lint', label: 'Fix all lint errors' },
      ];
      const prompt = compileSprinklePrompt(queue, sprinkles);
      expect(prompt).toContain('Review all changed files carefully.');
      expect(prompt).toContain('[Sprinkle: code-review]');
      expect(prompt).toContain('1. Fix all lint errors');
    });

    it('compiles multiple actions from same sprinkle', () => {
      const queue: QueuedAction[] = [
        { sprinkleName: 'code-review', actionId: 'fix-lint', label: 'Fix all lint errors' },
        { sprinkleName: 'code-review', actionId: 'add-tests', label: 'Write unit tests' },
      ];
      const prompt = compileSprinklePrompt(queue, sprinkles);
      expect(prompt).toContain('1. Fix all lint errors');
      expect(prompt).toContain('2. Write unit tests');
    });

    it('compiles actions from multiple sprinkles', () => {
      const queue: QueuedAction[] = [
        { sprinkleName: 'code-review', actionId: 'fix-lint', label: 'Fix all lint errors' },
        { sprinkleName: 'deploy', actionId: 'build', label: 'Build the project' },
      ];
      const prompt = compileSprinklePrompt(queue, sprinkles);
      expect(prompt).toContain('[Sprinkle: code-review]');
      expect(prompt).toContain('[Sprinkle: deploy]');
      expect(prompt).toContain('Fix all lint errors');
      expect(prompt).toContain('Build the project');
    });

    it('skips context when empty', () => {
      const queue: QueuedAction[] = [
        { sprinkleName: 'deploy', actionId: 'build', label: 'Build the project' },
      ];
      const prompt = compileSprinklePrompt(queue, sprinkles);
      expect(prompt).not.toContain('Review all changed files');
      expect(prompt).toContain('[Sprinkle: deploy]');
    });
  });
});
