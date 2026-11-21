// TaxForm1099K against real Postgres: the migration creates the table, the
// routes save Decimal amounts, deleting a platform unlinks its forms (ON DELETE
// SET NULL) without losing them, and Undo on that delete links them again.
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

let pg, prisma, server, base, user, market;

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

describe('1099-K forms on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-1099k-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('form1099k_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/form1099k_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'form1099k-qa@example.test', schedule_c_enabled: true } });
    market = await prisma.platform.create({ data: { user_id: user.id, name: 'QA Market', type: 'Marketplace' } });

    require.cache[require.resolve('../prisma.js')] = { id: 'prisma', filename: require.resolve('../prisma.js'), loaded: true, exports: prisma };
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; req.apiKeyId = null; next(); });
    app.use('/api/inventory', require('../routes/inventory.js'));
    app.use('/api/schedule-c', require('../routes/scheduleC.js'));
    app.use('/api/platforms', require('../routes/platforms.js'));
    app.use('/api/activity', require('../routes/activity.js'));
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

  it('saves a form, keeps it when its platform is deleted, and Undo relinks it', async () => {
    const created = await send('POST', '/api/schedule-c/years/2026/1099-k', { payer_name: 'QA Market', platform_id: market.id, gross_amount: '1234.56', transaction_count: 7 });
    expect(created.status).toBe(201);
    expect(created.body.gross_amount).toBe('1234.56');
    let books = (await send('GET', '/api/schedule-c?year=2026')).body.books;
    expect(books.form1099K.comparison).toEqual([{ platform_id: market.id, platform: 'QA Market', recordedGross: '0.00', recordedCount: 0, formGross: '1234.56', formCount: 7, difference: '1234.56' }]);

    const removed = await send('DELETE', `/api/platforms/${market.id}`);
    expect(removed.status).toBe(200);
    const orphan = await prisma.taxForm1099K.findUnique({ where: { id: created.body.id } });
    expect(orphan).toMatchObject({ platform_id: null, payer_name: 'QA Market' });
    expect(orphan.gross_amount.toFixed(2)).toBe('1234.56');

    expect((await send('POST', `/api/activity/${removed.body.activity_id}/undo`)).status).toBe(200);
    expect((await prisma.taxForm1099K.findUnique({ where: { id: created.body.id } })).platform_id).toBe(market.id);
    books = (await send('GET', '/api/schedule-c?year=2026')).body.books;
    expect(books.form1099K.forms[0]).toMatchObject({ platform_name: 'QA Market', gross_amount: '1234.56' });
  });
});
