// The scheduled cashout sync's one-at-a-time lock, against a real Postgres.
// It used to be a session lock that could be released on a different pooled
// connection than it was taken on, leaving it held so every later run got 409
// (seen in production, not reproducible with this test's quiet pool). The lock
// is now tied to one transaction; these check it is always released and still
// turns away an overlapping run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
let pg;
let db;
let scheduler;

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-synclock-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('synclock_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/synclock_qa`;
  expect(new URL(url).hostname).toBe('127.0.0.1');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasources: { db: { url: `${url}?connection_limit=5` } } });
  const prismaPath = require.resolve('../prisma.js');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };
  scheduler = require('../services/cashouts/syncScheduler');
}, 180000);

afterAll(async () => {
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

const LOCK_ID = 948273615;

describe('scheduled cashout sync lock', () => {
  it('lets run after run go through (the lock is released every time)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const result = await scheduler.runScheduledSync();
      expect(result.status).not.toBe('locked');
      expect(result).toMatchObject({ total: 0, synced: 0 });
    }
    const held = await db.$queryRaw`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = ${LOCK_ID}`;
    expect(held[0].n).toBe(0);
  });

  it('turns away a run while another holds the lock, then runs once it is free', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let holding;
    const held = new Promise((resolve) => { holding = resolve; });
    const other = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${LOCK_ID}) AS locked`;
      holding();
      await gate;
    }, { timeout: 30000 });
    await held;
    expect(await scheduler.runScheduledSync()).toMatchObject({ status: 'locked' });
    release();
    await other;
    expect((await scheduler.runScheduledSync()).status).not.toBe('locked');
  });
});
