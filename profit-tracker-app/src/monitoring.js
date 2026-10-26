// Sentry is not configured — all calls are no-ops.
// To enable error monitoring, install @sentry/react and set VITE_SENTRY_DSN.
export const captureException = (_error, _context = {}) => {};
