import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import ServerWakeUpScreen from '../components/Auth/ServerWakeUpScreen';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WARMUP_RETRY_DELAYS = [0, 2_000, 4_000, 6_000, 8_000, 10_000, 10_000, 10_000, 10_000, 10_000];

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState(false);
  const [attempt, setAttempt] = useState(1);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const requestSequence = useRef(0);

  const fetchUser = async () => {
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
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
    return () => {
      requestSequence.current += 1;
    };
  }, []);

  if (loading) {
    return <ServerWakeUpScreen key={startedAt} startedAt={startedAt} attempt={attempt} />;
  }

  if (serverError) {
    return <ServerWakeUpScreen key={startedAt} startedAt={startedAt} attempt={attempt} failed onRetry={fetchUser} />;
  }

  const logout = async () => {
    try {
      await apiFetch('/auth/logout');
    } catch {
      // ignore network errors — we clear local state regardless
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
