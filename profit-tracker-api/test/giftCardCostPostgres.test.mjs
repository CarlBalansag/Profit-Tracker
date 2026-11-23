// Inventory.gift_card_cost against real Postgres: the migration adds the
// nullable Decimal column, the routes write and clear it, and the Schedule C
// books read the Prisma Decimal back into inventory cost -- none of which the
// in-memory harness can show.
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

describe('gift card cost on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-giftcost-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('giftcost_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/giftcost_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'giftcost-qa@example.test', schedule_c_enabled: true } });

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

  it('stores, reads back, uses and clears the cost', async () => {
    // 2 x $50 paid with a $60 gift card that cost $54.10.
    const created = await send('POST', '/api/inventory', {
      product_name: 'QA Gift Card Buy', unit_purchase_cost: 50, qty_purchased: 2,
      purchase_date: '2026-03-01', gift_card_amount: 60, gift_card_cost: '54.10',
    });
    expect(created.status).toBe(200);
    const row = await prisma.inventory.findUnique({ where: { id: created.body.id } });
    expect(row.gift_card_cost.toFixed(2)).toBe('54.10');

    const detail = await send('GET', `/api/inventory/${created.body.id}`);
    expect(Number(detail.body.gift_card_cost)).toBe(54.1);

    const books = (await send('GET', '/api/schedule-c?year=2026')).body.books;
    // 100 - 60 + 54.10 = 94.10 of purchases, all still on hand.
    expect(books.partIII.find(l => l.line === '36').amount).toBe('94.10');
    expect(books.partIII.find(l => l.line === '41').amount).toBe('94.10');
    expect(books.notes.join(' ')).toMatch(/They cost you \$54\.10/);

    expect((await send('PUT', `/api/inventory/${created.body.id}`, { gift_card_cost: '' })).status).toBe(200);
    expect((await prisma.inventory.findUnique({ where: { id: created.body.id } })).gift_card_cost).toBeNull();
    const after = (await send('GET', '/api/schedule-c?year=2026')).body.books;
    expect(after.partIII.find(l => l.line === '36').amount).toBe('40.00');
    expect(after.notes.join(' ')).toMatch(/no gift card cost entered/);
  });
});
