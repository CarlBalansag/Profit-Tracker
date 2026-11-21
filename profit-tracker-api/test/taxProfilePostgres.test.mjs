// TaxProfile against real Postgres: the migration creates the table and its
// (user_id, year) key, the save route upserts on it, and Decimal amounts come
// back as exact strings.
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

describe('tax profile on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-taxprofile-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('taxprofile_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/taxprofile_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'taxprofile-qa@example.test', schedule_c_enabled: true } });

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

  it('saves, replaces and deletes one profile per year', async () => {
    const first = await send('PUT', '/api/tax/profile/2026', { state: 'CO', filing_status: 'mfj', non_business_income: '90000.55', wages: '85000', qualifying_children: 2, buffer_rate: '0.125', reserve_mode: 'conservative' });
    expect(first.status).toBe(200);
    expect(first.body.profile).toMatchObject({ non_business_income: '90000.55', wages: '85000', qualifying_children: 2, buffer_rate: '0.125', reserve_mode: 'conservative', age65: false });
    await send('PUT', '/api/tax/profile/2026', { filing_status: 'single', non_business_income: '1' });
    const rows = await prisma.taxProfile.findMany({ where: { user_id: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ filing_status: 'single', state: null, wages: null, qualifying_children: null, reserve_mode: 'personalized' });
    expect((await send('GET', '/api/tax/profile/2026')).body.profile.non_business_income).toBe('1');
    await expect(prisma.taxProfile.create({ data: { user_id: user.id, year: 2026, filing_status: 'single' } })).rejects.toMatchObject({ code: 'P2002' });
    expect((await send('DELETE', '/api/tax/profile/2026')).body).toEqual({ deleted: 1 });
    expect(await prisma.taxProfile.count()).toBe(0);
  });
});
