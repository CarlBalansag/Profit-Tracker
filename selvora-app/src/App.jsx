import React from 'react';
import { Toaster } from 'sonner';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/Layout/Shell';

// Pages
import Dashboard from './pages/Dashboard';
import AddTransaction from './pages/AddTransaction';
import Inventory from './pages/Inventory';
import Expenses from './pages/Expenses';
import Receipts from './pages/Receipts';
import Invoices from './pages/Invoices';
import Transactions from './pages/Transactions';
import Analytics from './pages/Analytics';
import CashFlow from './pages/CashFlow';
import CreditCard from './pages/CreditCard';
import Settings from './pages/Settings';
import AddSale from './pages/AddSale';
import TaxExempt from './pages/TaxExempt';
import Guide from './pages/Guide';
import Login from './pages/Login';
import Goals from './pages/Goals';
import Calendar from './pages/Calendar';
import { AuthProvider } from './context/AuthContext';
import { TutorialProvider } from './context/TutorialContext';
import ProtectedRoute from './components/Auth/ProtectedRoute';


function App() {
  return (
    <AuthProvider>
      <TutorialProvider>
      <Toaster
        position="bottom-right"
        theme="dark"
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
          <Route path="/login" element={<Login />} />
          <Route path="*" element={
            <ProtectedRoute>
              <Shell>
            <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add-transaction" element={<AddTransaction />} />
          <Route path="/add-sale" element={<AddSale />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/expenses" element={<Expenses />} />
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
