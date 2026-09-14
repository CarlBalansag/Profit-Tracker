require('dotenv').config();
const monitoring = require('./monitoring');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const prisma = require('./prisma');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const { createPasswordAuth } = require('./routes/passwordAuth');
const { firebaseConfig, getFirebaseAuth } = require('./services/firebase');
const { createFirebaseAuth } = require('./routes/firebaseAuth');
const paymentMethodsRouter = require('./routes/paymentMethods');
const inventoryRouter = require('./routes/inventory');
const salesRouter = require('./routes/sales');
const platformsRouter = require('./routes/platforms');
const analyticsRouter = require('./routes/analytics');
const accountsRouter = require('./routes/accounts');
const preferencesRouter = require('./routes/preferences');
const expensesRouter = require('./routes/expenses');
const recurringExpensesRouter = require('./routes/recurringExpenses');
const receiptsRouter = require('./routes/receipts');
const creditCardRouter = require('./routes/creditcard');
const ebayPriceRouter = require('./routes/ebayPrice');
const goalsRouter = require('./routes/goals');
const productNotesRouter = require('./routes/productNotes');
const calendarEventsRouter = require('./routes/calendarEvents');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const firebaseSettings = firebaseConfig();
const firebaseAuth = createFirebaseAuth({ prisma, config: firebaseSettings, auth: getFirebaseAuth(firebaseSettings) });

// Startup env dump — remove after debugging
console.log('[ENV CHECK] NODE_ENV =', process.env.NODE_ENV);
console.log('[ENV CHECK] FRONTEND_URL =', process.env.FRONTEND_URL);
console.log('[ENV CHECK] DISCORD_CALLBACK_URL =', process.env.DISCORD_CALLBACK_URL);
console.log('[ENV CHECK] DISCORD_CLIENT_ID =', process.env.DISCORD_CLIENT_ID);

// Guard: refuse to start without a proper session secret (all environments)
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('FATAL: SESSION_SECRET must be set to a string of at least 32 characters.');
  process.exit(1);
}

// Trust Render's reverse proxy so secure cookies work over HTTPS
if (isProd) app.set('trust proxy', 1);

// Compress all responses — cuts JSON payload size by ~65-75%
app.use(compression());
app.use('/auth', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Allow frontend connection with credentials
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
// A 5 MiB receipt expands to roughly 6.7 MiB when sent as base64 JSON.
app.use('/auth/firebase', firebaseAuth.preflight, express.json({ limit: '16kb' }));
app.use(express.json({ limit: '7mb' }));

// CSRF protection: every state-changing request from the SPA must include this header.
// Browsers never attach custom headers to cross-origin simple requests, so its presence
// proves the request came from JavaScript running on our frontend, not a forged form.
app.use((req, res, next) => {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();
  if (req.get('Origin') !== FRONTEND_URL) return res.status(403).json({ error: 'CSRF check failed' });
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') return next();
  return res.status(403).json({ error: 'CSRF check failed' });
});

// Session pool — uses DIRECT_URL (non-pooled Neon) so connect-pg-simple can
// use persistent connections. Strip channel_binding param which node-postgres
// does not support as a query string parameter.
const rawSessionUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || '';
const sessionDbUrl = rawSessionUrl.replace(/([?&])channel_binding=[^&]*/g, (_, sep) => sep);
const sessionPool = new Pool({
  connectionString: sessionDbUrl,
  ssl: isProd ? { rejectUnauthorized: false } : false,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
sessionPool.on('error', (err) => {
  console.error('[session-pool] idle client error:', err.message);
});
sessionPool.query('SELECT 1')
  .then(() => console.log('[session-pool] Neon DB reachable'))
  .catch((err) => console.error('[session-pool] Neon DB NOT reachable:', err.message));

// Session Middleware — stored in PostgreSQL so logins survive server restarts/redeploys
app.use(session({
  store: new pgSession({
    pool: sessionPool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
    errorLog: (...args) => console.error('[pg-session-store]', ...args),
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,        // HTTPS only in production
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',  // cross-origin cookies in production
    maxAge: 1000 * 60 * 60 * 24 * 30   // 30 days in ms
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Passport session deserialization
// Retry helper for transient Neon cold-start errors (P1001, P2024)
const NEON_RETRYABLE = new Set(['P1001', 'P2024']);
async function withDbRetry(fn, retries = 3, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = NEON_RETRYABLE.has(err.code);
      console.warn(`[db-retry] attempt ${i + 1} failed (code=${err.code}):`, err.message);
      if (!isRetryable || i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// Serialization to save user in session
passport.serializeUser((user, done) => {
  console.log('[serializeUser] serializing user id:', user.id);
  done(null, user.id);
});

// Deserialization to attach user info to req.user.
const userCache = new Map();
const USER_CACHE_TTL = 5 * 60 * 1000;
const clearUserCache = (id) => userCache.delete(id);

passport.deserializeUser(async (id, done) => {
  console.log('[deserializeUser] deserializing id:', id);
  try {
    const cached = userCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      console.log('[deserializeUser] cache hit for id:', id);
      return done(null, cached.user);
    }
    const user = await withDbRetry(() => prisma.user.findUnique({ where: { id } }));
    console.log('[deserializeUser] DB lookup result:', user ? `found user ${user.id}` : 'NOT FOUND');
    if (user) userCache.set(id, { user, expiresAt: Date.now() + USER_CACHE_TTL });
    done(null, user);
  } catch (error) {
    console.error('[deserializeUser] error after retries:', error.message);
    done(error, null);
  }
});

const passwordAuth = createPasswordAuth({ prisma, clearUserCache });
app.use((req, res, next) => req.path === '/auth/logout' ? next() : firebaseAuth.guard(req, res, next));
app.use(passwordAuth.sessionGuard);
app.use('/auth', passwordAuth.router);
app.use('/auth/firebase', firebaseAuth.router);
// Parser failures must not reach general telemetry with a token-containing request body.
app.use('/auth/firebase', (err, req, res, next) => {
  res.status(err.status === 413 ? 413 : 400).json({ error: err.status === 413 ? 'Authentication request too large.' : 'Invalid authentication request.' });
});

// --- ROUTES ---
app.use('/api/payment-methods', paymentMethodsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/sales', salesRouter);
app.use('/api/platforms', platformsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/recurring-expenses', recurringExpensesRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/creditcard', creditCardRouter);
app.use('/api/ebay-price', ebayPriceRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/product-notes', productNotesRouter);
app.use('/api/calendar-events', calendarEventsRouter);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Retired Discord entry points never contact Discord or create accounts.
app.get(['/auth/discord', '/auth/discord/callback'], (req, res) => res.redirect(`${FRONTEND_URL}/login`));

// Current Session Route
app.get('/auth/me', (req, res) => {
  if (req.user) {
    res.json(req.firebaseIdentity ? firebaseAuth.publicUser(req.user) : passwordAuth.publicUser(req.user, req.localCredential));
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
});

// Mark tutorial as seen
app.patch('/auth/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
  const { tutorial_seen } = req.body;
  if (typeof tutorial_seen !== 'boolean') return res.status(400).json({ message: 'Invalid payload' });
  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { tutorial_seen },
  });
  clearUserCache(req.user.id);
  res.json(req.firebaseIdentity ? firebaseAuth.publicUser(updated) : passwordAuth.publicUser(updated, req.localCredential));
});

// Logout Route — remove Passport state, the persisted server session, and the browser cookie.
app.post('/auth/logout', (req, res, next) => {
  if (req.headers.cookie?.includes(`${firebaseAuth.cookieName}=`)) return firebaseAuth.logout(req, res, next);
  const userId = req.user?.id;
  req.logout((err) => {
    if (err) { return next(err); }
    const cookieOptions = {
      path: '/',
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
    };
    res.clearCookie('connect.sid', cookieOptions);
    req.session.destroy((destroyErr) => {
      if (destroyErr) return next(destroyErr);
      if (userId) clearUserCache(userId);
      res.json({ success: true });
    });
  });
});

// Central error handler — never expose raw error messages in production
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  monitoring.captureException(err, {
    request: {
      method: req.method,
      path: req.path,
      userId: req.user?.id,
    },
  });
  const message = isProd ? 'Internal Server Error' : err.message;
  res.status(err.status || 500).json({ error: message });
});

// Default Port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Profit Tracker API server running on port ${PORT}`);
});
