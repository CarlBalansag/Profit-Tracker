const express = require('express');
const { z } = require('zod');
const { hashPassword, verifyPassword } = require('../services/passwords');
const { validateBody } = require('../middleware/validate');
const password = z.string().min(1).max(128);
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), password }).strict();
const changeSchema = z.object({ current_password: password, new_password: z.string().min(15).max(128) }).strict();
const publicUser = (user, credential) => ({ id: user.id, username: user.username, email: user.email,
  auth_provider: 'password', accounting_preferences: user.accounting_preferences,
  tutorial_seen: user.tutorial_seen, password_change_required: Boolean(credential?.must_change_password) });
const expired = credential => credential.must_change_password && credential.temporary_expires_at
  && new Date(credential.temporary_expires_at).getTime() <= Date.now();
const call = (object, method, ...args) => new Promise((resolve, reject) => object[method](...args,
  error => error ? reject(error) : resolve()));

function createPasswordAuth({ prisma, clearUserCache = () => {} }) {
  const router = express.Router();
  const attempts = new Map();
  function limit(req, res, next) {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const key = req.ip;
    let entry = attempts.get(key);
    if (!entry) {
      if (attempts.size >= 10000) return res.status(503).json({ error: 'Sign-in is busy. Please try again later.' });
      entry = { count: 0, until: now + 15 * 60 * 1000 };
      attempts.set(key, entry);
    }
    if (++entry.count > 10) {
      const seconds = Math.ceil((entry.until - now) / 1000);
      res.set('Retry-After', String(seconds));
      return res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.', retry_after: seconds });
    }
    next();
  }
  router.post('/login', limit, validateBody(loginSchema), async (req, res, next) => {
    try {
      const credential = await prisma.localCredential.findUnique({ where: { email: req.body.email } });
      const valid = await verifyPassword(req.body.password, credential?.password_hash);
      if (!valid || !credential || credential.disabled || expired(credential))
        return res.status(401).json({ error: 'Email or password is incorrect, or access is unavailable.' });
      const user = await prisma.user.findUnique({ where: { id: credential.user_id } });
      if (!user || user.login_disabled) return res.status(401).json({ error: 'Email or password is incorrect, or access is unavailable.' });
      await call(req, 'logIn', user);
      req.session.authMethod = 'password';
      req.session.credentialVersion = credential.version;
      await call(req.session, 'save');
      res.json(publicUser(user, credential));
    } catch (error) {
      // Do not leave a usable login session when persistence failed.
      if (req.session?.authMethod === 'password') await call(req.session, 'destroy').catch(() => {});
      next(error);
    }
  });
  router.post('/change-password', limit, validateBody(changeSchema), async (req, res, next) => {
    let passwordUpdated = false;
    try {
      if (!req.user || !req.localCredential) return res.status(401).json({ error: 'Sign-in required.' });
      const credential = req.localCredential;
      if (!await verifyPassword(req.body.current_password, credential.password_hash))
        return res.status(401).json({ error: 'Current password is incorrect.' });
      if (req.body.current_password === req.body.new_password)
        return res.status(400).json({ error: 'Choose a different password.' });
      const password_hash = await hashPassword(req.body.new_password);
      const result = await prisma.localCredential.updateMany({
        where: { user_id: req.user.id, version: credential.version, disabled: false },
        data: { password_hash, must_change_password: false, temporary_expires_at: null, version: { increment: 1 } },
      });
      if (result.count !== 1) return res.status(409).json({ error: 'Access changed. Please sign in again.' });
      passwordUpdated = true;
      await call(req.session, 'regenerate');
      await call(req, 'logIn', req.user);
      req.session.authMethod = 'password';
      req.session.credentialVersion = credential.version + 1;
      await call(req.session, 'save');
      clearUserCache(req.user.id);
      res.json(publicUser(req.user, { must_change_password: false }));
    } catch (error) {
      // The password may already have changed; never report success if session saving failed.
      if (req.session) await call(req.session, 'destroy').catch(() => {});
      if (passwordUpdated) {
        console.error('[auth/change-password] session persistence failed after password update');
        return res.status(503).json({ error: 'Password updated, but sign-in could not finish. Sign in using your new password.' });
      }
      next(error);
    }
  });
  async function sessionGuard(req, res, next) {
    try {
      if (req.firebaseIdentity) return next();
      if (!req.user || ['/auth/logout', '/auth/login', '/health', '/auth/discord', '/auth/discord/callback'].includes(req.path)) return next();
      const currentUser = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!currentUser || currentUser.login_disabled) return res.status(401).json({ error: 'Sign-in required.' });
      req.user = currentUser;
      const credential = await prisma.localCredential.findUnique({ where: { user_id: req.user.id } });
      if (req.session.authMethod !== 'password' || !credential || credential.disabled || expired(credential)
        || req.session.credentialVersion !== credential.version) {
        if (['/auth/firebase/intent', '/auth/firebase/session'].includes(req.path)) {
          await call(req.session, 'regenerate');
          req.user = undefined;
          return next();
        }
        await call(req.session, 'destroy');
        return res.status(401).json({ error: 'Sign-in required.' });
      }
      req.localCredential = credential;
      if (credential.must_change_password && (req.path.startsWith('/api/') || (req.path === '/auth/me' && req.method !== 'GET')))
        return res.status(403).json({ error: 'Change your temporary password first.', code: 'PASSWORD_CHANGE_REQUIRED' });
      next();
    } catch (error) { next(error); }
  }
  return { router, sessionGuard, publicUser };
}
module.exports = { createPasswordAuth, publicUser };
