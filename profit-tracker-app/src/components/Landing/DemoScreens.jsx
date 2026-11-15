import React, { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, CheckCircle2, Clock, PackagePlus, Tag } from 'lucide-react';
import {
  CARDS, PLATFORMS, byPlatform, calendarEvents, cardOf, cardSummary, cashFlow, cashbackOf,
  formatMoney, itemProfit, monthlySeries, parseDollars, platformFee, saleNet, toISODate, totals,
} from './demoData';

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function ScreenHead({ title, sub, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-[19px] font-extrabold tracking-tight text-[var(--lp-text)] leading-tight">{title}</h3>
        {sub && <p className="text-[12.5px] text-[var(--lp-text-3)] mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Stat({ label, value, note, tone, flash }) {
  const color = tone === 'gain' ? 'text-[var(--lp-gain)]' : tone === 'loss' ? 'text-[var(--lp-loss)]' : tone === 'accent' ? 'text-[var(--lp-accent-text)]' : 'text-[var(--lp-text)]';
  return (
    <div key={flash ? `${label}-${flash}` : label} className={`lp-card px-3.5 py-3 min-w-0 ${flash ? 'lp-flash' : ''}`}>
      <div className="text-[11px] font-bold text-[var(--lp-text-3)] uppercase tracking-wider truncate">{label}</div>
      <div className={`lp-num text-[20px] font-extrabold mt-1 leading-none truncate ${color}`}>{value}</div>
      {note && <div className="text-[11.5px] text-[var(--lp-text-3)] mt-1.5 truncate">{note}</div>}
    </div>
  );
}

// Simple bar chart. series: [{ label, values: [cents, ...] }], colors per value.
function Bars({ series, colors, height = 140, legend }) {
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Math.abs(v))));
  const n = series[0]?.values.length ?? 1;
  return (
    <div>
      {legend && (
        <div className="flex flex-wrap gap-3 mb-2">
          {legend.map((l, i) => (
            <span key={l} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--lp-text-3)]">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[i] }} />{l}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 sm:gap-3" style={{ height }} role="img" aria-label={`${legend?.join(' and ') ?? 'Values'} by month`}>
        {series.map((s) => (
          <div key={s.label} className="flex-1 h-full flex flex-col justify-end items-center gap-1 min-w-0">
            <div className="w-full flex-1 flex items-end justify-center gap-[3px]">
              {s.values.map((v, i) => (
                <div
                  key={i}
                  title={`${s.label}: ${formatMoney(v, { whole: true })}`}
                  className="rounded-t-[4px] transition-[height] duration-500"
                  style={{
                    width: `${Math.max(100 / n - 4, 18)}%`,
                    maxWidth: 26,
                    height: `${Math.max((Math.abs(v) / max) * 100, v ? 3 : 1)}%`,
                    background: v < 0 ? 'var(--lp-loss)' : colors[i],
                    opacity: v ? 1 : 0.25,
                  }}
                />
              ))}
            </div>
            <span className="text-[10.5px] text-[var(--lp-text-3)]">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ title, children, action, className = '' }) {
  return (
    <div className={`lp-card p-3.5 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h4 className="text-[12.5px] font-extrabold text-[var(--lp-text-2)]">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

const LinkBtn = ({ children, onClick }) => (
  <button type="button" onClick={onClick} className="lp-focus inline-flex items-center gap-1 text-[12px] font-bold text-[var(--lp-accent-text)] hover:underline rounded">
    {children} <ArrowRight size={12} />
  </button>
);

// ─── Dashboard ─────────────────────────────────────────────────────────────

export function DashboardScreen({ items, today, go, flash }) {
  const t = totals(items);
  const months = monthlySeries(items, today);
  const flow = cashFlow(items);
  const recent = items.filter((x) => x.sale).sort((a, b) => b.sale.soldOn.localeCompare(a.sale.soldOn)).slice(0, 5);
  return (
    <div>
      <ScreenHead
        title="Dashboard"
        sub="Everything you've bought and sold, added up."
        action={<button type="button" onClick={() => go('add')} className="lp-btn lp-btn-primary lp-btn-sm"><Tag size={14} /> Log a sale</button>}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-2.5">
        <Stat label="Net profit" value={formatMoney(t.profit)} note={`${pct(t.margin)} margin`} tone={t.profit >= 0 ? 'gain' : 'loss'} flash={flash?.kpi} />
        <Stat label="Revenue" value={formatMoney(t.revenue, { whole: true })} note={`${t.unitsSold} items sold`} flash={flash?.kpi} />
        <Stat label="ROI" value={pct(t.roi)} note="profit ÷ what you paid" tone={t.roi >= 0 ? 'gain' : 'loss'} flash={flash?.kpi} />
        <Stat label="Inventory" value={formatMoney(t.inventoryValue, { whole: true })} note={`${t.inStockCount} items in stock`} flash={flash?.inv} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">
        <Panel title="Profit by month" className="lg:col-span-3" action={<LinkBtn onClick={() => go('analytics')}>Analytics</LinkBtn>}>
          <Bars series={months.map((m) => ({ label: m.label, values: [m.profit] }))} colors={['var(--lp-accent)']} />
        </Panel>
        <Panel title="Recent sales" className="lg:col-span-2" action={<LinkBtn onClick={() => go('inventory')}>All items</LinkBtn>}>
          <ul className="space-y-2">
            {recent.map((x) => (
              <li key={x.id} className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-1 -mx-1.5 ${flash?.item === x.id ? 'lp-flash' : ''}`}>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold truncate">{x.name}</div>
                  <div className="text-[11px] text-[var(--lp-text-3)]">{x.sale.platform} · {shortDate(x.sale.soldOn)}</div>
                </div>
                <span className={`lp-num text-[12.5px] font-extrabold shrink-0 ${itemProfit(x) >= 0 ? 'text-[var(--lp-gain)]' : 'text-[var(--lp-loss)]'}`}>
                  {formatMoney(itemProfit(x), { sign: true })}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {flow.pending.length > 0 && (
        <button type="button" onClick={() => go('cashflow')} className="lp-focus mt-2.5 w-full lp-card px-3.5 py-2.5 flex items-center justify-between gap-3 text-left hover:border-[var(--lp-border-strong)]">
          <span className="flex items-center gap-2 text-[12.5px] min-w-0">
            <Clock size={14} className="text-[var(--lp-warn)] shrink-0" />
            <span className="truncate"><b>{formatMoney(flow.pendingTotal)}</b> waiting on {flow.pending.length} payout{flow.pending.length === 1 ? '' : 's'}</span>
          </span>
          <ArrowRight size={14} className="text-[var(--lp-text-3)] shrink-0" />
        </button>
      )}
    </div>
  );
}

// ─── Log a sale / purchase ─────────────────────────────────────────────────

function Field({ label, id, children, hint }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="lp-label">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-[var(--lp-text-3)] mt-1">{hint}</p>}
    </div>
  );
}

function Row({ label, value, strong, tone }) {
  return (
    <div className={`flex justify-between gap-3 text-[12.5px] ${strong ? 'pt-2 mt-1 border-t border-[var(--lp-border)] font-extrabold text-[14px]' : 'text-[var(--lp-text-2)]'}`}>
      <span>{label}</span>
      <span className={`lp-num ${tone === 'gain' ? 'text-[var(--lp-gain)]' : tone === 'loss' ? 'text-[var(--lp-loss)]' : ''}`}>{value}</span>
    </div>
  );
}

function SaleForm({ items, today, dispatch, preselect, onDone }) {
  const inStock = items.filter((x) => !x.sale);
  const [itemId, setItemId] = useState(preselect && inStock.some((x) => x.id === preselect) ? preselect : inStock[0]?.id ?? '');
  const [price, setPrice] = useState('');
  const [platform, setPlatform] = useState('eBay');
  const [shipping, setShipping] = useState('');
  const [date, setDate] = useState(toISODate(today));
  const [error, setError] = useState('');

  const item = inStock.find((x) => x.id === itemId);
  const priceC = parseDollars(price);
  const shipC = shipping === '' ? 0 : parseDollars(shipping);
  const fee = priceC ? platformFee(platform, priceC) : 0;
  const net = priceC != null && shipC != null ? priceC - fee - shipC : null;
  const profit = net != null && item ? net - item.cost : null;

  if (!inStock.length) {
    return <p className="text-[13px] text-[var(--lp-text-2)]">Everything's sold. Log a purchase first, then sell it here.</p>;
  }

  const submit = (e) => {
    e.preventDefault();
    const res = dispatch({ type: 'logSale', itemId, price, platform, shipping, date });
    if (res.error) { setError(res.error); return; }
    onDone(res.item);
  };

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 md:grid-cols-5 gap-3">
      <div className="md:col-span-3 lp-card p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Field label="Item from inventory" id="demo-sale-item">
            <select id="demo-sale-item" className="lp-input" value={itemId} onChange={(e) => { setItemId(e.target.value); setError(''); }}>
              {inStock.map((x) => <option key={x.id} value={x.id}>{x.name} (paid {formatMoney(x.cost)})</option>)}
            </select>
          </Field>
        </div>
        <Field label="Sold for" id="demo-sale-price">
          <input id="demo-sale-price" className="lp-input lp-num" inputMode="decimal" placeholder="$0.00" value={price}
            aria-invalid={price !== '' && priceC == null}
            onChange={(e) => { setPrice(e.target.value); setError(''); }} />
        </Field>
        <Field label="Where it sold" id="demo-sale-platform">
          <select id="demo-sale-platform" className="lp-input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.id} ({(p.fee * 100).toFixed(p.fee * 100 % 1 ? 2 : 0)}% fee)</option>)}
          </select>
        </Field>
        <Field label="Shipping you paid" id="demo-sale-ship" hint="Leave blank if the buyer paid.">
          <input id="demo-sale-ship" className="lp-input lp-num" inputMode="decimal" placeholder="$0.00" value={shipping}
            aria-invalid={shipping !== '' && (shipC == null || (priceC != null && shipC >= priceC))}
            onChange={(e) => { setShipping(e.target.value); setError(''); }} />
        </Field>
        <Field label="Date sold" id="demo-sale-date">
          <input id="demo-sale-date" type="date" className="lp-input" value={date} min={item?.boughtOn} max={toISODate(today)}
            onChange={(e) => { setDate(e.target.value); setError(''); }} />
        </Field>
      </div>
      <div className="md:col-span-2 lp-card p-3.5 flex flex-col">
        <h4 className="text-[12.5px] font-extrabold text-[var(--lp-text-2)] mb-2.5">What you'll make</h4>
        <div className="space-y-1.5 flex-1">
          <Row label="Sale price" value={priceC ? formatMoney(priceC) : '—'} />
          <Row label={`${platform} fee`} value={priceC ? formatMoney(-fee) : '—'} />
          <Row label="Shipping" value={shipC ? formatMoney(-shipC) : '$0.00'} />
          <Row label="You paid" value={item ? formatMoney(-item.cost) : '—'} />
          <Row label="Profit" strong value={profit != null ? formatMoney(profit, { sign: true }) : '—'} tone={profit == null ? null : profit >= 0 ? 'gain' : 'loss'} />
          {profit != null && item && <p className="text-[11.5px] text-[var(--lp-text-3)]">{pct(profit / item.cost)} return on this flip</p>}
        </div>
        {error && <p role="alert" className="text-[12px] text-[var(--lp-loss)] mt-2">{error}</p>}
        <button type="submit" className="lp-btn lp-btn-primary mt-3 w-full">Log sale</button>
      </div>
    </form>
  );
}

function PurchaseForm({ today, dispatch, onDone }) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [card, setCard] = useState(CARDS[0].id);
  const [store, setStore] = useState('');
  const [date, setDate] = useState(toISODate(today));
  const [error, setError] = useState('');
  const costC = parseDollars(cost);
  const cashback = costC ? Math.round(costC * (cardOf(card)?.rate ?? 0)) : 0;

  const submit = (e) => {
    e.preventDefault();
    const res = dispatch({ type: 'logPurchase', name, cost, card, store, date });
    if (res.error) { setError(res.error); return; }
    onDone(res.item);
  };

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 md:grid-cols-5 gap-3">
      <div className="md:col-span-3 lp-card p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Field label="What did you buy?" id="demo-buy-name">
            <input id="demo-buy-name" className="lp-input" placeholder="e.g. Jordan 1 High OG" maxLength={60} value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }} />
          </Field>
        </div>
        <Field label="You paid" id="demo-buy-cost">
          <input id="demo-buy-cost" className="lp-input lp-num" inputMode="decimal" placeholder="$0.00" value={cost}
            aria-invalid={cost !== '' && costC == null}
            onChange={(e) => { setCost(e.target.value); setError(''); }} />
        </Field>
        <Field label="Card used" id="demo-buy-card">
          <select id="demo-buy-card" className="lp-input" value={card} onChange={(e) => setCard(e.target.value)}>
            {CARDS.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.rate * 100}% back)</option>)}
          </select>
        </Field>
        <Field label="Store" id="demo-buy-store">
          <input id="demo-buy-store" className="lp-input" placeholder="e.g. Foot Locker" maxLength={40} value={store} onChange={(e) => setStore(e.target.value)} />
        </Field>
        <Field label="Date bought" id="demo-buy-date">
          <input id="demo-buy-date" type="date" className="lp-input" value={date} max={toISODate(today)} onChange={(e) => { setDate(e.target.value); setError(''); }} />
        </Field>
      </div>
      <div className="md:col-span-2 lp-card p-3.5 flex flex-col">
        <h4 className="text-[12.5px] font-extrabold text-[var(--lp-text-2)] mb-2.5">This purchase</h4>
        <div className="space-y-1.5 flex-1">
          <Row label="Cost" value={costC ? formatMoney(costC) : '—'} />
          <Row label={`Cashback (${(cardOf(card)?.rate ?? 0) * 100}%)`} value={costC ? formatMoney(cashback, { sign: true }) : '—'} tone={costC ? 'gain' : null} />
          <Row label="Real cost" strong value={costC ? formatMoney(costC - cashback) : '—'} />
          <p className="text-[11.5px] text-[var(--lp-text-3)]">It goes into your inventory until you sell it.</p>
        </div>
        {error && <p role="alert" className="text-[12px] text-[var(--lp-loss)] mt-2">{error}</p>}
        <button type="submit" className="lp-btn lp-btn-primary mt-3 w-full">Add to inventory</button>
      </div>
    </form>
  );
}

export function AddScreen({ items, today, dispatch, go, preselect, initialTab = 'sale', notify }) {
  const [tab, setTab] = useState(initialTab);
  const tabs = [
    { id: 'sale', label: 'Log a sale', icon: Tag },
    { id: 'buy', label: 'Log a purchase', icon: PackagePlus },
  ];
  return (
    <div>
      <ScreenHead title={tab === 'sale' ? 'Log a sale' : 'Log a purchase'} sub={tab === 'sale' ? 'Pick what sold. Fees and profit work themselves out.' : 'Add stock you bought and the card you paid with.'} />
      <div role="tablist" aria-label="What to log" className="inline-flex p-1 rounded-[10px] bg-[var(--lp-sidebar)] border border-[var(--lp-border)] mb-3">
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.id)}
              className={`lp-focus inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[12.5px] font-bold transition-colors ${on ? 'bg-[var(--lp-raised)] text-[var(--lp-text)]' : 'text-[var(--lp-text-3)] hover:text-[var(--lp-text-2)]'}`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'sale' ? (
        <SaleForm items={items} today={today} dispatch={dispatch} preselect={preselect}
          onDone={(item) => { notify(`Sold ${item.name}: ${formatMoney(itemProfit(item), { sign: true })} profit`); go('dashboard', { item: item.id, kpi: Date.now() }); }} />
      ) : (
        <PurchaseForm today={today} dispatch={dispatch}
          onDone={(item) => { notify(`${item.name} added to inventory`); go('inventory', { item: item.id, inv: Date.now() }); }} />
      )}
    </div>
  );
}

// ─── Inventory ─────────────────────────────────────────────────────────────

export function InventoryScreen({ items, go, flash }) {
  const [filter, setFilter] = useState('stock');
  const list = items.filter((x) => (filter === 'stock' ? !x.sale : filter === 'sold' ? x.sale : true));
  const t = totals(items);
  const filters = [['stock', `In stock (${t.inStockCount})`], ['sold', `Sold (${t.unitsSold})`], ['all', 'All']];
  return (
    <div>
      <ScreenHead
        title="Inventory"
        sub={`${formatMoney(t.inventoryValue)} sitting in ${t.inStockCount} items.`}
        action={<button type="button" onClick={() => go('add', { tab: 'buy' })} className="lp-btn lp-btn-ghost lp-btn-sm"><PackagePlus size={14} /> Log a purchase</button>}
      />
      <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Filter items">
        {filters.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
            className={`lp-focus px-2.5 py-1 rounded-full text-[12px] font-bold border transition-colors ${filter === id ? 'bg-[var(--lp-accent-tint)] border-[rgba(var(--accent-rgb),0.5)] text-[var(--lp-text)]' : 'border-[var(--lp-border-strong)] text-[var(--lp-text-3)] hover:text-[var(--lp-text-2)]'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="lp-card overflow-hidden">
        <div className="hidden sm:grid grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr_92px] gap-3 px-3.5 py-2 text-[10.5px] font-bold uppercase tracking-wider text-[var(--lp-text-3)] border-b border-[var(--lp-border)]">
          <span>Item</span><span>Bought</span><span>Paid</span><span>Profit</span><span />
        </div>
        {list.length === 0 && <p className="px-3.5 py-6 text-[13px] text-[var(--lp-text-3)] text-center">Nothing here yet.</p>}
        <ul>
          {list.map((x) => (
            <li key={x.id} className={`grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr_92px] gap-x-3 gap-y-0.5 items-center px-3.5 py-2.5 border-b last:border-b-0 border-[var(--lp-border)] ${flash?.item === x.id ? 'lp-flash' : ''}`}>
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold truncate">{x.name}</div>
                <div className="text-[11px] text-[var(--lp-text-3)] truncate">{x.category} · {x.store}</div>
              </div>
              <span className="hidden sm:block text-[12px] text-[var(--lp-text-2)]">{shortDate(x.boughtOn)}</span>
              <span className="hidden sm:block lp-num text-[12px] text-[var(--lp-text-2)]">{formatMoney(x.cost)}</span>
              <span className={`hidden sm:block lp-num text-[12px] font-bold ${x.sale ? (itemProfit(x) >= 0 ? 'text-[var(--lp-gain)]' : 'text-[var(--lp-loss)]') : 'text-[var(--lp-text-3)]'}`}>
                {x.sale ? formatMoney(itemProfit(x), { sign: true }) : '—'}
              </span>
              <div className="row-span-2 sm:row-span-1 justify-self-end">
                {x.sale ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--lp-text-3)]"><CheckCircle2 size={12} /> {x.sale.platform}</span>
                ) : (
                  <button type="button" onClick={() => go('add', { tab: 'sale', item: x.id })} className="lp-btn lp-btn-ghost lp-btn-sm !py-1.5">Sell</button>
                )}
              </div>
              <span className="sm:hidden lp-num text-[11px] text-[var(--lp-text-3)]">
                Paid {formatMoney(x.cost)}{x.sale && <> · <b className={itemProfit(x) >= 0 ? 'text-[var(--lp-gain)]' : 'text-[var(--lp-loss)]'}>{formatMoney(itemProfit(x), { sign: true })}</b></>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Credit cards ──────────────────────────────────────────────────────────

export function CardsScreen({ items, today }) {
  const cards = cardSummary(items, today);
  const totalBack = cards.reduce((s, c) => s + c.cashback, 0);
  const monthSpend = cards.reduce((s, c) => s + c.monthSpend, 0);
  const best = [...cards].sort((a, b) => b.rate - a.rate)[0];
  const monthName = today.toLocaleString('en-US', { month: 'long' });
  return (
    <div>
      <ScreenHead title="Credit cards" sub="What you spent on each card and what it paid you back." />
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <Stat label={`Spent in ${monthName}`} value={formatMoney(monthSpend)} note="across all cards" />
        <Stat label="Cashback earned" value={formatMoney(totalBack)} note="on every purchase so far" tone="gain" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {cards.map((c) => (
          <div key={c.id} className="lp-card p-3.5 min-w-0">
            <div className="rounded-[10px] p-3 mb-3 text-white relative overflow-hidden" style={{ background: c.id === best.id ? 'var(--accent-gradient)' : 'linear-gradient(140deg, #3a3c41, #26282c)' }}>
              <div className="text-[12.5px] font-extrabold truncate">{c.name}</div>
              <div className="lp-num text-[11px] opacity-75 mt-4">•••• {c.last4}</div>
              <span className="absolute top-2.5 right-3 text-[11px] font-extrabold opacity-90">{c.rate * 100}%</span>
            </div>
            <Row label={`${monthName} spend`} value={formatMoney(c.monthSpend)} />
            <div className="h-1.5 rounded-full bg-[var(--lp-well)] my-2" aria-hidden="true">
              <div className="h-full rounded-full bg-[var(--lp-accent)] transition-[width] duration-500" style={{ width: `${Math.max(c.utilization * 100, c.monthSpend ? 2 : 0)}%` }} />
            </div>
            <Row label="Purchases" value={c.purchases} />
            <Row label="Cashback" value={formatMoney(c.cashback, { sign: true })} tone="gain" />
          </div>
        ))}
      </div>
      <p className="text-[12px] text-[var(--lp-text-3)] mt-3">
        Tip: {best.name} pays the most back ({best.rate * 100}%). Log a purchase on it and watch the numbers above change.
      </p>
    </div>
  );
}

// ─── Cash flow ─────────────────────────────────────────────────────────────

export function CashFlowScreen({ items, today, dispatch, notify }) {
  const f = cashFlow(items);
  const months = monthlySeries(items, today);
  return (
    <div>
      <ScreenHead title="Cash flow" sub="Money out on stock, money back from sales, and what's still on the way." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-2.5">
        <Stat label="Money in" value={formatMoney(f.moneyIn, { whole: true })} note="payouts received" tone="gain" />
        <Stat label="Money out" value={formatMoney(f.moneyOut, { whole: true })} note="spent on stock" />
        <Stat label="On the way" value={formatMoney(f.pendingTotal, { whole: true })} note={`${f.pending.length} payout${f.pending.length === 1 ? '' : 's'} pending`} />
        <Stat label="Tied up" value={formatMoney(f.tiedUp, { whole: true })} note="unsold inventory" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">
        <Panel title="In vs. out by month" className="lg:col-span-3">
          <Bars
            series={months.map((m) => ({ label: m.label, values: [m.moneyIn, m.moneyOut] }))}
            colors={['var(--lp-text-2)', 'var(--lp-accent)']}
            legend={['Money in', 'Money out']}
          />
        </Panel>
        <Panel title="Waiting on payouts" className="lg:col-span-2">
          {f.pending.length === 0 ? (
            <p className="text-[12.5px] text-[var(--lp-text-3)] py-4 text-center">All paid out. Nice.</p>
          ) : (
            <ul className="space-y-2">
              {f.pending.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold truncate">{x.name}</div>
                    <div className="lp-num text-[11px] text-[var(--lp-text-3)]">{x.sale.platform} · {formatMoney(saleNet(x))}</div>
                  </div>
                  <button type="button" className="lp-btn lp-btn-ghost lp-btn-sm !py-1.5 shrink-0"
                    onClick={() => { dispatch({ type: 'markPaid', itemId: x.id }); notify(`${x.sale.platform} paid out ${formatMoney(saleNet(x))}`); }}>
                    Mark paid
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ─── Analytics ─────────────────────────────────────────────────────────────

export function AnalyticsScreen({ items, today }) {
  const months = monthlySeries(items, today);
  const platforms = byPlatform(items);
  const maxP = Math.max(1, ...platforms.map((p) => Math.abs(p.profit)));
  const top = items.filter((x) => x.sale).sort((a, b) => itemProfit(b) - itemProfit(a)).slice(0, 4);
  const t = totals(items);
  const avg = t.unitsSold ? Math.round(t.profit / t.unitsSold) : 0;
  return (
    <div>
      <ScreenHead title="Analytics" sub="Which months, marketplaces and items actually make you money." />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 mb-2.5">
        <Stat label="Avg profit / flip" value={formatMoney(avg)} tone={avg >= 0 ? 'gain' : 'loss'} />
        <Stat label="Margin" value={pct(t.margin)} />
        <Stat label="Cashback on top" value={formatMoney(t.cashback)} tone="gain" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">
        <Panel title="Revenue and profit" className="lg:col-span-3">
          <Bars
            series={months.map((m) => ({ label: m.label, values: [m.revenue, m.profit] }))}
            colors={['#5a5c62', 'var(--lp-accent)']}
            legend={['Revenue', 'Profit']}
          />
        </Panel>
        <Panel title="Profit by marketplace" className="lg:col-span-2">
          <ul className="space-y-2.5">
            {platforms.map((p) => (
              <li key={p.id}>
                <div className="flex justify-between text-[12px] mb-1">
                  <span className="font-bold">{p.id} <span className="font-normal text-[var(--lp-text-3)]">· {p.count} sold</span></span>
                  <span className={`lp-num font-bold ${p.profit >= 0 ? 'text-[var(--lp-gain)]' : 'text-[var(--lp-loss)]'}`}>{formatMoney(p.profit, { whole: true })}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--lp-well)]" aria-hidden="true">
                  <div className="h-full rounded-full bg-[var(--lp-accent)] transition-[width] duration-500" style={{ width: `${(Math.abs(p.profit) / maxP) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Best flips" className="mt-2.5">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {top.map((x, i) => (
            <li key={x.id} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="min-w-0 truncate"><span className="text-[var(--lp-text-3)] mr-1.5">{i + 1}.</span>{x.name}</span>
              <span className={`lp-num font-extrabold shrink-0 ${itemProfit(x) >= 0 ? 'text-[var(--lp-gain)]' : 'text-[var(--lp-loss)]'}`}>{formatMoney(itemProfit(x), { sign: true })}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

// ─── Calendar ──────────────────────────────────────────────────────────────

export function CalendarScreen({ items, today }) {
  const events = useMemo(() => calendarEvents(items), [items]);
  const todayISO = toISODate(today);
  // Open on the latest day that has something on it, not an empty today.
  const [selected, setSelected] = useState(() => Object.keys(events).filter((d) => d <= todayISO).sort().pop() ?? todayISO);
  const [offset, setOffset] = useState(() => {
    const [y, m] = selected.split('-').map(Number);
    return (y - today.getFullYear()) * 12 + (m - 1 - today.getMonth());
  });
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = first.getDay();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => toISODate(new Date(first.getFullYear(), first.getMonth(), i + 1)))];
  const dayEvents = events[selected] ?? [];
  const title = first.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      <ScreenHead title="Calendar" sub="Every purchase and sale on the day it happened. Tap a day." />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">
        <div className="lp-card p-3 lg:col-span-3 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <button type="button" aria-label="Previous month" disabled={offset <= -5} onClick={() => setOffset(offset - 1)} className="lp-focus p-1.5 rounded-md hover:bg-[var(--lp-raised)] disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-[13px] font-extrabold" aria-live="polite">{title}</span>
            <button type="button" aria-label="Next month" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} className="lp-focus p-1.5 rounded-md hover:bg-[var(--lp-raised)] disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold text-[var(--lp-text-3)] mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((iso, i) => {
              if (!iso) return <span key={`b${i}`} />;
              const ev = events[iso] ?? [];
              const sold = ev.filter((e) => e.kind === 'sold').length;
              const bought = ev.length - sold;
              const on = iso === selected;
              return (
                <button key={iso} type="button" onClick={() => setSelected(iso)} aria-pressed={on}
                  aria-label={`${shortDate(iso)}: ${sold} sold, ${bought} bought`}
                  className={`lp-focus aspect-square sm:aspect-auto sm:h-12 rounded-md flex flex-col items-center justify-center gap-1 text-[12px] transition-colors ${on ? 'bg-[var(--lp-accent-tint)] ring-1 ring-[rgba(var(--accent-rgb),0.6)]' : 'hover:bg-[var(--lp-raised)]'} ${iso === todayISO ? 'font-extrabold text-[var(--lp-accent-text)]' : 'text-[var(--lp-text-2)]'}`}>
                  <span className="lp-num leading-none">{Number(iso.slice(8))}</span>
                  <span className="flex gap-0.5 h-1.5">
                    {sold > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-accent-text)]" />}
                    {bought > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-text-3)]" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-4 mt-2.5 text-[11px] text-[var(--lp-text-3)]">
            <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-accent-text)]" />Sold</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-text-3)]" />Bought</span>
          </div>
        </div>
        <Panel title={new Date(`${selected}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} className="lg:col-span-2">
          {dayEvents.length === 0 ? (
            <p className="text-[12.5px] text-[var(--lp-text-3)] py-4 text-center">Nothing logged this day.</p>
          ) : (
            <ul className="space-y-2.5">
              {dayEvents.map((e) => (
                <li key={`${e.kind}-${e.item.id}`} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold truncate">{e.item.name}</div>
                    <div className="text-[11px] text-[var(--lp-text-3)]">
                      {e.kind === 'sold' ? `Sold on ${e.item.sale.platform}` : `Bought at ${e.item.store} · ${cardOf(e.item.card)?.name}`}
                    </div>
                  </div>
                  <span className={`lp-num text-[12.5px] font-extrabold shrink-0 ${e.kind !== 'sold' ? 'text-[var(--lp-text-2)]' : itemProfit(e.item) >= 0 ? 'text-[var(--lp-gain)]' : 'text-[var(--lp-loss)]'}`}>
                    {e.kind === 'sold' ? formatMoney(itemProfit(e.item), { sign: true }) : formatMoney(-e.item.cost)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {dayEvents.some((e) => e.kind === 'bought') && (
            <p className="text-[11px] text-[var(--lp-text-3)] mt-3">
              Cashback that day: {formatMoney(dayEvents.filter((e) => e.kind === 'bought').reduce((s, e) => s + cashbackOf(e.item), 0))}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
