const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Request limits for the data API and the AI-assistant endpoint.
//
// Counted per signed-in user (or per API key), not per network address: the
// website forwards every request through its host, so the address the server
// sees is shared by all users and one busy user would lock everyone out.
// A request with no user falls back to the address; those are only cheap 401s.
//
// Sign-in has its own, stricter limit in routes/firebaseAuth.js (preflight).
// Counters live in this process's memory: enough for one server, and they
// reset on a restart.

const WINDOW_MS = 15 * 60 * 1000;

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

function makeLimiter({ limit, windowMs = WINDOW_MS, key, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => key(req) || `ip:${ipKeyGenerator(req.ip || '')}`,
    message: { error: message },
  });
}

const userKey = (req) => (req.user?.id ? `user:${req.user.id}` : null);
const apiKeyKey = (req) => (req.apiKeyId ? `key:${req.apiKeyId}` : null);

// A page load is 10-20 requests and the busiest polling is once a minute, so
// 1,500 per 15 minutes (100 a minute, sustained) is far above normal use.
const apiLimiter = makeLimiter({
  limit: positiveInt(process.env.API_RATE_LIMIT, 1500),
  key: userKey,
  message: 'Too many requests. Please wait a few minutes and try again.',
});

// One AI assistant working through a statement makes many calls in a row.
const mcpLimiter = makeLimiter({
  limit: positiveInt(process.env.MCP_RATE_LIMIT, 1200),
  key: apiKeyKey,
  message: 'Too many requests from this API key. Please wait a few minutes and try again.',
});

module.exports = { makeLimiter, apiLimiter, mcpLimiter, userKey, apiKeyKey, positiveInt };
