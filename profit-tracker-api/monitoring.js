const Sentry = require('@sentry/node');

const enabled = Boolean(process.env.SENTRY_DSN);

// Tax, Schedule C and email requests carry a user's own financial details
// (and, for email, a mail password). The SDK
// can attach request bodies, query strings and cookies to an error report on
// its own, so they are dropped for those routes before anything is sent.
const PRIVATE_PATHS = /^\/(api\/(tax|schedule-c|email)|internal\/email)(\/|\?|$)/;
function scrubEvent(event) {
  const req = event?.request;
  if (!req) return event;
  let path = '';
  try { path = new URL(req.url || '', 'http://local').pathname; } catch { path = String(req.url || ''); }
  if (PRIVATE_PATHS.test(path)) {
    delete req.data;
    delete req.query_string;
    delete req.cookies;
    if (req.url) req.url = req.url.split('?')[0];
  }
  return event;
}

if (enabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    beforeSend: scrubEvent,
  });
}

module.exports = {
  enabled,
  scrubEvent,
  captureException(error, context = {}) {
    if (!enabled) return;
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value);
      });
      Sentry.captureException(error);
    });
  },
};
