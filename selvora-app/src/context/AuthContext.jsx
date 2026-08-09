import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState(false);

  const fetchUser = async () => {
    setLoading(true);
    setServerError(false);
    // Retry up to 3 times on 5xx (Neon cold-start can cause transient 500s)
    const MAX_RETRIES = 3;
    const DELAYS = [1500, 3000, 5000];
    let response;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await apiFetch('/auth/me');
        if (response.status < 500) break; // success or 401 — stop retrying
      } catch (error) {
        console.error('Failed to fetch user (attempt', attempt + 1, '):', error);
      }
      if (attempt < MAX_RETRIES - 1) await sleep(DELAYS[attempt]);
    }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-gray-800 border-t-indigo-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (serverError) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-gray-400 text-sm">Server is warming up. Please wait a moment.</p>
          <button
            onClick={fetchUser}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
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
