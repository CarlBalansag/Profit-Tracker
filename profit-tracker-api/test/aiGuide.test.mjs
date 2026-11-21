// Keeps the AI guide (shared/aiGuide.mjs, copied from
// Settings > AI Assistant) in step with the MCP server. If this fails after
// adding, renaming or removing a tool, update the guide body and add an
// AI_GUIDE_UPDATES entry -- see AGENTS.md "AI guide".
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const guide = await import('../../shared/aiGuide.mjs');
const { CHANGELOG } = await import('../../profit-tracker-app/src/data/changelog.js');
const mcpSource = readFileSync(join(here, '../routes/mcp.js'), 'utf8');
const registered = [...mcpSource.matchAll(/registerTool\('([a-z_]+)'/g)].map((m) => m[1]);

// Words in the guide that are written like tool names.
const TOOL_PREFIX = /^(list|get|add|update|delete|void|mark|set|search|find|reconcile|match|sync|commit|submit|log|undo|data)_[a-z_]+$/;
const FIELD_NAMES = new Set(['set_market_value']); // a tool, listed for clarity

describe('AI guide stays in step with the MCP tools', () => {
  it('finds the MCP tools at all', () => {
    expect(registered.length).toBeGreaterThan(40);
  });

  it('mentions every registered tool', () => {
    const missing = registered.filter((name) => !new RegExp(`\\b${name}\\b`).test(guide.AI_GUIDE_BODY));
    expect(missing, `Add these tools to AI_GUIDE_BODY: ${missing.join(', ')}`).toEqual([]);
  });

  it('names no tool that does not exist', () => {
    const words = new Set(guide.AI_GUIDE_BODY.match(/\b[a-z]+(?:_[a-z]+)+\b/g) || []);
    const toolish = [...words].filter((w) => TOOL_PREFIX.test(w) || FIELD_NAMES.has(w));
    const known = new Set(registered);
    const stale = toolish.filter((w) => !known.has(w));
    expect(stale, `AI_GUIDE_BODY names tools that are gone: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('AI guide versions', () => {
  const versions = guide.AI_GUIDE_UPDATES.map((u) => u.version);

  it('the guide version is the newest update', () => {
    expect(guide.AI_GUIDE_VERSION).toBe(versions[0]);
  });

  it('updates are newest first, each version once, each with notes', () => {
    const numbers = versions.map(Number.parseFloat);
    expect([...numbers].sort((a, b) => b - a)).toEqual(numbers);
    expect(new Set(versions).size).toBe(versions.length);
    for (const u of guide.AI_GUIDE_UPDATES) {
      expect(u.notes.length, `${u.version} has no notes`).toBeGreaterThan(0);
      expect(u.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every guide version is a What\'s New version', () => {
    const released = new Set(CHANGELOG.map((c) => c.version));
    const unknown = versions.filter((v) => !released.has(v));
    expect(unknown, `Guide versions not in changelog.js: ${unknown.join(', ')}`).toEqual([]);
  });
});
