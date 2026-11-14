import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './monitoring.js'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { CACHE_MAX_AGE, startPersistedCache } from './data/persistedCache.js'

const isDev = import.meta.env.DEV;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // dev: always refetch so changes are instant during development
      // prod: 5-minute cache — analytics and inventory data doesn't change second-to-second
      staleTime: isDev ? 0 : 1000 * 60 * 5,
      // keep data as long as it's kept on disk (data/persistedCache.js), so
      // reopening the app or going back to a page shows it at once
      gcTime: CACHE_MAX_AGE,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// After a release, a tab left open can ask for page files that no longer exist.
// Reload once to pick up the new version; the guard stops a reload loop.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('reloaded-for-update')) return;
  sessionStorage.setItem('reloaded-for-update', '1');
  window.location.reload();
});

// The saved cache is restored before the app mounts, so sign-in can decide
// whether it belongs to this user before any page reads it.
startPersistedCache(queryClient).finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
});
