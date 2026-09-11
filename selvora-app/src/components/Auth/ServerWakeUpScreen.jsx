import React, { useEffect, useState } from 'react';

const WARMUP_WINDOW_MS = 75_000;

function getStatus(elapsedMs, attempt, failed) {
  if (failed) {
    return {
      title: 'The server is still unavailable',
      description: 'It may be waking up or temporarily offline. You can try connecting again.',
    };
  }

  if (elapsedMs < 3_000) {
    return {
      title: 'Checking your secure session',
      description: 'Connecting to Profit Tracker…',
    };
  }

  if (elapsedMs < 25_000) {
    return {
      title: 'Waking up the server',
      description: attempt > 1 ? `Trying again (${attempt}/10)…` : 'This usually takes less than a minute.',
    };
  }

  return {
    title: 'The server is taking a little longer',
    description: 'We are still trying automatically. You do not need to refresh this page.',
  };
}

export default function ServerWakeUpScreen({ startedAt, attempt = 1, failed = false, onRetry }) {
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAt));

  useEffect(() => {
    if (failed) return undefined;

    const intervalId = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [failed, startedAt]);

  const status = getStatus(elapsedMs, attempt, failed);
  // Render does not expose an actual boot percentage, so this indicator is deliberately labeled as an estimate.
  const progress = failed ? 100 : Math.min(92, Math.max(12, 12 + (elapsedMs / WARMUP_WINDOW_MS) * 80));

  return (
    <main className="min-h-screen bg-[#07070a] text-white flex items-center justify-center px-5">
      <section className="w-full max-w-md text-center rounded-2xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/30">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-400/30 bg-indigo-500/15">
          <div className={`h-7 w-7 rounded-full border-[3px] border-indigo-200/20 border-t-indigo-300 ${failed ? '' : 'animate-spin'}`} />
        </div>

        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">Profit Tracker</p>
        <h1 className="text-xl font-semibold tracking-tight">{status.title}</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">{status.description}</p>

        <div className="mt-7" aria-label={`Estimated startup progress: ${Math.round(progress)}%`}>
          <div className="flex items-center justify-between text-xs text-white/40">
            <span>{failed ? 'Connection paused' : 'Estimated startup progress'}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400 transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <p className="mt-5 text-xs leading-5 text-white/35">
          This app uses free hosting, which sleeps after inactivity to conserve usage. The first visit may take up to a minute.
        </p>

        {failed && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400"
          >
            Try again
          </button>
        )}
      </section>
    </main>
  );
}
