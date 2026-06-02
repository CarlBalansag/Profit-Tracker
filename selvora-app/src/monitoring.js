let Sentry = null;
const enabled = Boolean(import.meta.env.VITE_SENTRY_DSN);

if (enabled) {
  import('@sentry/react').then((mod) => {
    Sentry = mod;
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0),
    });
  });
}

export const captureException = (error, context = {}) => {
  if (!enabled || !Sentry) return;
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setContext(key, value);
    });
    Sentry.captureException(error);
  });
};
