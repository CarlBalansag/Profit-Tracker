const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const paymentMethodsRouter = require('./routes/paymentMethods');
const inventoryRouter = require('./routes/inventory');
const salesRouter = require('./routes/sales');
const platformsRouter = require('./routes/platforms');
const analyticsRouter = require('./routes/analytics');
const accountsRouter = require('./routes/accounts');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();

// Allow frontend connection with credentials
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Session Middleware — persisted to disk so logins survive server restarts
app.use(session({
  store: new FileStore({
    path: './sessions',
    ttl: 60 * 60 * 24 * 30,
    retries: 5,
    retryDelay: 200,
    reapInterval: -1,       // disable background cleanup (avoids EPERM on Windows)
    reapSyncFallback: false, // don't attempt sync rename fallback
    logFn: () => {}         // suppress file-store noise
  }),
  secret: process.env.SESSION_SECRET || 'profit_tracker_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,     // localhost HTTP
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 30  // 30 days in ms
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

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Auth Routes
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: 'http://localhost:5173/login?error=true' }),
  (req, res) => {
    // Successful authentication, redirect to frontend dashboard
    res.redirect('http://localhost:5173/');
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

// Default Port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log(`Profit Tracker API server running on port ${PORT}`);
});
