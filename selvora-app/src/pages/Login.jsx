import React, { useState } from 'react';
import { TrendingUp, CreditCard, Wallet, BarChart2, ArrowRight, CheckCircle, ChevronDown, ShoppingBag, LogIn } from 'lucide-react';

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_TRANSACTIONS = [
  { product: 'PS5 Console',    platform: 'eBay',   profit: 90,  cashback: 24.95, status: 'COMPLETED', pct: 18 },
  { product: 'Nike Dunk Low',  platform: 'StockX', profit: 68,  cashback: 6.00,  status: 'PAID',      pct: 57 },
  { product: 'Pokémon Booster',platform: 'eBay',   profit: 75,  cashback: 7.00,  status: 'SHIPPED',   pct: 54 },
  { product: 'AirPods Pro 2',  platform: 'Amazon', profit: 42,  cashback: 9.95,  status: 'SOLD',      pct: 21 },
];

const MOCK_CARDS = [
  { name: 'Chase Freedom Flex',    rate: '5%',   spend: 1840, cashback: 92.00,  pay: 1840.00  },
  { name: 'Amex Blue Cash',        rate: '3%',   spend: 960,  cashback: 28.80,  pay: 960.00   },
  { name: 'Capital One Quicksilver', rate: '1.5%', spend: 540, cashback: 8.10, pay: 531.90  },
];

// Monthly revenue/profit data — values end at $24,830 and $6,214 respectively.
// Intentionally non-linear to look like real reseller data (slow start, strong Q2).
const SPARKLINE_REVENUE = [3200, 2900, 3800, 4100, 3600, 4800, 4400, 5100, 4700, 5600, 5200, 6100, 5800, 6600, 6200, 7100, 6700, 7800, 7400, 8300, 7900, 8900, 8200, 9600, 9100, 10200, 9600, 11000, 10400, 12100, 11500, 13200, 12400, 14100, 13200, 15000, 14100, 16200, 15400, 17100, 16200, 18400, 17600, 19800, 18900, 21200, 20100, 22800, 21600, 24830];
const SPARKLINE_PROFIT  = [780, 690, 920, 1010, 840, 1180, 1050, 1260, 1140, 1380, 1290, 1520, 1450, 1640, 1580, 1770, 1700, 1950, 1860, 2080, 1990, 2230, 2150, 2400, 2280, 2560, 2460, 2720, 2600, 3010, 2880, 3250, 3100, 3480, 3300, 3720, 3500, 3960, 3780, 4200, 3980, 4430, 4220, 4710, 4520, 5060, 4860, 5490, 5240, 6214];

// ─── SVG Sparkline area chart ────────────────────────────────────────────────
function Sparkline({ values, color, fillColor, width = 400, height = 80 }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 10) - 5;
    return [x, y];
  });
  const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#grad-${color.replace('#', '')})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Dot grid background ──────────────────────────────────────────────────────
function DotGrid() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
        maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 100%)',
      }}
    />
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────────
function Pill({ status }) {
  const map = {
    COMPLETED: 'text-emerald-400 bg-emerald-500/10',
    PAID:      'text-emerald-400 bg-emerald-500/10',
    SHIPPED:   'text-amber-400  bg-amber-500/10',
    SOLD:      'text-sky-400    bg-sky-500/10',
  };
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${map[status] ?? 'text-gray-500 bg-white/5'}`}>
      {status}
    </span>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const Login = () => {
  const [faqOpen, setFaqOpen] = useState(null);

  const handleLogin = () => {
    window.location.href = `${import.meta.env.VITE_API_DIRECT_URL || import.meta.env.VITE_API_URL}/auth/discord`;
  };

  const faqs = [
    { q: 'Is this free to use?', a: 'Yes — Profit Tracker is completely free during its current phase. Sign in with Discord and start tracking immediately.' },
    { q: 'What marketplaces does it support?', a: 'Any platform you sell on — eBay, StockX, GOAT, Amazon, Facebook Marketplace, and more. You define your own platforms and vendors.' },
    { q: 'How does cashback tracking work?', a: 'Link your credit cards and set cashback rates per card or per store. The app calculates what you earned on each purchase, which losses need to be covered by cashback, and what you can keep as points.' },
    { q: 'Do I need to connect my bank account?', a: 'No. There are zero financial integrations. You enter your data manually, keeping full control and privacy.' },
  ];

  return (
    <div className="min-h-screen bg-[#07070a] text-white overflow-x-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.05] bg-[#07070a]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-[#5865F2] flex items-center justify-center">
              <span className="text-white font-bold text-xs leading-none">P</span>
            </div>
            <span className="font-semibold text-[13px] tracking-tight text-white/90">Profit Tracker</span>
          </div>
          <button
            onClick={handleLogin}
            className="inline-flex items-center gap-2 bg-white text-[#07070a] hover:bg-white/90 font-semibold text-[13px] px-4 py-2 rounded-lg transition-colors"
          >
            <DiscordIcon className="w-4 h-4 text-[#5865F2]" />
            Sign in free
          </button>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative pt-20 pb-16 px-5 sm:px-8 overflow-hidden">
        <DotGrid />

        <div className="relative max-w-4xl mx-auto">
          {/* Eyebrow */}
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-indigo-400/80 mb-6">
            Reseller profit tracking
          </p>

          {/* Headline — extreme size contrast */}
          <h1 className="text-[clamp(2.4rem,6vw,4.5rem)] font-bold leading-[1.04] tracking-[-0.03em] text-white mb-6 max-w-3xl">
            Stop guessing.<br />
            <span className="text-white/35">Know your numbers.</span>
          </h1>

          <p className="text-[15px] text-white/45 max-w-lg leading-relaxed mb-10">
            Profit Tracker gives resellers a real-time view of P&amp;L, cashback, cash flow, and inventory — without a single spreadsheet.
          </p>

          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={handleLogin}
              className="inline-flex items-center gap-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold text-[13px] px-5 py-2.5 rounded-lg transition-colors shadow-lg shadow-[#5865F2]/25"
            >
              <DiscordIcon className="w-4 h-4" />
              Get started with Discord
            </button>
            <a href="#how" className="inline-flex items-center gap-1.5 text-[13px] text-white/35 hover:text-white/60 transition-colors">
              How it works <ArrowRight size={13} />
            </a>
          </div>

          <p className="text-[11px] text-white/20 mt-5">Free · No bank connections · No card required</p>
        </div>
      </section>

      {/* ── Hero dashboard mock ── */}
      <section className="px-5 sm:px-8 pb-24">
        <div className="max-w-5xl mx-auto">
          {/* Browser chrome */}
          <div className="rounded-xl border border-white/[0.07] overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.5)]">
            <div className="bg-[#111115] border-b border-white/[0.05] px-4 py-2.5 flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
              </div>
              <div className="flex-1 mx-8">
                <div className="bg-white/[0.04] rounded-md h-5 flex items-center justify-center">
                  <span className="text-[10px] text-white/20 font-mono">profittracker.io/dashboard</span>
                </div>
              </div>
            </div>

            {/* Dashboard interior */}
            <div className="bg-[#0c0c10] p-4 sm:p-5 space-y-3">

              {/* Top bar */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Dashboard</span>
                <div className="flex gap-1.5">
                  {['7D', '30D', 'YTD'].map((l, i) => (
                    <span key={l} className={`text-[10px] px-2 py-0.5 rounded font-medium ${i === 1 ? 'bg-white/[0.08] text-white/70' : 'text-white/25'}`}>{l}</span>
                  ))}
                </div>
              </div>

              {/* KPI row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Revenue',      value: '$24,830', delta: '+18%', up: true  },
                  { label: 'Net Profit',   value: '$6,214',  delta: '25% margin', up: true },
                  { label: 'Cashback',     value: '$489',    delta: '3 cards',    up: null },
                  { label: 'Units Sold',   value: '183',     delta: '↑ 12 today', up: true },
                ].map((k, i) => (
                  <div key={i} className="bg-white/[0.03] border border-white/[0.05] rounded-lg px-3 py-3">
                    <div className="text-[9px] text-white/30 uppercase tracking-widest mb-1.5">{k.label}</div>
                    <div className="text-lg font-bold text-white leading-none mb-1">{k.value}</div>
                    <div className={`text-[10px] font-medium ${k.up === true ? 'text-emerald-400/70' : 'text-white/25'}`}>{k.delta}</div>
                  </div>
                ))}
              </div>

              {/* Chart + table row */}
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                {/* Sparkline chart */}
                <div className="sm:col-span-3 bg-white/[0.02] border border-white/[0.05] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] text-white/30 uppercase tracking-widest font-medium">Revenue &amp; Profit — 6 months</span>
                    <div className="flex gap-3">
                      <span className="flex items-center gap-1 text-[9px] text-sky-400/60"><span className="inline-block w-4 h-px bg-sky-400/40 rounded" />Revenue</span>
                      <span className="flex items-center gap-1 text-[9px] text-emerald-400/60"><span className="inline-block w-4 h-px bg-emerald-400 rounded" />Profit</span>
                    </div>
                  </div>
                  <div className="relative h-16">
                    <div className="absolute inset-0 opacity-50">
                      <Sparkline values={SPARKLINE_REVENUE} color="#38bdf8" width={500} height={64} />
                    </div>
                    <div className="absolute inset-0">
                      <Sparkline values={SPARKLINE_PROFIT} color="#34d399" width={500} height={64} />
                    </div>
                  </div>
                  {/* X axis labels */}
                  <div className="flex justify-between mt-1.5">
                    {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map(m => (
                      <span key={m} className="text-[8px] text-white/15">{m}</span>
                    ))}
                  </div>
                </div>

                {/* Recent sales */}
                <div className="sm:col-span-2 bg-white/[0.02] border border-white/[0.05] rounded-lg p-3">
                  <div className="text-[10px] text-white/30 uppercase tracking-widest font-medium mb-3">Recent Sales</div>
                  <div className="space-y-2.5">
                    {MOCK_TRANSACTIONS.map((t, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-white/70 truncate leading-tight">{t.product}</div>
                          <div className="text-[9px] text-white/25 mt-0.5">{t.platform}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] font-semibold text-emerald-400">+${t.profit}</span>
                          <Pill status={t.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats strip ── */}
      <section className="border-y border-white/[0.05] bg-white/[0.015] py-12 px-5 sm:px-8">
        <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-8">
          {[
            { num: '$0',     label: 'Cost to use',          sub: 'Free, always' },
            { num: '4',      label: 'Insights pages',       sub: 'Dashboard, Analytics, Cash Flow, Credit Card' },
            { num: '90+',    label: 'Preset credit cards',  sub: 'Chase, Amex, Capital One & more' },
            { num: '∞',      label: 'Platforms',            sub: 'eBay, StockX, GOAT, any marketplace' },
          ].map((s, i) => (
            <div key={i}>
              <div className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-none mb-1.5">{s.num}</div>
              <div className="text-[12px] font-medium text-white/50 mb-0.5">{s.label}</div>
              <div className="text-[11px] text-white/20">{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-16">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-indigo-400/80 mb-3">Features</p>
            <h2 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight text-white max-w-lg">
              Everything a reseller actually needs
            </h2>
          </div>

          {/* Asymmetric bento grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

            {/* Big card — profit dashboard */}
            <div className="sm:col-span-2 rounded-xl border border-white/[0.06] bg-[#0e0e13] p-6 overflow-hidden relative">
              <div className="mb-5">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 mb-3">
                  <TrendingUp size={14} className="text-emerald-400" />
                </div>
                <h3 className="text-[15px] font-semibold text-white mb-1">Profit &amp; ROI Dashboard</h3>
                <p className="text-[13px] text-white/35 leading-relaxed">Real-time P&amp;L, margin, ROI, and cashback — filterable by platform and timeframe.</p>
              </div>
              {/* Inline sparkline preview */}
              <div className="border border-white/[0.05] rounded-lg bg-black/20 p-3">
                <div className="flex gap-4 mb-2">
                  {[
                    { l: 'Revenue', v: '$24,830', c: 'text-sky-400' },
                    { l: 'Profit',  v: '$6,214',  c: 'text-emerald-400' },
                    { l: 'ROI',     v: '33.4%',   c: 'text-violet-400' },
                  ].map((m, i) => (
                    <div key={i}>
                      <div className="text-[9px] text-white/25 mb-0.5">{m.l}</div>
                      <div className={`text-sm font-bold ${m.c}`}>{m.v}</div>
                    </div>
                  ))}
                </div>
                <div className="h-12 relative">
                  <div className="absolute inset-0 opacity-40">
                    <Sparkline values={SPARKLINE_REVENUE} color="#38bdf8" width={500} height={48} />
                  </div>
                  <div className="absolute inset-0">
                    <Sparkline values={SPARKLINE_PROFIT} color="#34d399" width={500} height={48} />
                  </div>
                </div>
              </div>
            </div>

            {/* Credit card tracker */}
            <div className="rounded-xl border border-white/[0.06] bg-[#0e0e13] p-6">
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 mb-3">
                <CreditCard size={14} className="text-sky-400" />
              </div>
              <h3 className="text-[15px] font-semibold text-white mb-1">Credit Card Tracker</h3>
              <p className="text-[13px] text-white/35 leading-relaxed mb-4">Know exactly what to pay on each card and what cashback to redeem.</p>
              <div className="space-y-2">
                {MOCK_CARDS.slice(0, 2).map((c, i) => (
                  <div key={i} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-2.5 py-2 border border-white/[0.04]">
                    <div>
                      <div className="text-[10px] font-medium text-white/60 truncate max-w-[110px]">{c.name}</div>
                      <div className="text-[9px] text-emerald-400/70 mt-0.5">{c.rate} · +${c.cashback.toFixed(2)}</div>
                    </div>
                    <div className="text-[11px] font-bold text-white">${c.pay.toFixed(0)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cash flow */}
            <div className="rounded-xl border border-white/[0.06] bg-[#0e0e13] p-6">
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 mb-3">
                <Wallet size={14} className="text-violet-400" />
              </div>
              <h3 className="text-[15px] font-semibold text-white mb-1">Cash Flow</h3>
              <p className="text-[13px] text-white/35 leading-relaxed mb-4">See what's in transit, what you're owed, and where every dollar sits.</p>
              {/* Pipeline visual */}
              <div className="space-y-2">
                {[
                  { label: 'On Hand',    val: '$8,420', w: 72, c: 'bg-sky-500' },
                  { label: 'Listed',     val: '$4,880', w: 48, c: 'bg-violet-500' },
                  { label: 'Sold',       val: '$2,310', w: 28, c: 'bg-emerald-500' },
                ].map((r, i) => (
                  <div key={i}>
                    <div className="flex justify-between mb-1">
                      <span className="text-[9px] text-white/30">{r.label}</span>
                      <span className="text-[9px] font-semibold text-white/50">{r.val}</span>
                    </div>
                    <div className="h-1 rounded-full bg-white/[0.05]">
                      <div className={`h-1 rounded-full ${r.c} opacity-60`} style={{ width: `${r.w}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Analytics */}
            <div className="sm:col-span-2 rounded-xl border border-white/[0.06] bg-[#0e0e13] p-6">
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-3">
                <BarChart2 size={14} className="text-amber-400" />
              </div>
              <h3 className="text-[15px] font-semibold text-white mb-1">Analytics &amp; Trends</h3>
              <p className="text-[13px] text-white/35 leading-relaxed mb-4">Monthly breakdowns, platform comparisons, and period-over-period trends.</p>
              {/* Recent sales mini-table */}
              <div className="border border-white/[0.05] rounded-lg overflow-hidden">
                <div className="grid grid-cols-4 bg-white/[0.03] px-3 py-1.5">
                  {['Item', 'Platform', 'Profit', 'Cashback'].map(h => (
                    <span key={h} className="text-[9px] text-white/20 uppercase tracking-wider font-medium">{h}</span>
                  ))}
                </div>
                {MOCK_TRANSACTIONS.map((t, i) => (
                  <div key={i} className="grid grid-cols-4 px-3 py-2 border-t border-white/[0.03] hover:bg-white/[0.015] transition-colors">
                    <span className="text-[11px] text-white/60 truncate pr-2">{t.product}</span>
                    <span className="text-[11px] text-white/30">{t.platform}</span>
                    <span className="text-[11px] font-semibold text-emerald-400">+${t.profit}</span>
                    <span className="text-[11px] text-violet-400">+${t.cashback.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="py-24 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-3xl mx-auto">
          <div className="mb-14">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-indigo-400/80 mb-3">Getting started</p>
            <h2 className="text-3xl font-bold tracking-tight text-white">Up and running in minutes</h2>
          </div>
          <div className="space-y-10">
            {[
              { n: '1', icon: LogIn, title: 'Sign in with Discord', body: 'One click. No email, no password, no forms. Your data is stored privately and never shared.' },
              { n: '2', icon: ShoppingBag, title: 'Log your purchases', body: 'Add what you bought, which credit card you used, the vendor, and the cost. Takes seconds per item.' },
              { n: '3', icon: TrendingUp, title: 'Record sales, watch profit roll in', body: "Mark items sold when they move. Profit, margin, cashback, and cash flow update instantly across every page." },
            ].map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className="flex gap-6 items-start">
                  <div className="shrink-0 w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-[12px] font-bold text-white/30">
                    {s.n}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon size={14} className="text-white/40 shrink-0" />
                      <h3 className="text-[15px] font-semibold text-white">{s.title}</h3>
                    </div>
                    <p className="text-[13px] text-white/35 leading-relaxed">{s.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Capabilities checklist ── */}
      <section className="py-16 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-[13px] font-semibold text-white/30 uppercase tracking-widest mb-8">What's included</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-3">
            {[
              'P&L, ROI, and margin per item and overall',
              'Cashback calculation per card, per purchase',
              'Monthly credit card spend — pay vs. redeem breakdown',
              "Buyer pipeline — who owes you and when",
              'Inventory on-hand value and aging',
              'Platform & marketplace breakdowns',
              'Operating expense tracking',
              'Tax-exempt purchase management',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <CheckCircle size={14} className="text-emerald-500/70 shrink-0 mt-0.5" />
                <span className="text-[13px] text-white/45">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-white tracking-tight mb-10">Common questions</h2>
          <div className="divide-y divide-white/[0.05]">
            {faqs.map((f, i) => (
              <div key={i}>
                <button
                  className="w-full flex items-center justify-between py-4 text-left gap-4"
                  onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                >
                  <span className="text-[14px] font-medium text-white/75">{f.q}</span>
                  <ChevronDown size={15} className={`text-white/25 shrink-0 transition-transform duration-200 ${faqOpen === i ? 'rotate-180' : ''}`} />
                </button>
                {faqOpen === i && (
                  <p className="pb-4 text-[13px] text-white/35 leading-relaxed">{f.a}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
            Your numbers are waiting.
          </h2>
          <p className="text-[14px] text-white/35 mb-8">Sign in with Discord and see your full operation in minutes.</p>
          <button
            onClick={handleLogin}
            className="inline-flex items-center gap-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold text-[14px] px-6 py-3 rounded-lg transition-colors shadow-lg shadow-[#5865F2]/20"
          >
            <DiscordIcon className="w-5 h-5" />
            Get started — it's free
          </button>
          <p className="text-[11px] text-white/15 mt-4">No credit card · No bank connections · Free to use</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.05] px-5 sm:px-8 py-7">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#5865F2] flex items-center justify-center">
              <span className="text-white font-bold text-[10px] leading-none">P</span>
            </div>
            <span className="text-[12px] text-white/25 font-medium">Profit Tracker</span>
          </div>
          <p className="text-[11px] text-white/15">Built for resellers. Your data stays yours.</p>
        </div>
      </footer>

      {window.location.search.includes('error') && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-950/90 border border-red-900/60 text-red-300 px-5 py-3 rounded-xl text-sm shadow-xl backdrop-blur-sm whitespace-nowrap">
          Login failed — please try again.
        </div>
      )}
    </div>
  );
};

function DiscordIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 127.14 96.36" width="1em" height="1em">
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.2,46,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  );
}

export default Login;
