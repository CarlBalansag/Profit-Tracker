const express = require('express');
const cors = require('cors');
const prisma = require('./prisma');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
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
require('dotenv').config();

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Guard: refuse to start without a proper session secret (all environments)
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('FATAL: SESSION_SECRET must be set to a string of at least 32 characters.');
  process.exit(1);
}

// Trust Render's reverse proxy so secure cookies work over HTTPS
if (isProd) app.set('trust proxy', 1);

// Allow frontend connection with credentials
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// CSRF protection: every state-changing request from the SPA must include this header.
// Browsers never attach custom headers to cross-origin simple requests, so its presence
// proves the request came from JavaScript running on our frontend, not a forged form.
app.use((req, res, next) => {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') return next();
  return res.status(403).json({ error: 'CSRF check failed' });
});

// Session Middleware — stored in PostgreSQL so logins survive server restarts/redeploys
app.use(session({
  store: new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'user_sessions',
    createTableIfMissing: true,
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

// Passport Discord Strategy setup
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email']
  },
  async function(accessToken, refreshToken, profile, done) {
    try {
      // Find or Create user in our DB
      let user = await prisma.user.findUnique({
        where: { discord_id: profile.id }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            discord_id: profile.id,
            username: profile.username,
            email: profile.email || `${profile.id}@discord.com`, // Fallback
            auth_provider: 'discord'
          }
        });
      }

      return done(null, user);
    } catch (error) {
      console.error(error);
      return done(error, null);
    }
  }
));

// Serialization to save user in session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialization to attach user info to req.user
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: id } });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
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

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Auth Routes
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: `${FRONTEND_URL}/login?error=true` }),
  (req, res) => {
    res.redirect(`${FRONTEND_URL}/`);
  }
);

// Current Session Route
app.get('/auth/me', (req, res) => {
  if (req.user) {
    res.json(req.user);
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
});

// Logout Route
app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.json({ success: true });
  });
});

// Central error handler — never expose raw error messages in production
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const message = isProd ? 'Internal Server Error' : err.message;
  res.status(err.status || 500).json({ error: message });
});

// Default Port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Profit Tracker API server running on port ${PORT}`);
});
