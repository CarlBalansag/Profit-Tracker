import React, { Suspense, useEffect } from 'react';
import { prefetchAllPageCode, prefetchSharedData } from './data/pagePrefetch';
import { useOptionalQueryClient } from './hooks/usePageCache';
import { Toaster } from 'sonner';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Shell from './components/Layout/Shell';

// Pages (lazy, and preloadable by hover/idle prefetch)
import {
  Dashboard, AddTransaction, Inventory, Expenses, Receipts, Invoices, Transactions, Analytics,
  CashFlow, CreditCard, Settings, AddSale, TaxExempt, Guide, Login, Goals, Calendar, Cashout,
  Shipping, Statuses, ScheduleC,
} from './pages/lazyPages';
import { AuthProvider } from './context/AuthContext';
import { TutorialProvider } from './context/TutorialContext';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import { SCHEDULE_C_ENABLED } from './config/features';
import ThemeSwitch from './components/UI/ThemeSwitch';
import { PageLoader } from './components/PageLoader';


function App() {
  return (
    <AuthProvider>
      <TutorialProvider>
      <Toaster
        position="bottom-right"
        mobileOffset={{ bottom: 72 }}
        theme="light"
        richColors
        expand={false}
        duration={3500}
        toastOptions={{
          style: {
            background: 'var(--toast-bg)',
            border: '1px solid var(--toast-border)',
            backdropFilter: 'blur(12px)',
            color: 'var(--toast-text)',
            boxShadow: 'var(--toast-shadow)',
          },
        }}
      />
      <Router>
        <Routes>
          <Route path="/login" element={<><ThemeSwitch /><Suspense fallback={null}><Login /></Suspense></>} />
          <Route path="*" element={
            <ProtectedRoute>
              <Shell>
              <AppPages />
          </Shell>
            </ProtectedRoute>
        } />
      </Routes>
    </Router>
      </TutorialProvider>
    </AuthProvider>
  );
}

// Page change: the old and new pages crossfade over each other (the old one
// drifting up a little, the new one rising in from a little below), so there's
// never an empty frame between them. Only the content area moves; the
// sidebar, header and bottom nav stay put. Keyed on the pathname, so a
// query-string change on the same page doesn't replay it. With reduced motion
// it's the same crossfade with no movement.
const PAGE_EASE = [0.2, 0.8, 0.2, 1];
const MotionDiv = motion.div;

function AppPages() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const shift = reduceMotion ? 0 : 1;

  // Once the first page is up and the browser is idle, load every other
  // page's code, then (a little later, so the first page's own data goes
  // first) the cheap data several pages share. Heavy data waits for hover.
  const queryClient = useOptionalQueryClient();
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    let dataTimer;
    const handle = idle(() => {
      prefetchAllPageCode();
      dataTimer = setTimeout(() => prefetchSharedData(queryClient), 2000);
    }, { timeout: 5000 });
    return () => { cancel(handle); clearTimeout(dataTimer); };
  }, [queryClient]);

  return (
    <div className="relative h-full min-h-0">
    <AnimatePresence initial={false}>
      <MotionDiv
        key={location.pathname}
        className="absolute inset-0 min-h-0"
        initial={{ opacity: 0, y: 10 * shift, zIndex: 1 }}
        animate={{ opacity: 1, y: 0, zIndex: 1, transition: { duration: reduceMotion ? 0.2 : 0.3, ease: PAGE_EASE } }}
        exit={{ opacity: 0, y: -6 * shift, zIndex: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
      >
        <Suspense fallback={<PageLoader />}>
          <Routes location={location}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add-transaction" element={<AddTransaction />} />
          <Route path="/add-sale" element={<AddSale />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/shipping" element={<Shipping />} />
          <Route path="/statuses" element={<Statuses />} />
          <Route path="/expenses" element={<Expenses />} />
          {SCHEDULE_C_ENABLED && <Route path="/schedule-c" element={<ScheduleC />} />}
          <Route path="/receipts" element={<Receipts />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/cashflow" element={<CashFlow />} />
          <Route path="/creditcard" element={<CreditCard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/tax-exempt" element={<TaxExempt />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/cashout" element={<Cashout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </MotionDiv>
    </AnimatePresence>
    </div>
  );
}

export default App;
