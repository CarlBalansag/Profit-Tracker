// Email connections on real Postgres with a fake mail server: connect (with a
// password test), sync with cursors, renumbered folders, dedupe, ownership,
// disconnect, disconnect-and-delete, the cron secret and concurrent syncs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { mime } from './fixtures/emails.mjs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

let pg, prisma, server, base, user, other, actingUser, router, sync;

const freePort = async () => {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
};
const send = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

// ---- fake mail server ------------------------------------------------------
const mail = {};
const log = [];
let goodPassword = 'app-pass-1234';
function resetMail() {
  for (const k of Object.keys(mail)) delete mail[k];
  log.length = 0;
  mail.INBOX = { uidValidity: '100', messages: [] };
  mail['[Gmail]/Spam'] = { uidValidity: '200', messages: [], specialUse: '\\Junk' };
}
let nextUid = 1;
function addMail(folder, from, subject, date, messageId = `<m${nextUid}@x>`, html = '<p>Hello</p>') {
  mail[folder].messages.push({ uid: nextUid++, from, subject, date: new Date(date), messageId, raw: mime({ from, subject, html, id: messageId }) });
}
async function fakeOpen(target) {
  log.push(['open', target]);
  if (target.pass !== goodPassword) throw Object.assign(new Error('NO auth'), { authenticationFailed: true });
  let current = null;
  return {
    async listFolders() { return Object.entries(mail).map(([path, f]) => ({ path, specialUse: f.specialUse || null })); },
    async openReadOnly(path) {
      if (!mail[path]) throw new Error('no such folder');
      current = mail[path];
      log.push(['examine', path]);
      return { uidValidity: current.uidValidity, exists: current.messages.length };
    },
    async searchUids({ domains, since, afterUid }) {
      log.push(['search', afterUid]);
      return current.messages
        .filter((m) => m.uid > afterUid && m.date >= since && domains.some((d) => m.from.includes(d)))
        .map((m) => m.uid).sort((a, b) => a - b);
    },
    async fetchHeaders(uids) {
      return current.messages.filter((m) => uids.includes(m.uid)).map((m) => ({
        uid: m.uid, messageId: m.messageId, fromAddress: m.from, fromName: null, subject: m.subject, date: m.date,
      }));
    },
    async fetchSources(uids) {
      log.push(['body', uids.length]);
      return current.messages.filter((m) => uids.includes(m.uid)).map((m) => ({ uid: m.uid, source: m.raw }));
    },
    async findUidByMessageId(id) { return current.messages.find((m) => m.messageId === id)?.uid || null; },
    async close() { log.push(['close']); },
  };
}
const resolve = async (host) => { if (host.includes('internal')) throw Object.assign(new Error('That mail server is not on the public internet.'), { userFacing: true }); return '93.184.216.34'; };

const connectBody = (over = {}) => ({ preset: 'gmail', email_address: 'me@gmail.com', password: goodPassword, sync_since: '2026-01-01', ...over });
const waitIdle = async (id) => {
  for (let i = 0; i < 400; i += 1) {
    const a = await prisma.emailAccount.findUnique({ where: { id } });
    if (!a.sync_started_at && (a.last_synced_at || a.last_error)) return a;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('sync did not finish');
};

describe('email connections on Postgres', () => {
  beforeAll(async () => {
    process.env.EMAIL_TOKEN_KEY = 'b'.repeat(64);
    process.env.EMAIL_SYNC_SECRET = 'cron-secret-qa';
    const port = await freePort();
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-email-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only',
      persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('email_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/email_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    user = await prisma.user.create({ data: { email: 'email-qa@example.test' } });
    other = await prisma.user.create({ data: { email: 'email-qa-other@example.test' } });
    actingUser = user;

    require.cache[require.resolve('../prisma.js')] = { id: 'prisma', filename: require.resolve('../prisma.js'), loaded: true, exports: prisma };
    router = require('../routes/email.js');
    Object.assign(router._deps, { open: fakeOpen, resolve });
    sync = require('../services/email/sync.js');
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = actingUser; next(); });
    app.use('/api/email', router);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  }, 120000);

  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await prisma?.$disconnect();
    await pg?.stop();
  });

  beforeEach(async () => {
    actingUser = user;
    goodPassword = 'app-pass-1234';
    router._resetLimits();
    resetMail();
    await prisma.emailMessage.deleteMany({});
    await prisma.emailAccount.deleteMany({});
  });

  it('reports setup and refuses a bad password without saving anything', async () => {
    const setup = await send('GET', '/api/email/setup');
    expect(setup.body.configured).toBe(true);
    expect(setup.body.presets.map((p) => p.id)).toEqual(['gmail', 'icloud', 'yahoo', 'aol', 'other']);

    const bad = await send('POST', '/api/email/accounts', connectBody({ password: 'wrong' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/app password/);
    expect(await prisma.emailAccount.count()).toBe(0);

    const internal = await send('POST', '/api/email/accounts', connectBody({ preset: 'other', host: 'mail.internal.example', email_address: 'x@example.com' }));
    expect(internal.status).toBe(400);
    expect(internal.body.error).toMatch(/public internet/);
    const noHost = await send('POST', '/api/email/accounts', connectBody({ preset: 'other', email_address: 'y@example.com' }));
    expect(noHost.status).toBe(400);
    const future = await send('POST', '/api/email/accounts', connectBody({ sync_since: '2999-01-01' }));
    expect(future.status).toBe(400);
  });

  it('connects, stores the password encrypted, and the first sync saves only allow-listed headers', async () => {
    addMail('INBOX', 'auto-confirm@amazon.com', 'Your Amazon.com order', '2026-02-01');
    addMail('INBOX', 'friend@gmail.com', 'Dinner?', '2026-02-02');
    addMail('INBOX', 'deals@notamazon.com', 'Fake amazon', '2026-02-03');
    addMail('INBOX', 'orders@walmart.com', 'Old order', '2025-12-01'); // before the start date
    addMail('INBOX', 'help@walmart.com', 'Walmart order', '2026-02-04');
    addMail('[Gmail]/Spam', 'alerts@bestbuy.com', 'Best Buy in spam', '2026-02-05');

    const created = await send('POST', '/api/email/accounts', connectBody());
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toMatch(/app-pass|encrypted_secret/);
    const row = await waitIdle(created.body.id);
    expect(row.encrypted_secret).toMatch(/^v1:/);
    expect(row.encrypted_secret).not.toContain('app-pass');
    expect(row.status).toBe('active');
    expect(log.some((e) => e[0] === 'open' && e[1].servername === 'imap.gmail.com' && e[1].address === '93.184.216.34')).toBe(true);

    const messages = await send('GET', '/api/email/messages?show=all');
    expect(messages.body.total).toBe(2);
    expect(messages.body.messages.map((m) => [m.merchant, m.subject, m.link?.startsWith('https://mail.google.com/')])).toEqual([['walmart', 'Walmart order', true], ['amazon', 'Your Amazon.com order', true]]);
    expect(log.filter((e) => e[0] === 'examine').map((e) => e[1])).toEqual(['INBOX', 'INBOX', 'INBOX']); // test, find, read bodies; spam off
    const list = await send('GET', '/api/email/accounts');
    expect(list.body[0]).toMatchObject({ email_address: 'me@gmail.com', message_count: 2, status: 'active', syncing: false });

    const dup = await send('POST', '/api/email/accounts', connectBody());
    expect(dup.status).toBe(409);
  });

  it('picks up only new mail on the next run, and rescans a renumbered folder without duplicates', async () => {
    addMail('INBOX', 'a@amazon.com', 'Order 1', '2026-03-01');
    const { body } = await send('POST', '/api/email/accounts', connectBody());
    await waitIdle(body.id);
    addMail('INBOX', 'b@amazon.com', 'Order 2', '2026-03-02');
    log.length = 0;
    expect(await sync.syncAccount(body.id, { open: fakeOpen, resolve })).toMatchObject({ status: 'ok', found: 1 });
    expect(log.find((e) => e[0] === 'search')[1]).toBeGreaterThan(0); // resumed from the cursor

    mail.INBOX.uidValidity = '999';
    log.length = 0;
    expect(await sync.syncAccount(body.id, { open: fakeOpen, resolve })).toMatchObject({ status: 'ok', found: 0 });
    expect(log.find((e) => e[0] === 'search')[1]).toBe(0);
    expect(await prisma.emailMessage.count()).toBe(2);
    const cursor = await prisma.emailFolderCursor.findFirst({ where: { account_id: body.id } });
    expect(cursor.uid_validity).toBe('999');
  });

  it('reads spam folders when turned on, and an earlier start date rescans', async () => {
    addMail('INBOX', 'a@amazon.com', 'Inbox order', '2026-03-01');
    addMail('[Gmail]/Spam', 'alerts@bestbuy.com', 'Spam order', '2026-03-02');
    addMail('INBOX', 'c@target.com', 'Older order', '2025-11-01');
    const { body } = await send('POST', '/api/email/accounts', connectBody());
    await waitIdle(body.id);
    expect(await prisma.emailMessage.count()).toBe(1);

    const patched = await send('PATCH', `/api/email/accounts/${body.id}`, { include_spam: true, sync_since: '2025-10-01' });
    expect(patched.status).toBe(200);
    expect(await prisma.emailFolderCursor.count({ where: { account_id: body.id } })).toBe(0);
    await sync.syncAccount(body.id, { open: fakeOpen, resolve });
    const subjects = (await prisma.emailMessage.findMany({ orderBy: { sent_at: 'asc' } })).map((m) => [m.folder, m.subject]);
    expect(subjects).toEqual([['INBOX', 'Older order'], ['INBOX', 'Inbox order'], ['[Gmail]/Spam', 'Spam order']]);
  });

  it('marks the account for attention when the password stops working, and a new one fixes it', async () => {
    const { body } = await send('POST', '/api/email/accounts', connectBody());
    await waitIdle(body.id);
    goodPassword = 'new-pass';
    expect(await sync.syncAccount(body.id, { open: fakeOpen, resolve })).toMatchObject({ status: 'error' });
    let row = await prisma.emailAccount.findUnique({ where: { id: body.id } });
    expect(row.status).toBe('error');
    expect(row.last_error).toMatch(/app password/);
    expect(await sync.runScheduledEmailSync({ open: fakeOpen, resolve })).toMatchObject({ accounts: 0 }); // not retried automatically

    const wrong = await send('PATCH', `/api/email/accounts/${body.id}`, { password: 'still-wrong' });
    expect(wrong.status).toBe(400);
    const fixed = await send('PATCH', `/api/email/accounts/${body.id}`, { password: 'new-pass' });
    expect(fixed.body).toMatchObject({ status: 'active', last_error: null });
    row = await prisma.emailAccount.findUnique({ where: { id: body.id } });
    expect(row.encrypted_secret).not.toContain('new-pass');
  });

  it('keeps accounts private to their owner', async () => {
    const { body } = await send('POST', '/api/email/accounts', connectBody());
    await waitIdle(body.id);
    actingUser = other;
    expect((await send('GET', '/api/email/accounts')).body).toEqual([]);
    expect((await send('GET', '/api/email/messages?show=all')).body).toEqual({ total: 0, messages: [] });
    expect((await send('PATCH', `/api/email/accounts/${body.id}`, { include_spam: true })).status).toBe(404);
    expect((await send('POST', `/api/email/accounts/${body.id}/sync`)).status).toBe(404);
    expect((await send('DELETE', `/api/email/accounts/${body.id}?delete_data=true`)).status).toBe(404);
    expect(await prisma.emailAccount.count()).toBe(1);
  });

  it('disconnect erases the password and keeps found emails; delete removes both', async () => {
    addMail('INBOX', 'a@amazon.com', 'Order', '2026-03-01');
    const { body } = await send('POST', '/api/email/accounts', connectBody());
    await waitIdle(body.id);
    const off = await send('DELETE', `/api/email/accounts/${body.id}`);
    expect(off.body).toEqual({ disconnected: true });
    const row = await prisma.emailAccount.findUnique({ where: { id: body.id } });
    expect([row.status, row.encrypted_secret]).toEqual(['disconnected', null]);
    expect(await prisma.emailMessage.count()).toBe(1);
    expect((await send('POST', `/api/email/accounts/${body.id}/sync`)).status).toBe(409);
    expect((await send('POST', '/api/email/accounts', connectBody())).body.error).toMatch(/Reconnect/);

    const back = await send('PATCH', `/api/email/accounts/${body.id}`, { password: goodPassword });
    expect(back.body.status).toBe('active');

    const gone = await send('DELETE', `/api/email/accounts/${body.id}?delete_data=true`);
    expect(gone.body).toEqual({ deleted: true, messages_deleted: 1 });
    expect(await prisma.emailAccount.count()).toBe(0);
    expect(await prisma.emailMessage.count()).toBe(0);
  });

  it('runs one sync per account at a time and limits Sync now', async () => {
    addMail('INBOX', 'a@amazon.com', 'Order', '2026-03-01');
    const { body } = await send('POST', '/api/email/accounts', connectBody());
    await waitIdle(body.id);
    const slowOpen = async (t) => { await new Promise((r) => setTimeout(r, 300)); return fakeOpen(t); };
    const results = await Promise.all([1, 2, 3].map(() => sync.syncAccount(body.id, { open: slowOpen, resolve })));
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'busy')).toHaveLength(2);
    const again = await send('POST', `/api/email/accounts/${body.id}/sync`);
    expect(again.status).toBe(429);
  });

  it('a disconnect during a running sync stays disconnected', async () => {
    const { body } = await send('POST', '/api/email/accounts', connectBody());
    await waitIdle(body.id);
    await prisma.emailAccount.update({ where: { id: body.id }, data: { last_synced_at: null } });
    const slowOpen = async (t) => { await new Promise((r) => setTimeout(r, 300)); return fakeOpen(t); };
    const running = sync.syncAccount(body.id, { open: slowOpen, resolve });
    await new Promise((r) => setTimeout(r, 50));
    await send('DELETE', `/api/email/accounts/${body.id}`);
    await running;
    const row = await prisma.emailAccount.findUnique({ where: { id: body.id } });
    expect([row.status, row.encrypted_secret]).toEqual(['disconnected', null]);
  });

  it('reads order details from the body, keeps only the details, and re-finds renumbered emails', async () => {
    addMail('INBOX', 'auto-confirm@amazon.com', 'Your Amazon.com order of "Switch"', '2026-03-01', '<o1@amazon.com>',
      '<p>Order #112-1234567-7654321</p><table><tr><td>Order Total:</td><td>$449.99</td></tr></table><p>Visa ending in 4242</p>');
    addMail('INBOX', 'store-news@amazon.com', 'Black Friday deals: 50% off', '2026-03-02', '<n1@amazon.com>', '<p>Shop now</p><p>Unsubscribe</p>');
    const { body } = await send('POST', '/api/email/accounts', connectBody());
    await waitIdle(body.id);
    const rows = await prisma.emailMessage.findMany({ orderBy: { sent_at: 'asc' } });
    expect(rows.map((r) => [r.status, r.kind, r.order_number, r.total?.toString(), r.payment_hint])).toEqual([
      ['extracted', 'order', '112-1234567-7654321', '449.99', 'Visa 4242'],
      ['ignored', 'other', null, undefined, null],
    ]);
    expect(Object.keys(rows[0])).not.toContain('body');
    const listed = await send('GET', '/api/email/messages?kind=orders');
    expect(listed.body.messages.map((m) => [m.kind, m.total, m.order_number])).toEqual([['order', '449.99', '112-1234567-7654321']]);
    expect((await send('GET', '/api/email/messages')).body.total).toBe(1); // the newsletter is hidden
    expect((await send('GET', '/api/email/messages?show=all')).body.total).toBe(2);

    // A newer reader version re-reads; a renumbered folder is found again by Message-ID.
    await prisma.emailMessage.updateMany({ data: { parser_version: 1 } });
    mail.INBOX.uidValidity = '555';
    mail.INBOX.messages.forEach((m) => { m.uid += 100; });
    expect(await sync.syncAccount(body.id, { open: fakeOpen, resolve })).toMatchObject({ status: 'ok', read: 2 });
    const again = await prisma.emailMessage.findFirst({ where: { message_id: '<o1@amazon.com>' } });
    expect([again.uid_validity, again.status, again.parser_version > 1]).toEqual(['555', 'extracted', true]);

    // An email deleted from the mailbox before it was read is marked, not retried forever.
    await prisma.emailMessage.updateMany({ data: { status: 'new' } });
    mail.INBOX.messages.length = 0;
    await sync.syncAccount(body.id, { open: fakeOpen, resolve });
    expect(new Set((await prisma.emailMessage.findMany()).map((r) => r.status))).toEqual(new Set(['failed']));
  });

  it('protects the cron endpoint with its own secret', () => {
    expect(sync.verifySyncSecret('Bearer cron-secret-qa').ok).toBe(true);
    expect(sync.verifySyncSecret('Bearer wrong').ok).toBe(false);
    expect(sync.verifySyncSecret(undefined).ok).toBe(false);
  });

  it('caps a run and continues where it stopped', { timeout: 60000 }, async () => {
    for (let i = 0; i < sync.MAX_PER_RUN + 20; i += 1) addMail('INBOX', 'a@amazon.com', `Order ${i}`, '2026-03-01');
    const { body } = await send('POST', '/api/email/accounts', connectBody());
    await waitIdle(body.id);
    expect(await prisma.emailMessage.count()).toBe(sync.MAX_PER_RUN);
    expect(await sync.syncAccount(body.id, { open: fakeOpen, resolve })).toMatchObject({ status: 'ok', found: 20, more: true }); // bodies still waiting to be read
  });
});
