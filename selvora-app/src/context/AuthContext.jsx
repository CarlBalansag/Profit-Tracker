import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
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
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-gray-800 border-t-indigo-500 rounded-full animate-spin"></div>
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
