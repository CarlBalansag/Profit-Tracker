// TaxPayment against real Postgres: the migration creates the table, payments
// save with exact Decimal amounts and dates, and delete is owner-only.
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

describe('tax payments on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-taxpayment-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('taxpayment_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/taxpayment_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'taxpayment-qa@example.test', schedule_c_enabled: true } });

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

  it('records, lists and deletes payments', async () => {
    const saved = await send('POST', '/api/tax/payments/2026', { jurisdiction: 'US', period: 'Q3', amount: '1200.55', paid_date: '2026-09-14', reference: 'DP-9' });
    expect(saved.status).toBe(201);
    expect(saved.body.payments[0]).toMatchObject({ jurisdiction: 'US', period: 'Q3', amount: '1200.55', paid_date: '2026-09-14', reference: 'DP-9' });
    const row = await prisma.taxPayment.findFirst({ where: { user_id: user.id } });
    expect(row.amount.toFixed(2)).toBe('1200.55');
    const other = await prisma.user.create({ data: { email: 'taxpayment-other@example.test' } });
    const theirs = await prisma.taxPayment.create({ data: { user_id: other.id, year: 2026, jurisdiction: 'US', period: 'Q1', amount: 5, paid_date: new Date() } });
    expect((await send('DELETE', `/api/tax/payments/entry/${theirs.id}`)).status).toBe(404);
    expect((await send('DELETE', `/api/tax/payments/entry/${row.id}`)).body.payments).toEqual([]);
    expect(await prisma.taxPayment.count()).toBe(1);
  });
});
