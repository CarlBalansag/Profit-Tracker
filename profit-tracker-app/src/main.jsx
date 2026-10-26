import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './monitoring.js'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const isDev = import.meta.env.DEV;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // dev: always refetch so changes are instant during development
      // prod: 5-minute cache — analytics and inventory data doesn't change second-to-second
      staleTime: isDev ? 0 : 1000 * 60 * 5,
      // keep unused data in cache for 15 minutes so navigating back to a page is instant
      gcTime: 1000 * 60 * 15,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
