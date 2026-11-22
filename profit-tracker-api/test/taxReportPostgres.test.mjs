// Finalized Schedule C reports against real Postgres: the migration adds the
// table, a report is stored as JSON unchanged, and two finalizes at once can't
// both make the same revision.
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

describe('finalized reports on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-report-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('report_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/report_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'report-qa@example.test', schedule_c_enabled: true } });

    require.cache[require.resolve('../prisma.js')] = { id: 'prisma', filename: require.resolve('../prisma.js'), loaded: true, exports: prisma };
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; req.apiKeyId = null; next(); });
    app.use('/api/inventory', require('../routes/inventory.js'));
    app.use('/api/schedule-c', require('../routes/scheduleC.js'));
    app.use('/api/tax', require('../routes/tax.js'));
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

  it('finalizes once when two requests race, and keeps revisions unchanged', async () => {
    const both = await Promise.all([
      send('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 0 }),
      send('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 0 }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.taxReportSnapshot.count()).toBe(1);
    await send('POST', '/api/schedule-c/mileage', { date: '2026-02-02', miles: '20', destination: 'Bank', purpose: 'Deposit' });
    const live = (await send('GET', '/api/schedule-c/years/2026/report')).body;
    expect(live.changed).toBe(true);
    expect(live.changes.find((c) => c.line === '9')).toMatchObject({ before: '0.00', after: '14.50' });
    const second = await send('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 1, reason: 'Added a trip' });
    expect(second.status).toBe(201);
    const rows = await prisma.taxReportSnapshot.findMany({ orderBy: { revision: 'asc' } });
    expect(rows.map((r) => r.revision)).toEqual([1, 2]);
    expect(rows[0].report.part2.find((l) => l.line === '9').amount).toBe('0.00');
    expect(rows[1].report.part2.find((l) => l.line === '9').amount).toBe('14.50');
    expect(rows[1].rules.mileage).toBe('2026-01-01:72.5,2026-07-01:76');
  });
});
