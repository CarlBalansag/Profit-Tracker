import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const express = require('express');
const session = require('express-session');
const { createFirebaseAuth, hash } = require('../routes/firebaseAuth');
const { firebaseConfig } = require('../services/firebase');
const { hashPassword } = require('../services/passwords');
const { approve } = require('../scripts/approveFirebaseMigration');
const { disable } = require('../scripts/disableFirebaseAccount');
let pg, prisma, server, base, config, provider, auth, users, privateHash;
let providerFailure, claimsOverrides, cookieSequence = 0, sessionWriteFailure, cookieFailure, revokeFailure;
const claimsByCookie = new Map();
const privatePassword = 'private existing test password';
const project = 'demo-profittracker';
const userClaims = uid => ({ uid, aud: project, iss: `https://securetoken.google.com/${project}`, email: `${uid}@example.test`, email_verified: true, auth_time: Date.now() / 1000 });
beforeAll(async () => {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), 'profittracker-firebase-qa-'));
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: true, onLog: () => {}, onError: () => {} });
  await pg.initialise(); await pg.start(); await pg.createDatabase('firebase_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/firebase_qa`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe' });
  prisma = new PrismaClient({ datasources: { db: { url } } });
  const preserved = await prisma.user.create({ data: { email: 'migration-preserved@example.test', payment_methods: { create: { name: 'Migration preserved', type: 'CREDIT_CARD' } } } });
  const before = await prisma.paymentMethod.findMany();
  const client = new (require('pg').Client)({ connectionString: url }); await client.connect();
  // Recreate the pre-Firebase auth contract, then apply the actual reviewed SQL.
  // This client is hard-wired to the isolated localhost database created above.
  await client.query('DROP TABLE "FirebaseSession", "FirebaseIdentity", "AuthIntent", "MigrationApproval", "AuthAttemptBucket"; ALTER TABLE "User" DROP COLUMN "login_disabled";');
  await client.query('BEGIN');
  try { await client.query(await readFile('prisma/migrations/20260914000000_firebase_auth/migration.sql', 'utf8')); await client.query('COMMIT'); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
  expect((await prisma.user.findUnique({ where: { id: preserved.id } })).email).toBe('migration-preserved@example.test');
  expect(await prisma.paymentMethod.findMany()).toEqual(before);
  privateHash = await hashPassword(privatePassword);
}, 60000);
afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (prisma) await prisma.$disconnect(); if (pg) await pg.stop(); });
beforeEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$transaction([prisma.firebaseSession.deleteMany(), prisma.firebaseIdentity.deleteMany(), prisma.authIntent.deleteMany(), prisma.migrationApproval.deleteMany(), prisma.authAttemptBucket.deleteMany(), prisma.localCredential.deleteMany(), prisma.paymentMethod.deleteMany(), prisma.user.deleteMany()]);
  users = await Promise.all(['a', 'b'].map(letter => prisma.user.create({ data: { email: `original-${letter}@example.test`, username: `legacy-${letter}`, local_credential: { create: { email: `legacy-${letter}@profittracker.invalid`, password_hash: privateHash, must_change_password: false } } } })));
  config = { enabled: true, production: false, projectId: project, signupEnabled: true, frontend: 'http://frontend.example.test' };
  providerFailure = false; claimsOverrides = {}; sessionWriteFailure = false; cookieFailure = false; revokeFailure = false;
  provider = {
    verifyIdToken: async (uid, revoked) => {
      expect(revoked).toBe(true);
      if (providerFailure) throw Object.assign(new Error('private provider payload'), { code: 'auth/internal-error', status: 429 });
      if (uid === 'forged') throw Object.assign(new Error('private forged token'), { code: 'auth/invalid-id-token' });
      return { ...userClaims(uid), ...claimsOverrides };
    },
    createSessionCookie: async uid => { if (cookieFailure) throw new Error('private cookie creation error'); const cookie = `fixture-cookie-${++cookieSequence}`; claimsByCookie.set(cookie, { ...userClaims(uid), iss: `https://session.firebase.google.com/${project}` }); return cookie; },
    verifySessionCookie: async (cookie, revoked) => { expect(revoked).toBe(true); if (providerFailure) throw Object.assign(new Error('private provider outage'), { code: 'auth/internal-error' }); const result = claimsByCookie.get(cookie); if (!result) throw Object.assign(new Error('private invalid cookie'), { code: 'auth/invalid-session-cookie' }); return result; },
    revokeRefreshTokens: async uid => { if (revokeFailure) throw new Error('private revoke failure'); for (const [cookie, claims] of claimsByCookie) if (claims.uid === uid) claimsByCookie.delete(cookie); },
    getUser: async uid => ({ uid, email: `${uid}@example.test`, emailVerified: true, disabled: false }),
  };
  const faultStore = new Proxy(prisma, { get(target, property) {
    if (property !== '$transaction') return target[property];
    return callback => target.$transaction(tx => callback(new Proxy(tx, { get(transaction, field) {
      if (field !== 'firebaseSession') return transaction[field];
      return new Proxy(transaction.firebaseSession, { get(model, method) { if (method === 'create') return args => { if (sessionWriteFailure) throw new Error('private DB failure'); return model.create(args); }; return model[method]; } });
    } })));
  } });
  auth = createFirebaseAuth({ prisma: faultStore, auth: provider, config });
  const app = express();
  app.use('/auth/firebase', (req, res, next) => auth.preflight(req, res, next), express.json({ limit: '16kb' }));
  app.use(session({ secret: 'isolated firebase qa session secret long', resave: false, saveUninitialized: false }));
  app.use(async (req, res, next) => {
    const id = req.get('X-Fixture-Legacy');
    if (id) { req.user = await prisma.user.findUnique({ where: { id } }); req.localCredential = await prisma.localCredential.findUnique({ where: { user_id: id } }); }
    next();
  });
  app.use((req, res, next) => req.path === '/auth/logout' ? next() : auth.guard(req, res, next));
  app.use('/auth/firebase', (req, res, next) => auth.router(req, res, next));
  app.post('/auth/logout', auth.logout);
  app.get('/auth/me', (req, res) => req.user ? res.json(auth.publicUser(req.user)) : res.sendStatus(401));
  app.get('/api/records', async (req, res) => req.user ? res.json(await prisma.paymentMethod.findMany({ where: { user_id: req.user.id } })) : res.sendStatus(401));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: 'Safe fixture error' }));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
async function request(path, body, cookie, headers = {}) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: config.frontend, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data; try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data, cookie: response.headers.getSetCookie().find(value => value.startsWith('pt_firebase_session='))?.split(';')[0] || response.headers.getSetCookie().find(value => value.startsWith('connect.sid='))?.split(';')[0] || cookie, headers: response.headers };
}
async function intent(purpose = 'signup', headers = {}) { return request('/auth/firebase/intent', { purpose, ...(purpose === 'migration' ? { current_password: privatePassword } : {}) }, undefined, headers); }
async function login(uid = 'new-user', purpose = 'signup') { const grant = await intent(purpose); return request('/auth/firebase/session', { ...grant.data, id_token: uid }, grant.cookie); }
describe('Firebase backend with isolated real PostgreSQL', () => {
  it('fails production startup for unsigned emulator credentials even while Firebase is disabled', () => {
    expect(() => firebaseConfig({ NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' })).toThrow('forbidden');
    expect(() => firebaseConfig({ FIREBASE_AUTH_ENABLED: 'true' })).toThrow('required');
    expect(() => firebaseConfig({ NODE_ENV: 'production', FIREBASE_AUTH_ENABLED: 'true', FIREBASE_PROJECT_ID: project, FRONTEND_URL: 'http://localhost' })).toThrow('HTTPS');
  });
  it('creates only a verified new account, preserves existing IDs, and returns an explicit safe projection', async () => {
    const result = await login(); expect(result.status).toBe(200); expect(result.data.auth_provider).toBe('firebase');
    expect(result.data).not.toHaveProperty('login_disabled'); expect(result.data).not.toHaveProperty('firebase_identity');
    expect(result.headers.get('set-cookie')).toContain('HttpOnly'); expect(result.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect((await request('/auth/me', undefined, result.cookie)).data.id).toBe(result.data.id);
    expect(await prisma.user.count()).toBe(3); expect(await prisma.firebaseIdentity.count()).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: users[0].id } })).not.toBeNull();
  });
  it('rejects forged, wrong-project, unverified and stale tokens without creating any records', async () => {
    for (const override of [{ aud: 'other-project' }, { iss: 'other-issuer' }, { email_verified: false }, { auth_time: 1 }, { auth_time: Date.now() / 1000 + 500 }, { email: 'bad' }]) {
      claimsOverrides = override; expect((await login()).status).toBe(401);
    }
    claimsOverrides = {}; expect((await login('forged')).status).toBe(401); expect(await prisma.firebaseIdentity.count()).toBe(0); expect(await prisma.user.count()).toBe(2);
  });
  it('enforces exact origin/header, strict payload, browser binding and single-use intent', async () => {
    expect((await request('/auth/firebase/intent', { purpose: 'signup' }, undefined, { Origin: 'https://evil.example.test' })).status).toBe(403);
    expect((await request('/auth/firebase/intent', { purpose: 'signup' }, undefined, { 'X-Requested-With': '' })).status).toBe(403);
    expect((await request('/auth/firebase/intent', { purpose: 'signup', user_id: users[0].id })).status).toBe(400);
    const grant = await intent(); const body = { ...grant.data, id_token: 'new-user' };
    expect((await request('/auth/firebase/session', body)).status).toBe(403);
    expect((await request('/auth/firebase/session', { ...body, proof: 'a'.repeat(64) }, grant.cookie)).status).toBe(403);
    expect((await request('/auth/firebase/session', body, grant.cookie)).status).toBe(200);
    expect((await request('/auth/firebase/session', body, grant.cookie)).status).toBe(403);
  });
  it('serializes simultaneous signup without orphan users, with fresh-intent recovery', async () => {
    const first = await intent(), second = await intent();
    const results = await Promise.all([first, second].map(grant => request('/auth/firebase/session', { ...grant.data, id_token: 'same-user' }, grant.cookie)));
    expect(results.some(result => result.status === 200)).toBe(true); expect(await prisma.firebaseIdentity.count()).toBe(1); expect(await prisma.user.count()).toBe(3);
    config.signupEnabled = false;
    const recovered = await login('same-user', 'login'); expect(recovered.status).toBe(200);
    expect((await intent()).status).toBe(403); expect((await login('unknown', 'login')).status).toBe(403);
  });
  it('prevents email-only takeover in both legacy stores', async () => {
    claimsOverrides = { email: users[0].email.toUpperCase() }; expect((await login()).status).toBe(409);
    claimsOverrides = { email: 'legacy-a@profittracker.invalid' }; expect((await login()).status).toBe(409);
    expect(await prisma.user.count()).toBe(2); expect(await prisma.firebaseIdentity.count()).toBe(0);
  });
  it('rejects revoked, disabled, duplicate and mixed cookies, and isolates records by existing UUID', async () => {
    const a = await login('firebase-a'), b = await login('firebase-b');
    await prisma.paymentMethod.create({ data: { user_id: a.data.id, name: 'Private A', type: 'CREDIT_CARD' } });
    expect((await request('/api/records', undefined, b.cookie)).data).toEqual([]);
    expect((await request('/auth/me', undefined, a.cookie + '; ' + a.cookie)).status).toBe(401);
    expect((await request('/auth/me', undefined, 'pt_firebase_session=', { 'X-Fixture-Legacy': users[0].id })).status).toBe(401);
    expect((await request('/auth/me', undefined, a.cookie, { 'X-Fixture-Legacy': users[0].id })).status).toBe(409);
    await prisma.user.update({ where: { id: a.data.id }, data: { login_disabled: true } });
    expect((await request('/auth/me', undefined, a.cookie)).status).toBe(401);
    claimsByCookie.delete(b.cookie.split('=')[1]); expect((await request('/auth/me', undefined, b.cookie)).status).toBe(401);
  });
  it('revokes one session on logout, all sessions on logout-all, and permits recovery after an outage', async () => {
    const a = await login(), b = await login('new-user', 'login');
    expect((await request('/auth/logout', {}, a.cookie)).status).toBe(200); expect((await request('/auth/me', undefined, a.cookie)).status).toBe(401);
    expect((await request('/auth/me', undefined, b.cookie)).status).toBe(200);
    expect((await request('/auth/firebase/logout-all', {}, b.cookie)).status).toBe(200); expect((await request('/auth/me', undefined, b.cookie)).status).toBe(401);
    const fresh = await login('new-user', 'login'); providerFailure = true;
    const failed = await request('/auth/me', undefined, fresh.cookie); expect(failed.status).toBe(503); expect(JSON.stringify(failed.data)).not.toContain('private');
    providerFailure = false; expect((await request('/auth/me', undefined, fresh.cookie)).status).toBe(200);
  });
  it('requires exact owner approval and private-password proof to migrate, preserving all existing records', async () => {
    const headers = { 'X-Fixture-Legacy': users[0].id };
    await prisma.paymentMethod.create({ data: { user_id: users[0].id, name: 'Existing record', type: 'CREDIT_CARD' } });
    const before = await prisma.paymentMethod.findMany();
    let grant = await intent('migration', headers);
    expect((await request('/auth/firebase/link', { ...grant.data, id_token: 'target' }, grant.cookie, headers)).status).toBe(403);
    await approve({ userId: users[0].id, firebaseUid: 'target', prisma, auth: provider, projectId: project });
    grant = await intent('migration', headers);
    const linked = await request('/auth/firebase/link', { ...grant.data, id_token: 'target' }, grant.cookie, headers);
    expect(linked.status).toBe(200); expect(linked.data.id).toBe(users[0].id); expect(linked.data.email).toBe(users[0].email);
    expect((await prisma.localCredential.findUnique({ where: { user_id: users[0].id } })).disabled).toBe(true);
    expect(await prisma.paymentMethod.findMany()).toEqual(before); expect(await prisma.user.count()).toBe(2);
    expect((await login('target', 'login')).data.id).toBe(users[0].id);
  });
  it('rolls back approval and retirement on replay/conflict and rejects stale credential versions', async () => {
    const headers = { 'X-Fixture-Legacy': users[0].id };
    await approve({ userId: users[0].id, firebaseUid: 'target', prisma, auth: provider, projectId: project });
    const grant = await intent('migration', headers);
    await prisma.localCredential.update({ where: { user_id: users[0].id }, data: { version: { increment: 1 } } });
    expect((await request('/auth/firebase/link', { ...grant.data, id_token: 'target' }, grant.cookie, headers)).status).toBe(409);
    expect((await prisma.migrationApproval.findFirst()).consumed).toBe(false);
    expect((await prisma.localCredential.findUnique({ where: { user_id: users[0].id } })).disabled).toBe(false);
    expect(await prisma.firebaseIdentity.count()).toBe(0);
  });
  it('keeps durable API limits when the router is recreated and rejects oversized bodies before handlers', async () => {
    expect((await request('/auth/firebase/intent', { purpose: 'signup', padding: 'x'.repeat(17000) })).status).toBe(413);
    for (let index = 0; index < 39; index++) await request('/auth/firebase/intent', {});
    auth = createFirebaseAuth({ prisma, auth: provider, config });
    expect((await intent()).status).toBe(429);
    expect(await prisma.authAttemptBucket.count()).toBe(2);
    expect((await prisma.authAttemptBucket.findFirst()).count).toBe(41);
  });
  it('preserves data and intent on cookie creation/database failures, then safely retries', async () => {
    const grant = await intent(); const body = { ...grant.data, id_token: 'retry-user' };
    providerFailure = true; const providerError = await request('/auth/firebase/session', body, grant.cookie);
    expect(providerError.status).toBe(503); expect(JSON.stringify(providerError.data)).not.toContain('private'); providerFailure = false;
    cookieFailure = true; expect((await request('/auth/firebase/session', body, grant.cookie)).status).toBe(503); cookieFailure = false;
    sessionWriteFailure = true; const failed = await request('/auth/firebase/session', body, grant.cookie);
    expect(failed.status).toBe(503); expect(failed.cookie).toBe(grant.cookie); expect(await prisma.user.count()).toBe(2); expect(await prisma.firebaseIdentity.count()).toBe(0);
    expect((await prisma.authIntent.findUnique({ where: { id: grant.data.intent } })).consumed).toBe(false);
    sessionWriteFailure = false; expect((await request('/auth/firebase/session', body, grant.cookie)).status).toBe(200);
  });
  it('rolls back migration approval, private credential and mapping when session registration fails', async () => {
    const headers = { 'X-Fixture-Legacy': users[0].id };
    await approve({ userId: users[0].id, firebaseUid: 'target', prisma, auth: provider, projectId: project });
    const grant = await intent('migration', headers); sessionWriteFailure = true;
    expect((await request('/auth/firebase/link', { ...grant.data, id_token: 'target' }, grant.cookie, headers)).status).toBe(503);
    expect((await prisma.migrationApproval.findFirst()).consumed).toBe(false); expect(await prisma.firebaseIdentity.count()).toBe(0);
    const credential = await prisma.localCredential.findUnique({ where: { user_id: users[0].id } }); expect(credential.disabled).toBe(false); expect(credential.version).toBe(1);
  });
  it('rejects simultaneous linkage to the same account and retains one mapping without merging users', async () => {
    const headers = { 'X-Fixture-Legacy': users[0].id };
    await approve({ userId: users[0].id, firebaseUid: 'target', prisma, auth: provider, projectId: project });
    const first = await intent('migration', headers), second = await intent('migration', headers);
    const results = await Promise.all([first, second].map(grant => request('/auth/firebase/link', { ...grant.data, id_token: 'target' }, grant.cookie, headers)));
    expect(results.filter(result => result.status === 200)).toHaveLength(1); expect(await prisma.firebaseIdentity.count()).toBe(1); expect(await prisma.user.count()).toBe(2);
  });
  it('rejects expired grants, temporary-password migration and wrong identity account changes', async () => {
    const grant = await intent(); await prisma.authIntent.update({ where: { id: grant.data.intent }, data: { expires_at: new Date(1) } });
    expect((await request('/auth/firebase/session', { ...grant.data, id_token: 'new-user' }, grant.cookie)).status).toBe(403);
    await prisma.localCredential.update({ where: { user_id: users[0].id }, data: { must_change_password: true } });
    expect((await intent('migration', { 'X-Fixture-Legacy': users[0].id })).status).toBe(401);
    const logged = await login();
    expect((await request('/auth/firebase/account-check', { id_token: 'other-user' }, logged.cookie)).status).toBe(403);
    expect((await request('/auth/firebase/account-check', { id_token: 'new-user' }, logged.cookie)).status).toBe(200);
  });
  it('locally denies all sessions even when remote revocation fails', async () => {
    const first = await login(), second = await login('new-user', 'login'); revokeFailure = true;
    expect((await request('/auth/firebase/logout-all', {}, first.cookie)).status).toBe(503);
    expect((await request('/auth/me', undefined, first.cookie)).status).toBe(401); expect((await request('/auth/me', undefined, second.cookie)).status).toBe(401);
  });
  it('owner disable commits durable denial before provider failure and can retry without changing records', async () => {
    const logged = await login(); revokeFailure = true;
    await expect(disable({ prisma, auth: provider, userId: logged.data.id })).rejects.toThrow('private revoke failure');
    expect((await prisma.user.findUnique({ where: { id: logged.data.id } })).login_disabled).toBe(true);
    expect((await request('/auth/me', undefined, logged.cookie)).status).toBe(401);
    revokeFailure = false; await disable({ prisma, auth: provider, userId: logged.data.id });
    expect(await prisma.user.count()).toBe(3);
  });
  it('owner approvals reject unverified targets, already-mapped identities and unknown existing accounts', async () => {
    const unverified = { ...provider, getUser: async uid => ({ uid, email: 'real@example.test', emailVerified: false }) };
    await expect(approve({ userId: users[0].id, firebaseUid: 'target', prisma, auth: unverified, projectId: project })).rejects.toThrow('verified');
    await expect(approve({ userId: 'unknown-user', firebaseUid: 'target', prisma, auth: provider, projectId: project })).rejects.toThrow('private password');
    await login('mapped');
    await expect(approve({ userId: users[0].id, firebaseUid: 'mapped', prisma, auth: provider, projectId: project })).rejects.toThrow('already linked');
    expect(await prisma.migrationApproval.count()).toBe(0);
  });
});
