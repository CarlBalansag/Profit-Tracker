// TaxYearSetting against real Postgres: the migration creates the table and
// its (user_id, year) unique key, the save route upserts on that key, and the
// Schedule C books read the Prisma Decimal back -- none of which the in-memory
// harness can show.
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

let pg, prisma, server, base, user;

const freePort = async () => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
};
const send = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

describe('opening inventory on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-taxyear-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('taxyear_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/taxyear_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'taxyear-qa@example.test', schedule_c_enabled: true } });

    require.cache[require.resolve('../prisma.js')] = { id: 'prisma', filename: require.resolve('../prisma.js'), loaded: true, exports: prisma };
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; req.apiKeyId = null; next(); });
    app.use('/api/inventory', require('../routes/inventory.js'));
    app.use('/api/schedule-c', require('../routes/scheduleC.js'));
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

  it('upserts one row per year and feeds Part III', async () => {
    expect((await send('PUT', '/api/schedule-c/years/2025', { untracked_inventory_end: '500.10' })).status).toBe(200);
    expect((await send('PUT', '/api/schedule-c/years/2025', { untracked_inventory_end: '480' })).body).toEqual({ year: 2025, untracked_inventory_end: '480' });
    const rows = await prisma.taxYearSetting.findMany({ where: { user_id: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].untracked_inventory_end.toFixed(2)).toBe('480.00');

    const books = (await send('GET', '/api/schedule-c?year=2026')).body.books;
    expect(books.partIII.find(l => l.line === '35').amount).toBe('480.00');
    expect(books.partIII.find(l => l.line === '41').amount).toBe('480.00');

    expect((await send('PUT', '/api/schedule-c/years/2025', { untracked_inventory_end: null })).body.untracked_inventory_end).toBeNull();
    expect((await send('GET', '/api/schedule-c?year=2026')).body.books.untracked.start).toBe('0.00');
    // The database itself allows only one row per user and year.
    await expect(prisma.taxYearSetting.create({ data: { user_id: user.id, year: 2025 } })).rejects.toMatchObject({ code: 'P2002' });
  });
});
