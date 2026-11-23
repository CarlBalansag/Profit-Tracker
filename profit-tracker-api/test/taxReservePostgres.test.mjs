// TaxReserveEntry against real Postgres: the migration creates the table and
// the TaxProfile projection columns, and the user-row lock keeps two
// simultaneous "take back" requests from overdrawing the reserve.
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

describe('tax reserve on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-taxreserve-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('taxreserve_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/taxreserve_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'taxreserve-qa@example.test', schedule_c_enabled: true } });

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

  it('keeps the balance right under concurrent requests and stores the projection choice', async () => {
    await send('POST', '/api/tax/reserves/2026', { kind: 'set_aside', amount: '100.10', date: '2026-04-01' });
    // Two $60 take-backs at once: only one fits in $100.10.
    const results = await Promise.all([1, 2].map(() => send('POST', '/api/tax/reserves/2026', { kind: 'released', amount: '60', date: '2026-04-02' })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const ledger = (await send('GET', '/api/tax/reserves/2026')).body;
    expect(ledger).toMatchObject({ setAside: '100.10', released: '60.00', balance: '40.10' });
    expect(ledger.entries[0]).toMatchObject({ kind: 'released', amount: '60', date: '2026-04-02' });

    const saved = await send('PUT', '/api/tax/profile/2026', { filing_status: 'single', forecast_method: 'seasonal', profit_target: '42000.50' });
    expect(saved.body.profile).toMatchObject({ forecast_method: 'seasonal', profit_target: '42000.5' });
  });
});
