import React, { lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Shell from './components/Layout/Shell';

// Pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AddTransaction = lazy(() => import('./pages/AddTransaction'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Receipts = lazy(() => import('./pages/Receipts'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Analytics = lazy(() => import('./pages/Analytics'));
const CashFlow = lazy(() => import('./pages/CashFlow'));
const CreditCard = lazy(() => import('./pages/CreditCard'));
const Settings = lazy(() => import('./pages/Settings'));
const AddSale = lazy(() => import('./pages/AddSale'));
const TaxExempt = lazy(() => import('./pages/TaxExempt'));
const Guide = lazy(() => import('./pages/Guide'));
const Login = lazy(() => import('./pages/Login'));
const Goals = lazy(() => import('./pages/Goals'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Cashout = lazy(() => import('./pages/Cashout'));
const Shipping = lazy(() => import('./pages/Shipping'));
const Statuses = lazy(() => import('./pages/Statuses'));
const ScheduleC = lazy(() => import('./pages/ScheduleC'));
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
