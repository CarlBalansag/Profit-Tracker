import React, { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen, Play, LayoutDashboard, CirclePlus, DollarSign, ArrowLeftRight, Package, Receipt, FileText, ShieldCheck, ChartColumn, Wallet, CreditCard, Settings, Lightbulb, HelpCircle, TrendingUp } from 'lucide-react';
import { useTutorial } from '../context/TutorialContext';

// ─── Accordion item ────────────────────────────────────────────────────────
const AccordionItem = ({ icon: Icon, title, color = 'emerald', children }) => {
  const [open, setOpen] = useState(false);
  const colorMap = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    purple: 'text-purple-400 bg-purple-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    teal: 'text-teal-400 bg-teal-500/10',
    rose: 'text-rose-400 bg-rose-500/10',
    sky: 'text-sky-400 bg-sky-500/10',
    indigo: 'text-indigo-400 bg-indigo-500/10',
  };
  const iconClass = colorMap[color] || colorMap.emerald;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.03] transition-colors"
      >
        <div className={`p-2 rounded-lg flex-shrink-0 ${iconClass}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="flex-1 text-sm font-semibold text-gray-200">{title}</span>
        {open
          ? <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
        }
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 text-sm text-gray-400 leading-relaxed space-y-3 border-t border-white/[0.04]">
          {children}
        </div>
      )}
    </div>
  );
};

const Tip = ({ children }) => (
  <div className="flex gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15 text-emerald-300/80 text-xs">
    <Lightbulb className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
    <span>{children}</span>
  </div>
);

const Formula = ({ label, formula }) => (
  <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] font-mono text-xs">
    <span className="text-gray-500">{label}: </span>
    <span className="text-white">{formula}</span>
  </div>
);

// ─── Section header ────────────────────────────────────────────────────────
const SectionHeader = ({ title, subtitle }) => (
  <div className="mb-4">
    <h2 className="text-base font-bold text-white">{title}</h2>
    {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
  </div>
);

// ─── Main page ─────────────────────────────────────────────────────────────
const Guide = () => {
  const { start } = useTutorial();

  return (
    <div className="h-full overflow-auto px-4 py-6 sm:px-6 max-w-3xl mx-auto space-y-10">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Guide</h1>
            <p className="text-gray-400 text-sm mt-0.5">Everything you need to know about Profit Tracker.</p>
          </div>
        </div>
        <button
          onClick={start}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
        >
          <Play className="w-4 h-4" />
          Replay Introduction Tour
        </button>
      </div>

      {/* ── Getting Started ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Getting Started" subtitle="Set up your account before logging any transactions." />
        <div className="space-y-2">

          <AccordionItem icon={HelpCircle} title="What is Profit Tracker?" color="emerald">
            <p>Profit Tracker is a reseller business intelligence platform. It helps you track every purchase you make, every item you sell, and every dollar of profit you earn — all in one place.</p>
            <p>Whether you flip sneakers, electronics, trading cards, or anything else, Profit Tracker gives you a real-time view of your revenue, costs, ROI, cashback, and inventory.</p>
            <Tip>The more consistently you log your purchases and sales, the more accurate your profit calculations will be.</Tip>
          </AccordionItem>

          <AccordionItem icon={Settings} title="Data Setup: Platforms explained" color="blue">
            <p>Platforms are the foundation of everything. Before you can log a transaction, you need at least one Vendor and one Marketplace (or Cashout platform).</p>
            <p><strong className="text-gray-200">Vendors</strong> are the stores you buy from — Nike, Supreme, Target, Foot Locker, SNKRS, etc. Add a vendor for every store you purchase inventory from.</p>
            <p><strong className="text-gray-200">Marketplaces</strong> are where you sell — eBay, StockX, Amazon, GOAT, etc. Set a fee percentage on each marketplace and every sale you log there will auto-calculate commission.</p>
            <p><strong className="text-gray-200">Cashouts</strong> are direct cash buyers — friends, local buyers, or anyone you sell to directly without a platform fee.</p>
            <Tip>Set the exact fee % for each marketplace. eBay is typically 12.9%, StockX around 9.5%. This gets deducted from your sale price automatically.</Tip>
          </AccordionItem>

          <AccordionItem icon={CreditCard} title="Data Setup: Payment Methods explained" color="purple">
            <p>Add every credit card you use for inventory purchases. This is what powers the cashback tracking throughout the app.</p>
            <p>For each card, set a <strong className="text-gray-200">base cashback rate</strong> (e.g. 1.5% for a flat-rate card). You can also add <strong className="text-gray-200">category-specific rates</strong> — for example, if your Amex Blue Cash earns 3% at U.S. supermarkets or 5% at Target, add those separately.</p>
            <p>When you log a purchase and select both the card and the vendor, Profit Tracker automatically finds the best matching rate and calculates your cashback.</p>
            <Tip>Add category rates for every elevated earning category on your cards. Over many transactions, this adds up significantly.</Tip>
          </AccordionItem>

        </div>
      </section>

      {/* ── Core Workflow ───────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Core Workflow" subtitle="Your day-to-day process for tracking reselling activity." />
        <div className="space-y-2">

          <AccordionItem icon={CirclePlus} title="How to add a transaction (purchase)" color="emerald">
            <p>Every resell starts with a purchase. Go to <strong className="text-gray-200">Add Transaction</strong> in the sidebar to log it.</p>
            <p>Fill in:</p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li><strong className="text-gray-200">Product name</strong> — what you bought</li>
              <li><strong className="text-gray-200">Category</strong> — helps with filtering and reports</li>
              <li><strong className="text-gray-200">Vendor</strong> — where you bought it (from your Platforms list)</li>
              <li><strong className="text-gray-200">Unit price & quantity</strong> — what you paid per item</li>
              <li><strong className="text-gray-200">Tax, shipping, fees</strong> — any additional costs</li>
              <li><strong className="text-gray-200">Payment method</strong> — which card you used (cashback auto-calculates)</li>
              <li><strong className="text-gray-200">Status</strong> — PURCHASED, SHIPPED_IN, DELIVERED, etc.</li>
            </ul>
            <p>If the item is already sold, toggle <strong className="text-gray-200">"Has this item been sold?"</strong> to add sale details in the same form.</p>
            <Tip>The Transaction Summary panel on the right shows your cost breakdown and profit in real time as you fill in the form.</Tip>
          </AccordionItem>

          <AccordionItem icon={DollarSign} title="How to record a sale" color="teal">
            <p>Once inventory is on hand, go to <strong className="text-gray-200">Record Sale</strong> in the sidebar. Search for the item by name, select it from your unsold inventory list on the left, then fill in the sale details on the right.</p>
            <p>You'll enter:</p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li><strong className="text-gray-200">Platform</strong> — where you sold it</li>
              <li><strong className="text-gray-200">Sale price per unit</strong></li>
              <li><strong className="text-gray-200">Quantity sold</strong></li>
              <li><strong className="text-gray-200">Commission fee</strong> — auto-fills from the platform's fee %</li>
              <li><strong className="text-gray-200">Sale date & payout date</strong></li>
            </ul>
            <p>Profit Tracker instantly shows you profit, ROI, and net cashback for the sale.</p>
            <Tip>You can also record a sale directly from Add Transaction if you bought and sold on the same day.</Tip>
          </AccordionItem>

          <AccordionItem icon={ArrowLeftRight} title="Viewing and editing transactions" color="sky">
            <p>The <strong className="text-gray-200">Transactions</strong> page is your complete history. Every purchase and every sale in one filterable table.</p>
            <p>You can filter by: product name (search), vendor, platform, payment method, status, date range, and mode (All / Cashout / Marketplace).</p>
            <p>Click the <strong className="text-gray-200">Edit</strong> button on any row to inline-edit cost, sale price, quantity, platform, or payment method without re-entering everything.</p>
            <p>Use the <strong className="text-gray-200">Columns</strong> button to customize which fields are visible and reorder them.</p>
            <Tip>Tracking numbers in the table auto-detect the carrier (UPS, FedEx, USPS, Amazon) so you can quickly identify shipments.</Tip>
          </AccordionItem>

        </div>
      </section>

      {/* ── Inventory & Operations ──────────────────────────────────────── */}
      <section>
        <SectionHeader title="Inventory & Operations" subtitle="Manage your stock, costs, and compliance." />
        <div className="space-y-2">

          <AccordionItem icon={Package} title="Understanding Inventory On Hand" color="amber">
            <p>The <strong className="text-gray-200">Inventory On Hand</strong> page shows everything you've bought but haven't sold yet. It tracks your locked capital and identifies aging stock.</p>
            <p><strong className="text-gray-200">Aging stock</strong> is color-coded: amber for 30+ days, red for 90+ days. These are items that may need to be liquidated at a lower price.</p>
            <p>If you bought the same product multiple times (different purchases, different dates), they're grouped into a single collapsible row. Click the chevron to expand and see each individual purchase entry with its own aging and cost data.</p>
            <p>Click <strong className="text-gray-200">View Sales</strong> on any row to open eBay's completed listings for that item — so you can see what it's actually selling for right now.</p>
            <Tip>Regularly review items flagged red (90+ days). The longer unsold inventory sits, the more capital is tied up and the harder it is to buy new deals.</Tip>
          </AccordionItem>

          <AccordionItem icon={Receipt} title="Tracking expenses" color="rose">
            <p>The <strong className="text-gray-200">Expenses</strong> page tracks all your business costs beyond inventory — eBay fees, Shopify subscriptions, shipping supplies, tools, software, and anything else you spend to run your reselling operation.</p>
            <p><strong className="text-gray-200">One-off expenses</strong> are single charges logged with a date and amount.</p>
            <p><strong className="text-gray-200">Recurring expenses</strong> are set up once with a frequency (weekly, biweekly, or monthly) and Profit Tracker automatically generates new entries on schedule. You can pause or resume them at any time.</p>
            <Tip>Your total recurring monthly expenses show at the top of the page. This is your fixed overhead — deducted from your gross profit to get true net profit.</Tip>
          </AccordionItem>

          <AccordionItem icon={FileText} title="Managing receipts" color="indigo">
            <p>The <strong className="text-gray-200">Receipts</strong> page shows two tabs: items <em>without</em> a receipt attached, and items <em>with</em> one.</p>
            <p>Click <strong className="text-gray-200">Attach</strong> on any row missing a receipt to upload a PNG, JPG, or PDF (up to 5MB). Click any attached receipt to preview it in full size.</p>
            <p>Both inventory purchases and expenses can have receipts attached.</p>
            <Tip>Keep receipts organized year-round. The IRS can audit resellers — especially those with high inventory volumes. Having receipts for every purchase is your best protection.</Tip>
          </AccordionItem>

          <AccordionItem icon={ShieldCheck} title="Tax Exempt tracking" color="emerald">
            <p>If you hold a resale certificate, you may purchase inventory without paying sales tax. The <strong className="text-gray-200">Tax Exempt</strong> page tracks all of this separately.</p>
            <p>Mark any transaction as tax exempt when adding it. The Tax Exempt page then shows you a breakdown of exempt purchases, exempt sales, COGS, revenue, and profit — filtered by year and quarter.</p>
            <p><strong className="text-gray-200">Use Tax Due</strong> is the sales tax you paid on inventory that you may have charged your buyers — some states require you to remit this.</p>
            <Tip>Use the quarterly filter to make filing your sales tax return easier — you can see exactly what was exempt in Q1, Q2, etc.</Tip>
          </AccordionItem>

        </div>
      </section>

      {/* ── Insights & Analytics ───────────────────────────────────────── */}
      <section>
        <SectionHeader title="Insights & Analytics" subtitle="Understand your business performance at a deeper level." />
        <div className="space-y-2">

          <AccordionItem icon={LayoutDashboard} title="Reading the Dashboard" color="blue">
            <p>The <strong className="text-gray-200">Dashboard</strong> is your command center. Every metric updates in real time as you log data.</p>
            <p>Use the <strong className="text-gray-200">date filter</strong> (7 Days, 30 Days, YTD, All Time) to scope all numbers to a specific period. Use the <strong className="text-gray-200">mode filter</strong> (All, Cashout, Marketplace) to separate cash deals from platform sales.</p>
            <p>Click the <strong className="text-gray-200">gear icon</strong> to customize which stat cards appear, reorder them, toggle chart series, and pick which columns show in the recent sales table.</p>
            <p>The <strong className="text-gray-200">Status Pipeline</strong> shows a live count of items at each stage — click any stage to jump to the matching filtered transactions list.</p>
          </AccordionItem>

          <AccordionItem icon={ChartColumn} title="Analytics deep dive" color="purple">
            <p>The <strong className="text-gray-200">Analytics</strong> page has 4 tabs of charts and breakdowns, all responding to your date range and mode filters.</p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li><strong className="text-gray-200">Revenue & Profit Trend</strong> — monthly line chart of revenue, profit, cashback</li>
              <li><strong className="text-gray-200">Cost Breakdown</strong> — pie chart showing COGS vs. tax vs. commission</li>
              <li><strong className="text-gray-200">Cumulative Profit</strong> — area chart of running total profit over time</li>
              <li><strong className="text-gray-200">Period P&L</strong> — bar chart, green if profitable, red if loss, per month</li>
              <li><strong className="text-gray-200">Payments Tab</strong> — spending broken down by payment method</li>
            </ul>
            <Tip>ROI (Return on Investment) is the best single metric for comparing deals. A $50 profit on a $100 item (50% ROI) is better than $50 profit on a $500 item (10% ROI).</Tip>
          </AccordionItem>

          <AccordionItem icon={Wallet} title="Cash Flow explained" color="teal">
            <p><strong className="text-gray-200">Cash Flow</strong> shows where your money actually is right now — not just what you've earned on paper.</p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li><strong className="text-gray-200">Spending Out</strong> — total capital deployed on inventory purchases</li>
              <li><strong className="text-gray-200">Coming Back</strong> — revenue from completed sales (toggle to include cashback)</li>
              <li><strong className="text-gray-200">Owed To You</strong> — money from sales still in transit or not yet paid out</li>
            </ul>
            <p>Expand each buyer row to see exactly which transactions are outstanding and when you expect payment.</p>
            <Tip>Watch "Owed To You" carefully. If you have a large amount outstanding, consider it at risk until it clears — especially with new buyers.</Tip>
          </AccordionItem>

          <AccordionItem icon={CreditCard} title="Credit Card tracker" color="rose">
            <p>The <strong className="text-gray-200">Credit Card</strong> page is scoped to the current calendar month. It shows per-card spending, cashback earned, losses on sold items, and exactly what to pay.</p>
            <p><strong className="text-gray-200">Redeem</strong> = cashback to apply toward losses (capped at the loss amount — you never redeem more than you need to).</p>
            <p><strong className="text-gray-200">Keep as Points</strong> = remaining cashback you don't need to redeem — stays in your rewards account.</p>
            <p><strong className="text-gray-200">Net to Pay</strong> = what you actually owe the card company after cashback redemption.</p>
            <Tip>Expand any card row to see exactly which items caused losses — so you know which products to avoid buying with that card in future.</Tip>
          </AccordionItem>

        </div>
      </section>

      {/* ── Key Concepts ───────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Key Concepts" subtitle="Formulas and definitions used throughout the app." />
        <div className="space-y-2">

          <AccordionItem icon={TrendingUp} title="How profit is calculated" color="emerald">
            <p>Profit Tracker uses a full all-in cost model — every fee, tax, and charge is factored in.</p>
            <div className="space-y-2">
              <Formula label="Net Cost" formula="(Unit Price × Qty) + Sales Tax + Shipping + Fees − Gift Card" />
              <Formula label="Gross Profit" formula="Sale Revenue − Net Cost − Commission − Sale Shipping" />
              <Formula label="Net Profit" formula="Gross Profit + Cashback Earned" />
              <Formula label="ROI" formula="(Net Profit ÷ Net Cost) × 100%" />
            </div>
            <Tip>Cashback is added to profit because it's real money returning to you from your card issuer — it directly reduces your effective cost basis.</Tip>
          </AccordionItem>

          <AccordionItem icon={CreditCard} title="How cashback works" color="purple">
            <p>When you log a purchase, select a payment method and a vendor. Profit Tracker looks for a matching category rate on your card first. If found, it applies that rate. If not, it falls back to the base cashback rate.</p>
            <p>For example: Amex Blue Cash with a 3% rate at Target. You buy $200 of inventory at Target. Cashback = $6.00.</p>
            <p>This cashback is added to your profit calculation and also tracked separately on the Credit Card page for monthly redemption planning.</p>
            <Tip>Never underestimate cashback. On $10,000/month of inventory purchases at 2% average cashback, that's $200/month — $2,400/year — straight back to you.</Tip>
          </AccordionItem>

          <AccordionItem icon={ArrowLeftRight} title="Marketplace vs Cashout mode" color="sky">
            <p>The mode filter on the Dashboard and Analytics pages separates two types of sales:</p>
            <p><strong className="text-gray-200">Marketplace</strong> — sales made through a platform like eBay, StockX, Amazon, GOAT. These typically have commission fees and may involve shipping.</p>
            <p><strong className="text-gray-200">Cashout</strong> — direct cash-for-goods sales to buyers without a marketplace. No commission fees, but also no buyer protection or platform trust.</p>
            <p>Filtering by mode lets you compare profitability of each sales channel separately.</p>
          </AccordionItem>

          <AccordionItem icon={Package} title="Item statuses explained" color="amber">
            <p>Every inventory item and sale has a status tracking where it is in the lifecycle:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {[
                ['PURCHASED', 'Order placed, not yet shipped'],
                ['SHIPPED_IN', 'Item shipped to you by vendor'],
                ['DELIVERED', 'Arrived at your address'],
                ['SCANNED_IN', 'Checked into your inventory'],
                ['LISTED', 'Currently listed for sale'],
                ['SOLD', 'Sale completed, awaiting shipment'],
                ['SHIPPED_OUT', 'Shipped to the buyer'],
                ['AUTHENTICATION', 'Being authenticated (StockX etc.)'],
                ['PAID', 'Payment received from buyer'],
                ['COMPLETED', 'Fully complete, payout confirmed'],
                ['RETURNED', 'Item returned by buyer'],
                ['DISPUTED', 'Sale under dispute'],
                ['CANCELLED', 'Sale cancelled'],
              ].map(([status, desc]) => (
                <div key={status} className="flex gap-2 p-2 rounded bg-white/[0.03] border border-white/[0.05]">
                  <span className="font-mono text-emerald-400 text-[10px] font-bold flex-shrink-0">{status}</span>
                  <span className="text-gray-500">{desc}</span>
                </div>
              ))}
            </div>
          </AccordionItem>

        </div>
      </section>

    </div>
  );
};

export default Guide;
