import { useState, useEffect } from 'react';

// Lightweight fetcher that works inside Sidebar both with and without QueryClientProvider
export function useCashoutProviders() {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const API = import.meta.env.VITE_API_URL || '';
    fetch(`${API}/api/cashouts/providers`, {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((providers) => {
        if (active && Array.isArray(providers)) {
          setData(providers);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return { data, isLoading, error };
}
