import { createElement, lazy } from 'react';

// Lazily loaded pages that can also be loaded ahead of time (hover prefetch,
// idle prefetch). React.lazy alone shows its Suspense fallback the first time
// a page renders even if its code was already fetched, so once preload() has
// finished, the page renders directly with no fallback flash.
function lazyWithPreload(factory) {
  let loaded = null;
  let pending = null;
  const preload = () => {
    pending ??= factory().then((module) => { loaded = module.default; return module; });
    return pending;
  };
  const LazyPage = lazy(preload);
  const Page = (props) => createElement(loaded ?? LazyPage, props);
  Page.preload = preload;
  return Page;
}

export const Dashboard = lazyWithPreload(() => import('./Dashboard'));
export const AddTransaction = lazyWithPreload(() => import('./AddTransaction'));
export const Inventory = lazyWithPreload(() => import('./Inventory'));
export const Expenses = lazyWithPreload(() => import('./Expenses'));
export const Receipts = lazyWithPreload(() => import('./Receipts'));
export const Invoices = lazyWithPreload(() => import('./Invoices'));
export const Transactions = lazyWithPreload(() => import('./Transactions'));
export const Analytics = lazyWithPreload(() => import('./Analytics'));
export const CashFlow = lazyWithPreload(() => import('./CashFlow'));
export const CreditCard = lazyWithPreload(() => import('./CreditCard'));
export const Settings = lazyWithPreload(() => import('./Settings'));
export const AddSale = lazyWithPreload(() => import('./AddSale'));
export const TaxExempt = lazyWithPreload(() => import('./TaxExempt'));
export const Guide = lazyWithPreload(() => import('./Guide'));
export const Login = lazyWithPreload(() => import('./Login'));
export const Landing = lazyWithPreload(() => import('./Landing'));
export const Goals = lazyWithPreload(() => import('./Goals'));
export const Calendar = lazyWithPreload(() => import('./Calendar'));
export const Cashout = lazyWithPreload(() => import('./Cashout'));
export const Shipping = lazyWithPreload(() => import('./Shipping'));
export const Statuses = lazyWithPreload(() => import('./Statuses'));
export const ScheduleC = lazyWithPreload(() => import('./ScheduleC'));
