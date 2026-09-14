import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const express = require('express');
const session = require('express-session');
const { Passport } = require('passport');
const { createPasswordAuth } = require('../routes/passwordAuth');
const { hashPassword, verifyPassword } = require('../services/passwords');
let server, base, credentials, initialHash, faults, requestNumber = 0;
const oldPassword = 'temporary-fixture-password';
const newPassword = 'new-private-fixture-password';
const users = [{ id: 'owner-a', username: 'Existing A', email: 'original-a@example.test' },
  { id: 'owner-b', username: 'Existing B', email: 'original-b@example.test' }];
const business = [{ id: 'batch-a', user_id: 'owner-a', quantity: 3 }, { id: 'batch-b', user_id: 'owner-b', quantity: 7 }];
const clone = value => value ? structuredClone(value) : null;
beforeAll(async () => { initialHash = await hashPassword(oldPassword); });
beforeEach(async () => {
  faults = {};
  credentials = users.map((user, index) => ({ user_id: user.id, email: `login-${index}@example.test`,
    password_hash: initialHash, version: 1, disabled: false, must_change_password: index === 0,
    temporary_expires_at: new Date(Date.now() + 3600000) }));
  const prisma = {
    user: { findUnique: async ({ where }) => clone(users.find(user => user.id === where.id)) },
    localCredential: {
      findUnique: async ({ where }) => {
        if (faults.read) throw Object.assign(new Error('DB unavailable'), { code: 'P1001' });
        return clone(credentials.find(row => where.email ? row.email === where.email : row.user_id === where.user_id));
      },
      updateMany: async ({ where, data }) => {
        if (faults.update) throw new Error('Update failed');
        const row = credentials.find(row => row.user_id === where.user_id && row.version === where.version && !row.disabled);
        if (!row) return { count: 0 };
        Object.assign(row, data, { version: row.version + data.version.increment });
        return { count: 1 };
      },
    },
  };
  const passport = new Passport();
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => done(null, clone(users.find(user => user.id === id))));
  const store = new session.MemoryStore();
  const save = store.set.bind(store);
  store.set = (sid, value, callback) => faults.save && value.authMethod === 'password'
    ? callback(new Error('Session save failed')) : save(sid, value, callback);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    Object.defineProperty(req, 'ip', { value: req.get('X-Test-IP') || 'test-ip' });
    if (req.method === 'POST' && req.get('X-Requested-With') !== 'XMLHttpRequest') return res.status(403).json({ error: 'CSRF check failed' });
    next();
  });
  app.use(session({ store, secret: 'fixture-session-secret-is-long-enough', resave: false, saveUninitialized: false }));
  app.use(passport.initialize()); app.use(passport.session());
  const auth = createPasswordAuth({ prisma });
  app.use(auth.sessionGuard); app.use('/auth', auth.router);
  app.post('/fixture/legacy-session', (req, res, next) => req.logIn(users[0], error => error ? next(error) : res.json({ fixture: true })));
  app.get('/auth/me', (req, res) => req.user ? res.json(auth.publicUser(req.user, req.localCredential)) : res.sendStatus(401));
  app.get('/api/records', (req, res) => req.user ? res.json(business.filter(row => row.user_id === req.user.id)) : res.sendStatus(401));
  app.post('/auth/logout', (req, res, next) => req.logout(error => error ? next(error) : req.session.destroy(error => error ? next(error) : res.json({ success: true }))));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: 'Operation failed.' }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  requestNumber++;
});
afterEach(async () => { vi.restoreAllMocks(); await new Promise(resolve => server.close(resolve)); });
async function request(path, body, cookie, headers = {}) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Test-IP': `test-${requestNumber}`,
    ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}
const login = (index = 0, password = oldPassword, cookie) => request('/auth/login', { email: `login-${index}@example.test`, password }, cookie);

describe('invite-only password authentication', () => {
  it('rejects legacy Discord sessions and rechecks expiry/disabled access on existing sessions', async () => {
    const legacy = await request('/fixture/legacy-session', {});
    expect((await request('/auth/me', undefined, legacy.cookie)).status).toBe(401);
    expect((await login(0, oldPassword, legacy.cookie)).status).toBe(200);
    const temporary = await login();
    credentials[0].temporary_expires_at = new Date(Date.now() - 1000);
    expect((await request('/auth/me', undefined, temporary.cookie)).status).toBe(401);
    const approved = await login(1);
    credentials[1].disabled = true;
    expect((await request('/api/records', undefined, approved.cookie)).status).toBe(401);
  });
  it('preserves existing user IDs and blocks business access until the temporary password changes', async () => {
    const before = clone(business);
    const logged = await login();
    expect(logged.status).toBe(200); expect(logged.data.id).toBe('owner-a');
    expect(logged.data.password_change_required).toBe(true);
    expect(JSON.stringify(logged.data)).not.toContain('password_hash');
    expect((await request('/api/records', undefined, logged.cookie)).status).toBe(403);
    const changed = await request('/auth/change-password', { current_password: oldPassword, new_password: newPassword }, logged.cookie);
    expect(changed.status).toBe(200); expect(changed.data.password_change_required).toBe(false);
    expect(changed.cookie).not.toBe(logged.cookie);
    expect((await request('/api/records', undefined, changed.cookie)).data).toEqual([business[0]]);
    expect((await login(0, oldPassword)).status).toBe(401);
    expect((await login(0, newPassword)).data.id).toBe('owner-a');
    expect(business).toEqual(before);
    expect(users[0].email).toBe('original-a@example.test');
  });
  it('isolates users and invalidates other sessions on change/reset', async () => {
    const a = await login(1); const b = await login(1);
    expect((await request('/api/records', undefined, a.cookie)).data).toEqual([business[1]]);
    const changed = await request('/auth/change-password', { current_password: oldPassword, new_password: newPassword }, a.cookie);
    expect(changed.status).toBe(200);
    expect((await request('/auth/me', undefined, b.cookie)).status).toBe(401);
    credentials[1].version++;
    expect((await request('/auth/me', undefined, changed.cookie)).status).toBe(401);
  });
  it('rejects unknown, disabled, expired and wrong-password accounts without creating or altering users', async () => {
    const wrong = await login(0, 'wrong');
    const unknown = await login(99);
    expect(wrong.status).toBe(401); expect(unknown.data).toEqual(wrong.data);
    credentials[0].disabled = true; expect((await login()).status).toBe(401);
    credentials[0].disabled = false; credentials[0].temporary_expires_at = new Date(0);
    expect((await login()).status).toBe(401);
    expect(credentials).toHaveLength(2); expect(users).toHaveLength(2);
  });
  it('validates input, prevents supplied owner IDs and preserves hashes on invalid changes', async () => {
    for (const body of [{}, { email: 'invalid', password: '' }, { email: 'login-0@example.test', password: oldPassword, user_id: 'owner-b' }])
      expect((await request('/auth/login', body)).status).toBe(400);
    const logged = await login();
    const before = clone(credentials[0]);
    expect((await request('/auth/change-password', { current_password: oldPassword }, logged.cookie)).status).toBe(400);
    expect((await request('/auth/change-password', { current_password: 'wrong', new_password: newPassword }, logged.cookie)).status).toBe(401);
    expect((await request('/auth/change-password', { current_password: oldPassword, new_password: oldPassword }, logged.cookie)).status).toBe(400);
    expect(credentials[0]).toEqual(before);
  });
  it('supports logout/relogin and does not establish a session on save failure', async () => {
    const logged = await login(1);
    expect((await request('/auth/logout', {}, logged.cookie)).status).toBe(200);
    expect((await request('/auth/me', undefined, logged.cookie)).status).toBe(401);
    expect((await login(1)).status).toBe(200);
    faults.save = true;
    const failed = await login(0);
    expect(failed.status).toBe(500);
    faults.save = false;
    expect((await request('/auth/me', undefined, failed.cookie)).status).toBe(401);
    expect(credentials[0].password_hash).toBe(initialHash);
  });
  it('handles DB failures and informs users when the password changed but session saving failed', async () => {
    faults.read = true; expect((await login()).status).toBe(500); faults.read = false;
    const logged = await login(1);
    faults.update = true;
    expect((await request('/auth/change-password', { current_password: oldPassword, new_password: newPassword }, logged.cookie)).status).toBe(500);
    expect(credentials[1].password_hash).toBe(initialHash);
    faults.update = false;
    const retry = await login(1);
    faults.save = true;
    const failed = await request('/auth/change-password', { current_password: oldPassword, new_password: newPassword }, retry.cookie);
    expect(failed.status).toBe(503); expect(failed.data.error).toMatch(/Sign in using your new password/);
    expect(await verifyPassword(newPassword, credentials[1].password_hash)).toBe(true);
    faults.save = false;
    expect((await login(1, newPassword)).status).toBe(200);
  });
  it('limits repeated invalid requests and enforces CSRF', async () => {
    for (let count = 0; count < 10; count++) expect((await request('/auth/login', {})).status).toBe(400);
    expect((await request('/auth/login', {})).status).toBe(429);
    expect((await request('/auth/login', {}, undefined, { 'X-Requested-With': '' })).status).toBe(403);
    expect((await request('/auth/change-password', { current_password: oldPassword, new_password: newPassword }, undefined,
      { 'X-Test-IP': 'different-ip' })).status).toBe(401);
  });
  it('uses version checks to prevent concurrent password changes overwriting each other', async () => {
    const logged = await login(1);
    const results = await Promise.all([newPassword, 'different-private-password'].map(new_password =>
      request('/auth/change-password', { current_password: oldPassword, new_password }, logged.cookie)));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(credentials[1].version).toBe(2);
  });
});
