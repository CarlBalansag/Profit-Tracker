import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const guide = await import('../../shared/aiGuide.mjs');
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => harness.reset());

let nextId = 1;
const rpc = async (method, params) => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  return response.json();
};
async function callTool(name, args = {}) {
  const payload = await rpc('tools/call', { name, arguments: args });
  const result = payload.result;
  const text = result.content?.[0]?.text;
  return { isError: result.isError || false, data: text && !result.isError ? JSON.parse(text) : text };
}

// The harness connects every MCP request as API key "qa-api-key".
const KEY_ID = 'qa-api-key';
const addKey = (fields = {}) => {
  const key = { id: KEY_ID, user_id: harness.ids.user, name: 'Grok', key_hash: 'h', key_prefix: 'pt_live_', created_at: new Date(), last_used_at: null, revoked_at: null, allow_cashout_writes: false, ai_guide_version: null, ...fields };
  harness.db.apiKey.push(key);
  return key;
};
const key = () => harness.db.apiKey.find((k) => k.id === KEY_ID);

describe('server instructions', () => {
  it('tell a connecting AI the guide version and to call get_ai_guide', async () => {
    const payload = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'qa', version: '1' } });
    expect(payload.result.instructions).toContain(`version ${guide.AI_GUIDE_VERSION}`);
    expect(payload.result.instructions).toContain('get_ai_guide');
  });
});

describe('get_ai_guide', () => {
  it('gives a key that never read it the full guide, then remembers the version', async () => {
    addKey();
    const { data } = await callTool('get_ai_guide');
    expect(data).toMatchObject({ kind: 'full', current_version: guide.AI_GUIDE_VERSION, you_had: null });
    expect(data.text).toBe(guide.fullGuideText());
    expect(key().ai_guide_version).toBe(guide.AI_GUIDE_VERSION);
  });

  it('next time says up to date with almost nothing to read, and writes nothing', async () => {
    addKey({ ai_guide_version: guide.AI_GUIDE_VERSION });
    harness.calls.length = 0;
    const { data } = await callTool('get_ai_guide');
    expect(data.kind).toBe('up_to_date');
    expect(data.you_had).toBe(guide.AI_GUIDE_VERSION);
    expect(data.text.split(/\s+/).length).toBeLessThan(20);
    expect(harness.calls.filter((c) => c.model === 'apiKey' && c.op !== 'findFirst')).toEqual([]);
  });

  it('full: true returns the whole guide again even when up to date', async () => {
    addKey({ ai_guide_version: guide.AI_GUIDE_VERSION });
    const { data } = await callTool('get_ai_guide', { full: true });
    expect(data.kind).toBe('full');
    expect(data.text).toBe(guide.fullGuideText());
  });

  it('since overrides what the key remembers, and a version older than the guide gets the full guide', async () => {
    addKey();
    expect((await callTool('get_ai_guide', { since: guide.AI_GUIDE_VERSION })).data.kind).toBe('up_to_date');
    expect((await callTool('get_ai_guide', { since: '0.01' })).data.kind).toBe('full');
    expect(key().ai_guide_version).toBe(guide.AI_GUIDE_VERSION);
  });

  it('a remembered version from before the guide existed gets the full guide', async () => {
    addKey({ ai_guide_version: '0.50' });
    expect((await callTool('get_ai_guide')).data.kind).toBe('full');
    expect(key().ai_guide_version).toBe(guide.AI_GUIDE_VERSION);
  });

  it('rejects a malformed since', async () => {
    addKey();
    expect((await callTool('get_ai_guide', { since: 'latest' })).isError).toBe(true);
  });

  it('works without a stored key, and never reads or changes another user\'s key', async () => {
    const { data } = await callTool('get_ai_guide');
    expect(data.kind).toBe('full');
    harness.db.apiKey.push({ id: KEY_ID, user_id: harness.ids.other, ai_guide_version: null });
    await callTool('get_ai_guide');
    expect(harness.db.apiKey[0].ai_guide_version).toBeNull();
  });

  it('is not an Activity entry', async () => {
    addKey();
    await callTool('get_ai_guide');
    expect(harness.db.activityLog).toHaveLength(0);
  });
});

describe('the key list and rotation', () => {
  it('shows each key\'s guide version, and a rotated key keeps it', async () => {
    addKey({ ai_guide_version: guide.AI_GUIDE_VERSION });
    const list = await fetch(`${baseUrl}/api/api-keys`).then((r) => r.json());
    expect(list[0].ai_guide_version).toBe(guide.AI_GUIDE_VERSION);
    const rotated = await fetch(`${baseUrl}/api/api-keys/${KEY_ID}/rotate`, { method: 'POST' }).then((r) => r.json());
    expect(rotated.ai_guide_version).toBe(guide.AI_GUIDE_VERSION);
    expect(harness.db.apiKey.find((k) => k.id === rotated.id).ai_guide_version).toBe(guide.AI_GUIDE_VERSION);
  });
});

describe('catch-up note on tool results', () => {
  const rawCall = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;

  it('reminds an AI that has never read the guide, without changing the result itself', async () => {
    addKey();
    const result = await rawCall('list_expenses');
    expect(Array.isArray(JSON.parse(result.content[0].text))).toBe(true);
    expect(result.content).toHaveLength(2);
    expect(result.content[1].text).toContain("haven't read the Profit Tracker AI guide");
    expect(result.content[1].text).toContain('get_ai_guide');
  });

  it('tells an AI that is behind which versions, and stops once it calls get_ai_guide', async () => {
    addKey({ ai_guide_version: '1.01' });
    const behind = await rawCall('list_expenses');
    expect(behind.content[1].text).toContain(`you have 1.01, current is ${guide.AI_GUIDE_VERSION}`);
    const pulled = await rawCall('get_ai_guide');
    expect(pulled.content).toHaveLength(1);
    const after = await rawCall('list_expenses');
    expect(after.content).toHaveLength(1);
  });

  it('adds nothing for an AI on the current version', async () => {
    addKey({ ai_guide_version: guide.AI_GUIDE_VERSION });
    expect((await rawCall('list_expenses')).content).toHaveLength(1);
  });
});

describe('PATCH /api/api-keys/:id reset_ai_guide', () => {
  const patch = (id, body) => fetch(`${baseUrl}/api/api-keys/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('clears the key\'s version so get_ai_guide sends the whole guide, and logs it', async () => {
    addKey({ ai_guide_version: guide.AI_GUIDE_VERSION });
    const res = await patch(KEY_ID, { reset_ai_guide: true });
    expect(res.status).toBe(200);
    expect((await res.json()).ai_guide_version).toBeNull();
    expect(key().ai_guide_version).toBeNull();
    expect(harness.db.activityLog.at(-1)).toMatchObject({ record_type: 'api_key', record_id: KEY_ID });
    expect((await callTool('get_ai_guide')).data.kind).toBe('full');
  });

  it('can be sent with the cashout switch, keeps the switch rules, and refuses an empty change', async () => {
    addKey({ ai_guide_version: guide.AI_GUIDE_VERSION });
    expect((await patch(KEY_ID, { reset_ai_guide: true, allow_cashout_writes: true })).status).toBe(200);
    expect(key()).toMatchObject({ ai_guide_version: null, allow_cashout_writes: true });
    expect((await patch(KEY_ID, { allow_cashout_writes: 'yes' })).status).toBe(400);
    expect((await patch(KEY_ID, {})).status).toBe(400);
    expect((await patch(KEY_ID, { reset_ai_guide: false })).status).toBe(400);
  });

  it('refuses another user\'s key and a revoked key', async () => {
    harness.db.apiKey.push({ id: 'k-other', user_id: harness.ids.other, ai_guide_version: '1.45', revoked_at: null });
    expect((await patch('k-other', { reset_ai_guide: true })).status).toBe(404);
    expect(harness.db.apiKey.find((k) => k.id === 'k-other').ai_guide_version).toBe('1.45');
    addKey({ ai_guide_version: '1.45', revoked_at: new Date() });
    expect((await patch(KEY_ID, { reset_ai_guide: true })).status).toBe(409);
  });

  it('does not log a reset for a key that had not read the guide', async () => {
    addKey();
    const before = harness.db.activityLog.length;
    expect((await patch(KEY_ID, { reset_ai_guide: true })).status).toBe(200);
    expect(harness.db.activityLog).toHaveLength(before);
  });
});

describe('catching up from an older version', () => {
  it('a key on the previous version gets only the newer notes, then is current', async () => {
    const previous = guide.AI_GUIDE_UPDATES[1]?.version;
    if (!previous) return; // only meaningful once the guide has two versions
    addKey({ ai_guide_version: previous });
    const { data } = await callTool('get_ai_guide');
    expect(data).toMatchObject({ kind: 'updates', you_had: previous, current_version: guide.AI_GUIDE_VERSION });
    expect(data.text).toBe(guide.updatesSinceText(previous));
    for (const note of guide.AI_GUIDE_UPDATES[0].notes) expect(data.text).toContain(note);
    expect(data.text).not.toContain(guide.AI_GUIDE_UPDATES[1].notes[0]);
    expect(data.text.split(/\s+/).length).toBeLessThan(guide.fullGuideText().split(/\s+/).length / 5);
    expect(key().ai_guide_version).toBe(guide.AI_GUIDE_VERSION);
    expect((await callTool('get_ai_guide')).data.kind).toBe('up_to_date');
  });
});
