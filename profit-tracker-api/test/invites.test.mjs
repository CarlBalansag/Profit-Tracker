import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
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
const { createInvitesRouter, isAdmin } = require('../routes/invites');

let pg, prisma, server, base, config, provider, auth, adminUser, regularUser;
const adminEmail = 'admin@example.test';
const userClaims = uid => ({ uid, aud: 'demo-profittracker', iss: 'https://securetoken.google.com/demo-profittracker', email: `${uid}@example.test`, email_verified: true, auth_time: Date.now() / 1000 });

describe('Admin Invites System', () => {
  beforeAll(async () => {
    process.env.ADMIN_EMAILS = `carl.c.balansag@gmail.com, ${adminEmail}`;
    const socket = createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));

    const directory = await mkdtemp(join(tmpdir(), 'profittracker-invites-qa-'));
    pg = new EmbeddedPostgres({
      databaseDir: join(directory, 'db'),
      port,
      user: 'postgres',
      password: 'isolated-qa-only',
      persistent: true,
      onLog: () => {},
      onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('invites_qa');

    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/invites_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      stdio: 'pipe',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
  }, 60000);

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    if (pg) await pg.stop();
  });

  beforeEach(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.$transaction([
      prisma.invite.deleteMany(),
      prisma.firebaseSession.deleteMany(),
      prisma.firebaseIdentity.deleteMany(),
      prisma.authIntent.deleteMany(),
      prisma.user.deleteMany(),
    ]);

    adminUser = await prisma.user.create({
      data: { email: adminEmail, username: 'admin' },
    });
    regularUser = await prisma.user.create({
      data: { email: 'regular@example.test', username: 'regular' },
    });

    config = {
      enabled: true,
      production: false,
      projectId: 'demo-profittracker',
      signupEnabled: false, // public signup is OFF
      frontend: 'http://frontend.example.test',
    };

    provider = {
      verifyIdToken: async uid => userClaims(uid),
      createSessionCookie: async uid => `cookie-for-${uid}`,
      verifySessionCookie: async cookie => ({ uid: cookie.replace('cookie-for-', ''), email: 'verified@example.test' }),
      revokeRefreshTokens: async () => {},
      getUser: async uid => ({ uid, email: `${uid}@example.test`, emailVerified: true }),
    };

    auth = createFirebaseAuth({ prisma, auth: provider, config });

    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'invites-qa-secret-long-enough-32-chars', resave: false, saveUninitialized: false }));

    // Mock authentication via header
    app.use(async (req, res, next) => {
      const authHeader = req.get('X-User-Id');
      if (authHeader) {
        req.user = await prisma.user.findUnique({ where: { id: authHeader } });
      }
      next();
    });

    const invitesRouter = createInvitesRouter({ prisma });
    app.use('/auth/firebase', auth.router);
    app.use('/api/invites', invitesRouter);
    app.get('/auth/me', (req, res) => req.user ? res.json(auth.publicUser(req.user)) : res.sendStatus(401));

    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  async function request(path, options = {}) {
    const response = await fetch(base + path, {
      method: options.method || (options.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(options.userId ? { 'X-User-Id': options.userId } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...options.headers,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    let data;
    try { data = await response.json(); } catch { data = null; }
    const setCookie = response.headers.getSetCookie?.() || [];
    const cookie = setCookie.find(value => value.startsWith('connect.sid='))?.split(';')[0] || options.cookie;
    return { status: response.status, data, cookie, headers: response.headers };
  }

  describe('isAdmin check', () => {
    it('correctly identifies admin emails', () => {
      expect(isAdmin(adminEmail)).toBe(true);
      expect(isAdmin('ADMIN@example.TEST')).toBe(true);
      expect(isAdmin('carl.c.balansag@gmail.com')).toBe(true);
      expect(isAdmin('regular@example.test')).toBe(false);
      expect(isAdmin(null)).toBe(false);
      expect(isAdmin(undefined)).toBe(false);
    });

    it('serializes is_admin in publicUser', async () => {
      const adminRes = await request('/auth/me', { userId: adminUser.id });
      expect(adminRes.status).toBe(200);
      expect(adminRes.data.is_admin).toBe(true);

      const regRes = await request('/auth/me', { userId: regularUser.id });
      expect(regRes.status).toBe(200);
      expect(regRes.data.is_admin).toBe(false);
    });
  });

  describe('Invites CRUD & Validation', () => {
    it('rejects unauthenticated requests to create invite', async () => {
      const res = await request('/api/invites', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('rejects non-admin users from creating an invite', async () => {
      const res = await request('/api/invites', { method: 'POST', userId: regularUser.id });
      expect(res.status).toBe(403);
      expect(res.data.error).toBe('Admin access required.');
    });

    it('allows admin to create a 3-day single-use invite', async () => {
      const before = Date.now();
      const res = await request('/api/invites', { method: 'POST', userId: adminUser.id });
      expect(res.status).toBe(201);
      expect(res.data.token).toBeDefined();
      expect(res.data.token.length).toBe(48); // 24 hex bytes
      expect(res.data.status).toBe('active');
      expect(res.data.consumed).toBe(false);

      const expiresAt = new Date(res.data.expires_at).getTime();
      const expectedMin = before + 3 * 24 * 60 * 60 * 1000 - 5000;
      const expectedMax = before + 3 * 24 * 60 * 60 * 1000 + 5000;
      expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt).toBeLessThanOrEqual(expectedMax);
    });

    it('lists invites for admin', async () => {
      await request('/api/invites', { method: 'POST', userId: adminUser.id });
      await request('/api/invites', { method: 'POST', userId: adminUser.id });

      const res = await request('/api/invites', { userId: adminUser.id });
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(2);
      expect(res.data[0].status).toBe('active');
    });

    it('allows admin to delete an invite', async () => {
      const created = await request('/api/invites', { method: 'POST', userId: adminUser.id });
      const del = await request(`/api/invites/${created.data.id}`, { method: 'DELETE', userId: adminUser.id });
      expect(del.status).toBe(200);

      const list = await request('/api/invites', { userId: adminUser.id });
      expect(list.data.length).toBe(0);
    });

    it('validates a fresh invite token publicly', async () => {
      const created = await request('/api/invites', { method: 'POST', userId: adminUser.id });
      const val = await request(`/api/invites/validate?token=${created.data.token}`);
      expect(val.status).toBe(200);
      expect(val.data.valid).toBe(true);
      expect(val.data.expires_at).toBeDefined();
    });

    it('rejects invalid or non-existent token on validation', async () => {
      const val = await request('/api/invites/validate?token=nonexistenttoken12345678');
      expect(val.status).toBe(404);
      expect(val.data.valid).toBe(false);
      expect(val.data.reason).toBe('not_found');
    });

    it('rejects expired token on validation', async () => {
      const token = 'expiredtoken1234567890abcdef1234';
      await prisma.invite.create({
        data: {
          token_hash: hash(token),
          created_by: adminUser.id,
          expires_at: new Date(Date.now() - 10000), // in the past
        }
      });
      const val = await request(`/api/invites/validate?token=${token}`);
      expect(val.status).toBe(410);
      expect(val.data.valid).toBe(false);
      expect(val.data.reason).toBe('expired');
    });

    it('rejects consumed token on validation', async () => {
      const token = 'consumedtoken1234567890abcdef123';
      await prisma.invite.create({
        data: {
          token_hash: hash(token),
          created_by: adminUser.id,
          expires_at: new Date(Date.now() + 100000),
          consumed: true,
          used_by: 'used@example.test',
        }
      });
      const val = await request(`/api/invites/validate?token=${token}`);
      expect(val.status).toBe(410);
      expect(val.data.valid).toBe(false);
      expect(val.data.reason).toBe('consumed');
    });
  });

  describe('Registration flow with Invite', () => {
    it('refuses signup intent when public signup is off and no invite token is given', async () => {
      const res = await request('/auth/firebase/intent', {
        body: { purpose: 'signup' },
      });
      expect(res.status).toBe(403);
      expect(res.data.error).toBe('Registration is not open yet.');
    });

    it('refuses signup intent with an invalid invite token', async () => {
      const res = await request('/auth/firebase/intent', {
        body: { purpose: 'signup', invite_token: 'invalidtoken123456789012' },
      });
      expect(res.status).toBe(403);
      expect(res.data.error).toBe('Invite link is invalid, expired, or has already been used.');
    });

    it('accepts signup intent with a valid invite token', async () => {
      const created = await request('/api/invites', { method: 'POST', userId: adminUser.id });
      const res = await request('/auth/firebase/intent', {
        body: { purpose: 'signup', invite_token: created.data.token },
      });
      expect(res.status).toBe(200);
      expect(res.data.intent).toBeDefined();
      expect(res.data.proof).toBeDefined();
    });

    it('successfully registers a new user with invite and marks invite consumed', async () => {
      const created = await request('/api/invites', { method: 'POST', userId: adminUser.id });
      const intentRes = await request('/auth/firebase/intent', {
        body: { purpose: 'signup', invite_token: created.data.token },
      });

      // Complete session exchange
      const newUserUid = 'new-invited-user';
      const sessionRes = await request('/auth/firebase/session', {
        cookie: intentRes.cookie,
        body: {
          intent: intentRes.data.intent,
          proof: intentRes.data.proof,
          id_token: newUserUid,
          invite_token: created.data.token,
        },
      });

      expect(sessionRes.status).toBe(200);
      expect(sessionRes.data.email).toBe(`${newUserUid}@example.test`);

      // Verify DB user was created
      const dbUser = await prisma.user.findUnique({ where: { email: `${newUserUid}@example.test` } });
      expect(dbUser).toBeDefined();
      expect(dbUser.auth_provider).toBe('firebase');

      // Verify invite was marked consumed
      const dbInvite = await prisma.invite.findUnique({ where: { id: created.data.id } });
      expect(dbInvite.consumed).toBe(true);
      expect(dbInvite.used_by).toBe(`${newUserUid}@example.test`);

      // Second attempt to register with the same invite fails
      const intentRes2 = await request('/auth/firebase/intent', {
        body: { purpose: 'signup', invite_token: created.data.token },
      });
      expect(intentRes2.status).toBe(403);
      expect(intentRes2.data.error).toBe('Invite link is invalid, expired, or has already been used.');
    });
  });
});
