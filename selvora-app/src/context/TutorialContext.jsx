import React, { createContext, useContext, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

const TutorialContext = createContext();
export const useTutorial = () => useContext(TutorialContext);

// ─── Step definitions ───────────────────────────────────────────────────────
// target: data-tutorial-id value of the element to spotlight (null = no spotlight, just centre card)
// placement: where the tooltip appears relative to the spotlight box
export const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    target: null,
    placement: 'center',
    title: 'Welcome to Profit Tracker',
    body: "Your all-in-one reseller business tracker. Let's take a quick tour of everything so you know exactly where to go and what each section does.",
  },
  {
    id: 'dashboard-gear',
    target: 'dashboard-settings-btn',
    placement: 'bottom',
    title: 'Customize Your Dashboard',
    body: 'First things first — your dashboard is fully customizable. Click this gear icon to show or hide stat cards, reorder them, toggle chart series, and choose which columns appear in your recent sales table.',
  },
  {
    id: 'dashboard-stats',
    target: 'dashboard-stats',
    placement: 'bottom',
    title: 'Your Key Numbers',
    body: 'These cards show your most important metrics — Net Profit, Revenue, ROI, Cashback Earned, Commission Fees, and more. Every number updates in real time as you log transactions.',
  },
  {
    id: 'dashboard-filters',
    target: 'dashboard-filters',
    placement: 'bottom',
    title: 'Filter Your Data',
    body: 'Slice your data any way you need. Filter by time period (7 Days, 30 Days, Year to Date, or All Time) and by mode — All shows everything, Cashout filters to cash-for-goods deals, Marketplace filters to eBay, StockX, Amazon, etc.',
  },
  {
    id: 'dashboard-chart',
    target: 'dashboard-chart',
    placement: 'top',
    title: 'Revenue & Profit Trend',
    body: 'This chart tracks your revenue and profit over time by month. The more transactions you log, the more useful and detailed this becomes. You can toggle revenue, profit, and cashback lines on or off.',
  },
  {
    id: 'dashboard-pipeline',
    target: 'dashboard-pipeline',
    placement: 'top',
    title: 'Status Pipeline',
    body: "The pipeline shows how many items are at each lifecycle stage — from Purchased all the way through to Paid and Completed. It's a live snapshot of where your entire inventory stands right now.",
  },
  {
    id: 'sidebar-core',
    target: 'sidebar-section-core',
    placement: 'right',
    title: 'Core — Your Daily Workflow',
    body: 'Everything you do day-to-day lives here. This is where you log purchases, record sales, and review your transaction history.',
  },
  {
    id: 'sidebar-add-transaction',
    target: 'sidebar-add-transaction',
    placement: 'right',
    title: 'Add Transaction',
    body: 'This is where every resell starts. Log a purchase by entering what you bought, which store you bought it from, how much you paid (including tax and shipping), which credit card you used, and the quantity. Cashback is calculated automatically based on your card and vendor.',
  },
  {
    id: 'sidebar-record-sale',
    target: 'sidebar-record-sale',
    placement: 'right',
    title: 'Record Sale',
    body: 'Once an item is in your inventory, come here to log the sale. Search your unsold stock, select the platform you sold on (eBay, StockX, etc.), enter the sale price and any commission fees — Selvora calculates your profit and ROI instantly.',
  },
  {
    id: 'sidebar-transactions',
    target: 'sidebar-transactions',
    placement: 'right',
    title: 'Transactions',
    body: 'Your complete purchase and sale history in one filterable table. Search by product name, filter by vendor, platform, payment method, date range, or status. You can also inline-edit any entry directly from this page without re-entering everything.',
  },
  {
    id: 'sidebar-operations',
    target: 'sidebar-section-operations',
    placement: 'right',
    title: 'Operations — Business Management',
    body: 'This section handles the day-to-day operational side of your reselling business — inventory, expenses, receipts, and tax compliance.',
  },
  {
    id: 'sidebar-inventory',
    target: 'sidebar-inventory',
    placement: 'right',
    title: 'Inventory On Hand',
    body: "Shows everything you've bought but haven't sold yet. See how much capital is locked up in unsold stock, which items have been sitting 30+ or 90+ days (aging stock that needs liquidation), and click 'View Sales' next to any item to see its current eBay market price.",
  },
  {
    id: 'sidebar-expenses',
    target: 'sidebar-expenses',
    placement: 'right',
    title: 'Expenses',
    body: 'Track all your business costs beyond inventory purchases — eBay subscription fees, shipping supplies, tools, memberships, and anything else. Set expenses as recurring (weekly, biweekly, or monthly) and Selvora auto-generates them on schedule. These are deducted from your profit.',
  },
  {
    id: 'sidebar-receipts',
    target: 'sidebar-receipts',
    placement: 'right',
    title: 'Receipts',
    body: 'Attach photos or PDFs of purchase receipts to any inventory item or expense. Critical for tax season and IRS audits. This page shows you exactly which items are missing receipts so nothing slips through the cracks.',
  },
  {
    id: 'sidebar-tax-exempt',
    target: 'sidebar-tax-exempt',
    placement: 'right',
    title: 'Tax Exempt',
    body: "If you hold a resale certificate and buy inventory tax-free, track it here. Selvora separates your taxable vs. exempt purchases and sales so you can file your sales tax returns accurately and identify any use tax you may owe.",
  },
  {
    id: 'sidebar-insights',
    target: 'sidebar-section-insights',
    placement: 'right',
    title: 'Insights — Analyze Your Business',
    body: 'The Insights section is where you go deeper. Charts, trends, cash position, and credit card tracking all live here.',
  },
  {
    id: 'sidebar-analytics',
    target: 'sidebar-analytics',
    placement: 'right',
    title: 'Analytics & Insights',
    body: 'Deep-dive charts and breakdowns — revenue vs. profit trends by month, cost breakdown (COGS vs. tax vs. commission), cumulative profit curve, and period-by-period P&L bars. Filter by date range and mode to isolate exactly what you want to analyze.',
  },
  {
    id: 'sidebar-cashflow',
    target: 'sidebar-cashflow',
    placement: 'right',
    title: 'Cash Flow',
    body: "See where your money actually is at any given moment. What you've spent, what's coming back from sales, and what's still owed to you (in-transit items not yet paid out). Helps you avoid running short on capital mid-month.",
  },
  {
    id: 'sidebar-creditcard',
    target: 'sidebar-creditcard',
    placement: 'right',
    title: 'Credit Card',
    body: 'Monthly view of each credit card showing total spend, cashback earned, losses on sold items, and exactly how much cashback to redeem vs. keep as points. Shows your actual net amount to pay per card after cashback is applied.',
  },
  {
    id: 'sidebar-datasetup',
    target: 'sidebar-datasetup',
    placement: 'right',
    title: 'Data Setup — Start Here First',
    body: "Before you log your first transaction, set this up. It's where you define the stores you buy from (vendors), the platforms you sell on (marketplaces), your credit cards for cashback tracking, and your seller accounts.",
  },
  {
    id: 'datasetup-platforms',
    target: 'datasetup-platforms-tab',
    placement: 'bottom',
    title: 'Platforms — Vendors & Marketplaces',
    body: 'Add Vendors (stores you buy from: Nike, Supreme, Target, Foot Locker) and Marketplaces (where you sell: eBay, StockX, Amazon, GOAT). The fee % you set on each marketplace is used to auto-calculate commission on every sale you record.',
    navigate: '/settings?tab=datasetup',
  },
  {
    id: 'datasetup-payment',
    target: 'datasetup-payment-tab',
    placement: 'bottom',
    title: 'Payment Methods — Credit Cards',
    body: "Add your credit cards here. Set the base cashback rate, and optionally add category-specific rates (e.g. 5% at Target, 3% at grocery stores). Every purchase you log will automatically calculate cashback based on which card and vendor you select.",
  },
  {
    id: 'done',
    target: null,
    placement: 'center',
    title: "You're All Set!",
    body: "Start by going to Data Setup to add your platforms and cards, then hit Add Transaction to log your first purchase. You can replay this tour anytime from the Guide page.",
  },
];

export const TutorialProvider = ({ children }) => {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const start = useCallback(() => {
    setStepIndex(0);
    setActive(true);
  }, []);

  const next = useCallback(() => {
    setStepIndex(i => {
      if (i >= TUTORIAL_STEPS.length - 1) return i;
      return i + 1;
    });
  }, []);

  const back = useCallback(() => {
    setStepIndex(i => Math.max(0, i - 1));
  }, []);

  const finish = useCallback(async () => {
    setActive(false);
    setStepIndex(0);
    try {
      await apiFetch('/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorial_seen: true }),
      });
    } catch {
      // non-critical — tutorial just won't be marked seen on server
    }
  }, []);

  const skip = finish;

  const currentStep = TUTORIAL_STEPS[stepIndex];

  return (
    <TutorialContext.Provider value={{ active, start, next, back, finish, skip, stepIndex, currentStep, totalSteps: TUTORIAL_STEPS.length }}>
      {children}
    </TutorialContext.Provider>
  );
};
