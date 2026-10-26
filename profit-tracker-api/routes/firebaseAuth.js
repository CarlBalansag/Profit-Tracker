const express = require('express');
const { createHash, randomBytes } = require('node:crypto');
const { z } = require('zod');
const { verifyPassword } = require('../services/passwords');
const hash = value => createHash('sha256').update(value).digest('hex');
const SESSION_MS = 5 * 24 * 60 * 60 * 1000;
const TOKEN_SCHEMA = z.object({ id_token: z.string().min(1).max(12000), intent: z.string().uuid(), proof: z.string().length(64) }).strict();
const INTENT_SCHEMA = z.object({ purpose: z.enum(['login', 'signup', 'migration']), current_password: z.string().min(1).max(128).optional() }).strict();
const PUBLIC_ERROR = Symbol('publicAuthError');
const fail = (status, message) => Object.assign(new Error(message), { status, [PUBLIC_ERROR]: true });
const publicUser = user => ({ id: user.id, username: user.username, email: user.email,
  accounting_preferences: user.accounting_preferences, tutorial_seen: user.tutorial_seen,
  auth_provider: 'firebase', password_change_required: false });
const save = session => new Promise((resolve, reject) => session.save(error => error ? reject(error) : resolve()));
const INVALID = new Set(['auth/argument-error', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token',
  'auth/session-cookie-expired', 'auth/session-cookie-revoked', 'auth/invalid-session-cookie', 'auth/user-disabled', 'auth/user-not-found']);

function createFirebaseAuth({ prisma, auth, config }) {
  const router = express.Router();
  const cookieName = config.production ? '__Host-pt_firebase_session' : 'pt_firebase_session';
  const cookieOptions = { secure: config.production, httpOnly: true, path: '/', sameSite: 'lax' };
  let activeCalls = 0;
  async function provider(method, ...args) {
    if (activeCalls >= 20) throw fail(503, 'Authentication is busy. Please retry.');
    activeCalls++;
    // Keep the slot until the actual SDK call finishes, even if the response times out.
    const operation = Promise.resolve().then(() => auth[method](...args)).finally(() => { activeCalls--; });
    let timer;
    try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(fail(503, 'Authentication unavailable. Please retry.')), 10000); })]); }
    finally { clearTimeout(timer); }
  }
  function cookie(req) {
    const entries = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
    if (entries.length > 1) throw fail(401, 'Sign-in required.');
    const value = entries[0]?.slice(cookieName.length + 1);
    if (entries.length && !value) throw fail(401, 'Sign-in required.');
    if (value && value.length > 16000) throw fail(401, 'Sign-in required.');
    return value;
  }
  const safe = handler => async (req, res, next) => {
    try { await handler(req, res, next); }
    catch (error) {
      const status = error[PUBLIC_ERROR] ? error.status : (INVALID.has(error.code) ? 401 : error.code === 'P2002' ? 409 : 503);
      // Never forward provider errors/tokens to general logging or monitoring.
      res.status(status).json({ error: error[PUBLIC_ERROR] ? error.message : status === 401 ? 'Sign-in required.' : status === 409 ? 'Account conflict. Contact the owner.' : 'Authentication unavailable. Please retry.' });
    }
  };
  const preflight = safe(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!config.enabled) throw fail(503, 'Firebase sign-in is not configured.');
    if (req.method === 'OPTIONS') return next();
    if (req.get('Origin') !== config.frontend || req.get('X-Requested-With') !== 'XMLHttpRequest') throw fail(403, 'CSRF check failed.');
    const now = Date.now(), window = 15 * 60 * 1000;
    const expires_at = new Date((Math.floor(now / window) + 1) * window);
    const key = hash(`${req.ip}|${Math.floor(now / window)}`);
    // Serialized upsert is durable across processes/restarts. One bucket per network/window.
    await prisma.authAttemptBucket.deleteMany({ where: { expires_at: { lt: new Date(now) } } });
    const globalKey = hash(`global|${Math.floor(now / window)}`);
    const globalBucket = await prisma.authAttemptBucket.upsert({ where: { key: globalKey }, create: { key: globalKey, expires_at }, update: { count: { increment: 1 } } });
    if (globalBucket.count > 5000) throw fail(503, 'Authentication is busy. Please retry later.');
    const bucket = await prisma.authAttemptBucket.upsert({ where: { key }, create: { key, expires_at }, update: { count: { increment: 1 } } });
    if (bucket.count > 40) { res.set('Retry-After', String(Math.ceil((expires_at.getTime() - now) / 1000))); throw fail(429, 'Too many authentication attempts. Please try later.'); }
    next();
  });
  async function verified(token) {
    const claims = await provider('verifyIdToken', token, true);
    const now = Date.now() / 1000;
    if (claims.aud !== config.projectId || claims.iss !== `https://securetoken.google.com/${config.projectId}` || !claims.uid
      || !claims.email_verified || !z.string().email().max(254).safeParse(claims.email).success
      || !Number.isFinite(claims.auth_time) || now - claims.auth_time > 300 || claims.auth_time > now + 30) throw fail(401, 'Verify your email and sign in again.');
    return claims;
  }
  async function guard(req, res, next) {
    return safe(async () => {
      const value = cookie(req);
      if (!value) return next();
      if (!config.enabled) throw fail(503, 'Authentication unavailable.');
      const claims = await provider('verifySessionCookie', value, true);
      if (claims.aud !== config.projectId || claims.iss !== `https://session.firebase.google.com/${config.projectId}` || !claims.email_verified) throw fail(401, 'Sign-in required.');
      const row = await prisma.firebaseSession.findUnique({ where: { fingerprint: hash(value) }, include: { identity: { include: { user: true } } } });
      if (!row || row.revoked || row.expires_at <= new Date() || row.identity.project_id !== config.projectId
        || row.identity.firebase_uid !== claims.uid || row.identity.user.login_disabled) throw fail(401, 'Sign-in required.');
      if (req.user && req.user.id !== row.identity.user_id) throw fail(409, 'Conflicting sessions. Sign out and try again.');
      req.user = row.identity.user;
      req.firebaseIdentity = row.identity;
      req.firebaseFingerprint = row.fingerprint;
      next();
    })(req, res, next);
  }
  router.post('/intent', safe(async (req, res) => {
    const parsed = INTENT_SCHEMA.safeParse(req.body);
    if (!parsed.success) throw fail(400, 'Invalid authentication request.');
    const { purpose, current_password } = parsed.data;
    if (purpose !== 'migration' && req.user) throw fail(409, 'Sign out before changing accounts.');
    if (purpose === 'signup' && !config.signupEnabled) throw fail(403, 'Registration is not open yet.');
    if (purpose === 'migration') {
      if (!req.user || !req.localCredential || req.localCredential.must_change_password || req.user.login_disabled
        || !current_password || !await verifyPassword(current_password, req.localCredential.password_hash)) throw fail(401, 'Sign in with your private existing password first.');
    } else if (current_password !== undefined) throw fail(400, 'Invalid authentication request.');
    req.session.firebaseIntent = true;
    await save(req.session);
    const proof = randomBytes(32).toString('hex');
    await prisma.authIntent.deleteMany({ where: { expires_at: { lt: new Date() } } });
    await prisma.firebaseSession.deleteMany({ where: { expires_at: { lt: new Date() } } });
    const intent = await prisma.authIntent.create({ data: { purpose, proof_hash: hash(proof), session_hash: hash(req.sessionID),
      expires_at: new Date(Date.now() + 300000), user_id: purpose === 'migration' ? req.user.id : null,
      credential_version: purpose === 'migration' ? req.localCredential.version : null } });
    res.json({ intent: intent.id, proof });
  }));
  async function exchange(req, res, migration) {
    const parsed = TOKEN_SCHEMA.safeParse(req.body);
    if (!parsed.success) throw fail(400, 'Invalid authentication request.');
    const { intent, proof, id_token } = parsed.data;
    const claims = await verified(id_token);
    const value = await provider('createSessionCookie', id_token, { expiresIn: SESSION_MS });
    const fingerprint = hash(value);
    const whereIdentity = { project_id_firebase_uid: { project_id: config.projectId, firebase_uid: claims.uid } };
    const user = await prisma.$transaction(async tx => {
      const grant = await tx.authIntent.findUnique({ where: { id: intent } });
      if (!grant || grant.consumed || grant.expires_at <= new Date() || grant.session_hash !== hash(req.sessionID)
        || grant.proof_hash !== hash(proof) || (migration ? grant.purpose !== 'migration' : !['login', 'signup'].includes(grant.purpose))) throw fail(403, 'Authentication request expired. Please retry.');
      let identity = await tx.firebaseIdentity.findUnique({ where: whereIdentity, include: { user: true } });
      if (migration) {
        if (!req.user || req.firebaseIdentity || !req.localCredential || req.localCredential.must_change_password
          || grant.user_id !== req.user.id || grant.credential_version !== req.localCredential.version || identity) throw fail(409, 'Migration unavailable. Contact the owner.');
        const account = await tx.user.findUnique({ where: { id: req.user.id } });
        if (!account || account.login_disabled) throw fail(401, 'Sign-in required.');
        const approval = await tx.migrationApproval.findFirst({ where: { user_id: account.id, project_id: config.projectId, firebase_uid: claims.uid, consumed: false, expires_at: { gt: new Date() } } });
        if (!approval || (await tx.migrationApproval.updateMany({ where: { id: approval.id, consumed: false }, data: { consumed: true } })).count !== 1) throw fail(403, 'Owner approval required for this identity.');
        const retired = await tx.localCredential.updateMany({ where: { user_id: account.id, version: grant.credential_version, disabled: false, must_change_password: false }, data: { disabled: true, version: { increment: 1 } } });
        if (retired.count !== 1) throw fail(409, 'Access changed. Sign in again.');
        identity = await tx.firebaseIdentity.create({ data: { project_id: config.projectId, firebase_uid: claims.uid, user_id: account.id, email: claims.email }, include: { user: true } });
      } else {
        if (req.user) throw fail(409, 'Sign out before changing accounts.');
        if (!identity) {
          if (grant.purpose !== 'signup' || !config.signupEnabled) throw fail(403, 'Account not registered. Use signup or contact the owner.');
          const email = claims.email.toLowerCase();
          if (await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })
            || await tx.localCredential.findUnique({ where: { email } })) throw fail(409, 'Account conflict. Contact the owner to preserve your records.');
          identity = await tx.firebaseIdentity.create({ data: { project_id: config.projectId, firebase_uid: claims.uid, email,
            user: { create: { email, username: email.split('@')[0].slice(0, 80), auth_provider: 'firebase' } } }, include: { user: true } });
        }
      }
      if (identity.user.login_disabled) throw fail(401, 'Sign-in required.');
      if ((await tx.authIntent.updateMany({ where: { id: grant.id, consumed: false, expires_at: { gt: new Date() } }, data: { consumed: true } })).count !== 1) throw fail(409, 'Authentication request already used. Please retry.');
      const existingSession = await tx.firebaseSession.findUnique({ where: { fingerprint } });
      if (existingSession) {
        if (existingSession.identity_id !== identity.id || existingSession.revoked || existingSession.expires_at <= new Date()) throw fail(401, 'Sign in again to establish a fresh session.');
      } else await tx.firebaseSession.create({ data: { fingerprint, identity_id: identity.id, expires_at: new Date(Date.now() + SESSION_MS) } });
      return identity.user;
    });
    // Commit is the boundary: a lost response is recovered by a fresh Firebase login.
    if (migration && req.session) await new Promise(resolve => req.session.destroy(() => resolve()));
    res.clearCookie('connect.sid', { path: '/' });
    res.cookie(cookieName, value, { ...cookieOptions, maxAge: SESSION_MS });
    res.json(publicUser(user));
  }
  router.post('/session', safe((req, res) => exchange(req, res, false)));
  router.post('/link', safe((req, res) => exchange(req, res, true)));
  router.post('/account-check', safe(async (req, res) => {
    if (!req.firebaseIdentity) throw fail(401, 'Firebase sign-in required.');
    const parsed = z.object({ id_token: z.string().min(1).max(12000) }).strict().safeParse(req.body);
    if (!parsed.success) throw fail(400, 'Invalid authentication request.');
    const claims = await verified(parsed.data.id_token);
    if (claims.uid !== req.firebaseIdentity.firebase_uid) throw fail(403, 'Use the identity for this account.');
    res.json({ success: true });
  }));
  const logout = safe(async (req, res) => {
    const fingerprints = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`)).map(part => hash(part.slice(cookieName.length + 1)));
    if (fingerprints.length) await prisma.firebaseSession.updateMany({ where: { fingerprint: { in: fingerprints } }, data: { revoked: true } });
    res.clearCookie(cookieName, cookieOptions);
    if (req.session) await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ success: true });
  });
  router.post('/logout-all', safe(async (req, res) => {
    if (!z.object({}).strict().safeParse(req.body || {}).success) throw fail(400, 'Invalid authentication request.');
    if (!req.firebaseIdentity) throw fail(401, 'Firebase sign-in required.');
    await prisma.firebaseSession.updateMany({ where: { identity_id: req.firebaseIdentity.id }, data: { revoked: true } });
    res.clearCookie(cookieName, cookieOptions);
    await provider('revokeRefreshTokens', req.firebaseIdentity.firebase_uid);
    res.json({ success: true });
  }));
  return { router, guard, preflight, logout, publicUser, cookieName };
}
module.exports = { createFirebaseAuth, hash };
