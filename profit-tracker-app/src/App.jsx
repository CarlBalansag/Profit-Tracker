import React, { lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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
            <Suspense fallback={<PageLoader />}>
            <Routes>
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
          <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </Shell>
            </ProtectedRoute>
        } />
      </Routes>
    </Router>
      </TutorialProvider>
    </AuthProvider>
  );
}

export default App;
