import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import ServerWakeUpScreen from '../components/Auth/ServerWakeUpScreen';
import { useQueryClient } from '@tanstack/react-query';

const AuthContext = createContext();

// The context hook intentionally shares this module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WARMUP_RETRY_DELAYS = [0, 2_000, 4_000, 6_000, 8_000, 10_000, 10_000, 10_000, 10_000, 10_000];

export const AuthProvider = ({ children }) => {
  const [user, updateUser] = useState(null);
  const userId = useRef(null);
  const queryClient = useQueryClient();
  const setUser = useCallback((nextUser) => {
    if (userId.current !== (nextUser?.id || null)) { queryClient.cancelQueries(); queryClient.clear(); }
    userId.current = nextUser?.id || null;
    updateUser(nextUser);
  }, [queryClient]);
  const [loading, setLoading] = useState(true);
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

  if (loading) {
    return <ServerWakeUpScreen key={startedAt} startedAt={startedAt} attempt={attempt} />;
  }

  if (serverError) {
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
    <AuthContext.Provider value={{ user, setUser, loading, logout }}>
      {logoutError && <div role="alert" className="bg-red-950 p-3 text-white">{logoutError} <button onClick={logout} className="underline">Retry sign out</button></div>}
      {children}
    </AuthContext.Provider>
  );
};
