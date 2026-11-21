// Expense.external_id against real Postgres: the migration has to add the
// column and the per-user unique index, and two imports of the same statement
// line at the same moment must still leave one expense -- a race the
// in-memory harness's pre-check can't show.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

let pg, prisma, server, base, user, other, card;

const freePort = async () => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
};
const post = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
let rpcId = 1;
const callTool = async (name, args) => {
  const { body } = await post('/mcp', { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } });
  const text = body.result?.content?.[0]?.text;
  return { isError: Boolean(body.result?.isError), data: text && !body.result.isError ? JSON.parse(text) : text };
};

describe('expense external_id on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-extid-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('extid_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/extid_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'extid-qa@example.test' } });
    other = await prisma.user.create({ data: { email: 'extid-other@example.test' } });
    card = await prisma.paymentMethod.create({ data: { user_id: user.id, name: 'QA Card', type: 'Credit' } });

    require.cache[require.resolve('../prisma.js')] = { id: 'prisma', filename: require.resolve('../prisma.js'), loaded: true, exports: prisma };
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; req.apiKeyId = null; next(); });
    app.use('/api/expenses', require('../routes/expenses.js'));
    app.use('/mcp', require('../routes/mcp.js'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    if (pg) await pg.stop();
  });

  it('the database itself refuses a second expense with the same id for one user, but not for another user or for NULL', async () => {
    const row = { name: 'X', amount: 1, date: new Date(), external_id: 'db-1' };
    await prisma.expense.create({ data: { ...row, user_id: user.id } });
    await expect(prisma.expense.create({ data: { ...row, user_id: user.id } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.expense.create({ data: { ...row, user_id: other.id } })).resolves.toBeTruthy();
    await prisma.expense.create({ data: { ...row, user_id: user.id, external_id: null } });
    await expect(prisma.expense.create({ data: { ...row, user_id: user.id, external_id: null } })).resolves.toBeTruthy();
  });

  it('two website saves of the same id at once: one is saved, the other gets 409', async () => {
    const body = { name: 'Race', amount: 5, date: '2026-10-01', external_id: 'race-web' };
    const results = await Promise.all([post('/api/expenses', body), post('/api/expenses', body), post('/api/expenses', body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await prisma.expense.count({ where: { user_id: user.id, external_id: 'race-web' } })).toBe(1);
  });

  it('several MCP imports of the same line at once all return the one expense', async () => {
    const args = { description: 'Race', amount: 5, date: '2026-10-01', paid_from_account: 'QA Card', external_id: 'race-mcp' };
    const results = await Promise.all([1, 2, 3, 4].map(() => callTool('add_expense', args)));
    expect(results.every((r) => !r.isError)).toBe(true);
    const rows = await prisma.expense.findMany({ where: { user_id: user.id, external_id: 'race-mcp' } });
    expect(rows).toHaveLength(1);
    expect(new Set(results.map((r) => r.data.id))).toEqual(new Set([rows[0].id]));
    expect(results.filter((r) => r.data.already_recorded === false)).toHaveLength(1);
    // Exactly one Activity entry, for the one that was really added.
    expect(await prisma.activityLog.count({ where: { user_id: user.id, record_id: rows[0].id } })).toBe(1);
  });

  it('update_expense onto a taken id is refused and leaves both rows as they were', async () => {
    const { data: a } = await callTool('add_expense', { description: 'A', amount: 1, date: '2026-10-02', paid_from_account: 'QA Card', external_id: 'up-a' });
    const { data: b } = await callTool('add_expense', { description: 'B', amount: 2, date: '2026-10-02', paid_from_account: 'QA Card' });
    const res = await callTool('update_expense', { expense_id: b.id, external_id: 'up-a' });
    expect(res.isError).toBe(true);
    expect((await prisma.expense.findUnique({ where: { id: b.id } })).external_id).toBeNull();
    expect((await prisma.expense.findUnique({ where: { id: a.id } })).external_id).toBe('up-a');
  });
});
