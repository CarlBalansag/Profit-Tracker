import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import ServerWakeUpScreen from '../components/Auth/ServerWakeUpScreen';
import { useQueryClient } from '@tanstack/react-query';
import { CACHE_OWNER_KEY, clearPersistedCache } from '../data/persistedCache';

const AuthContext = createContext();

// The context hook intentionally shares this module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WARMUP_RETRY_DELAYS = [0, 2_000, 4_000, 6_000, 8_000, 10_000, 10_000, 10_000, 10_000, 10_000];

// Whose data the saved cache holds (see data/persistedCache.js). Reading and
// writing it can fail (private windows, blocked storage); then the cache is
// simply treated as nobody's and cleared on sign-in.
const readCacheOwner = () => { try { return localStorage.getItem(CACHE_OWNER_KEY); } catch { return null; } };
const writeCacheOwner = (id) => {
  try { if (id) localStorage.setItem(CACHE_OWNER_KEY, id); else localStorage.removeItem(CACHE_OWNER_KEY); } catch { /* ignore */ }
};

// Pages a signed-out visitor can use: the landing page and the sign-in page.
const PUBLIC_PATHS = new Set(['/', '/login']);
// The landing page's own address, which anyone (signed in or not) can open
// without waiting on the server.
const ALWAYS_PUBLIC_PATHS = new Set(['/welcome']);

// A first-time or signed-out visitor (no saved owner: signing in saves one,
// signing out or a 401 clears it) who opens a public page sees it right away
// instead of waiting on the "Waking up the server" screen for the sign-in
// check. That check keeps running in the background. Returning users still
// get the wake-up screen, so they never see the landing page flash first.
const startsAsVisitor = () => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  return ALWAYS_PUBLIC_PATHS.has(path) || (!readCacheOwner() && PUBLIC_PATHS.has(path));
};

export const AuthProvider = ({ children }) => {
  const [user, updateUser] = useState(null);
  // Starts as the owner of the restored cache, so the same user signing in
  // again keeps it; anyone else (or signing out) clears memory and disk.
  const userId = useRef(readCacheOwner());
  const queryClient = useQueryClient();
  const setUser = useCallback((nextUser) => {
    const nextId = nextUser?.id ? String(nextUser.id) : null;
    if (userId.current !== nextId) {
      queryClient.cancelQueries();
      queryClient.clear();
      clearPersistedCache();
    }
    userId.current = nextId;
    writeCacheOwner(nextId);
    updateUser(nextUser);
  }, [queryClient]);
  const [loading, setLoading] = useState(true);
  const [visitor] = useState(startsAsVisitor);
  const [serverError, setServerError] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [attempt, setAttempt] = useState(1);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const requestSequence = useRef(0);
  useEffect(() => {
    const expired = () => { requestSequence.current++; setUser(null); };
    window.addEventListener('auth-expired', expired);
    return () => window.removeEventListener('auth-expired', expired);
  }, [setUser]);

  const fetchUser = useCallback(async () => {
    const requestId = ++requestSequence.current;
    const isCurrentRequest = () => requestId === requestSequence.current;
    setLoading(true);
    setServerError(false);
    setAttempt(1);
    setStartedAt(Date.now());
    let response;
    for (let retryIndex = 0; retryIndex < WARMUP_RETRY_DELAYS.length; retryIndex++) {
      if (retryIndex > 0) await sleep(WARMUP_RETRY_DELAYS[retryIndex]);
      if (!isCurrentRequest()) return;

      setAttempt(retryIndex + 1);
      try {
        response = await apiFetch('/auth/me');
        if (response.status < 500) break; // success or 401 — stop retrying
      } catch (error) {
        console.error('Failed to fetch user (attempt', retryIndex + 1, '):', error);
      }
    }
    if (!isCurrentRequest()) return;

    try {
      if (response?.ok) {
        const userData = await response.json();
        if (!isCurrentRequest()) return;
        setUser(userData);
      } else if (!response || response.status >= 500) {
        // Server error after all retries — don't log out, show retry screen
        setServerError(true);
      } else {
        // 401 — genuinely unauthenticated
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    fetchUser();
    return () => {
      requestSequence.current += 1;
    };
  }, [fetchUser]);

  // The app setting the user itself (sign-in form, sign-out) is newer than
  // any sign-in check still running, so that check's answer is dropped.
  const setUserFromApp = useCallback((nextUser) => {
    requestSequence.current++;
    setLoading(false);
    setServerError(false);
    setUser(nextUser);
  }, [setUser]);

  if (loading && !visitor) {
    return <ServerWakeUpScreen key={startedAt} startedAt={startedAt} attempt={attempt} />;
  }

  // A visitor stays on the public page; if the server is down, the sign-in
  // form reports it when they try to sign in.
  if (serverError && !visitor) {
    return <ServerWakeUpScreen key={startedAt} startedAt={startedAt} attempt={attempt} failed onRetry={fetchUser} />;
  }

  const logout = async () => {
    requestSequence.current++;
    setLogoutError('');
    try {
      const response = await apiFetch('/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error(`Logout failed: ${response.status}`);
    } catch {
      setLogoutError('Sign-out was not confirmed by the server. Please retry before leaving this device.');
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser: setUserFromApp, loading, logout }}>
      {logoutError && <div role="alert" className="bg-red-950 p-3 text-white">{logoutError} <button onClick={logout} className="underline">Retry sign out</button></div>}
      {children}
    </AuthContext.Provider>
  );
};
