import React, { useEffect, useMemo, useState } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, CreditCard as CreditCardIcon, GalleryHorizontalEnd, LayoutGrid, Rows3, WalletCards } from 'lucide-react';
import { useCardFaces, useCashFlow, useCreditCard, usePaidBills, usePaymentMethods, usePlatforms } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import LoadError from '../components/UI/LoadError';
import CountUp from '../components/UI/CountUp';
import DueSoonBanner from '../components/CreditCard/DueSoonBanner';
import BestCard, { BestCardAnswer } from '../components/CreditCard/BestCard';
import CardDeck from '../components/CreditCard/CardDeck';
import CardDetails from '../components/CreditCard/CardDetails';
import CardRows from '../components/CreditCard/CardRows';
import CardSheet from '../components/CreditCard/CardSheet';
import CardTiles from '../components/CreditCard/CardTiles';
import CardWallet from '../components/CreditCard/CardWallet';
import FlightStage from '../components/CreditCard/FlightStage';
import PurchasesPanel from '../components/CreditCard/PurchasesPanel';
import { CardPageContext, usePlayfulMotion, useWidth } from '../components/CreditCard/context';
import { balanceText, dueText, money } from '../components/CreditCard/format';
import { artCatalogIds } from '../utils/cardArtwork';
import { SORTS, buildCards, loadCardPage, rankForStore, saveCardPage, sortCards, storeSuggestions } from '../utils/cardWallet';
import './CreditCard.css';

const MotionSpan = motion.span;
const VIEWS = [
  { id: 'wallet', label: 'Wallet', icon: WalletCards },
  { id: 'deck', label: 'Deck', icon: GalleryHorizontalEnd },
  { id: 'rows', label: 'Rows', icon: Rows3 },
  { id: 'tiles', label: 'Tiles', icon: LayoutGrid },
];

const toMonthKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const monthDate = (key, delta = 0) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1));
};
const offsetMonth = (key, delta) => toMonthKey(monthDate(key, delta));
const monthKeyToLabel = (key) => monthDate(key).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Summary({ cards, summary, play }) {
  const next = cards.find((c) => c.payNext) || cards.filter((c) => c.dueInDays !== null && !c.billPaid).sort((a, b) => a.dueInDays - b.dueInDays)[0];
  const balances = cards.filter((c) => c.balance !== null);
  const tiles = [
    ['Net to pay', money(summary.totalAmountToPay) ?? '—', `${cards.length} card${cards.length === 1 ? '' : 's'} this month`],
    ['Balance today', balances.length ? balanceText(balances.reduce((s, c) => s + c.balance, 0)) : '—', 'estimated'],
    ['Next payment', next ? next.dueLabel : '—', next ? `${next.name}, ${dueText(next).toLowerCase()}` : 'no due dates set'],
    ['Cashback to keep', money(summary.totalCashbackToKeep) ?? '—', summary.totalUncoveredLoss > 0 ? `${money(summary.totalUncoveredLoss)} loss not covered` : 'after covering losses'],
  ];
  return (
    <dl className="cc-summary cc-panel">
      {tiles.map(([label, value, sub]) => (
        <div key={label}><dt>{label}</dt><dd>{play && value.includes('$') ? <CountUp value={value} /> : value}<small title={sub}>{sub}</small></dd></div>
      ))}
    </dl>
  );
}

function ViewSwitch({ view, onView }) {
  return (
    <div className="cc-views" role="group" aria-label="View">
      {VIEWS.map(({ id, label, icon }) => {
        const Icon = icon;
        return (
        <button type="button" key={id} aria-pressed={view === id} onClick={() => onView(id)}>
          {view === id && <MotionSpan layoutId="cc-view-pill" className="cc-view-pill" transition={{ type: 'spring', stiffness: 420, damping: 30 }} />}
          <Icon size={15} aria-hidden="true" /><span>{label}</span>
        </button>
        );
      })}
    </div>
  );
}

function CreditCard() {
  const [selectedMonth, setSelectedMonth] = useState(() => toMonthKey(new Date()));
  const { data, isLoading, isLoadingError, refetch } = useCreditCard(selectedMonth);
  const { data: methods } = usePaymentMethods();
  const { data: cashflow } = useCashFlow();
  const { data: paid } = usePaidBills();
  const { data: platforms } = usePlatforms();
  const { data: faces } = useCardFaces(useMemo(() => artCatalogIds(methods), [methods]));

  // What this device remembers: the view, the sort and the cards' order.
  const [page, setPage] = useState(loadCardPage);
  const remember = (change) => setPage((prior) => { const next = { ...prior, ...change }; saveCardPage(next); return next; });
  const [activeId, setActiveId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [sheetId, setSheetId] = useState(null);
  const [store, setStore] = useState('');
  const [ref, width] = useWidth();
  const play = usePlayfulMotion();

  // Cards are dealt in once, when the page first opens.
  const [dealing, setDealing] = useState(true);
  const ready = Boolean(data);
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => setDealing(false), 1500);
    return () => clearTimeout(timer);
  }, [ready]);

  const catalogById = useMemo(() => new Map((faces?.cards || []).map((c) => [c.id, c])), [faces]);
  const cards = useMemo(() => buildCards({ dashboard: data, cashflow, methods, catalog: faces?.cards, paidBills: paid?.bills }), [data, cashflow, methods, faces, paid]);
  const searching = store.trim().length > 0;
  const shown = useMemo(() => (searching ? rankForStore(cards, store) : sortCards(cards, page.sort, page.order)), [cards, searching, store, page.sort, page.order]);
  const suggestions = useMemo(() => storeSuggestions(methods, platforms), [methods, platforms]);
  const context = useMemo(() => ({ catalogById, play }), [catalogById, play]);

  if (isLoading) return <PageLoader variant="generic" />;
  if (isLoadingError) return <LoadError title="Credit Card" what="your credit cards" onRetry={() => refetch()} />;

  const monthLabel = monthKeyToLabel(selectedMonth);
  const isCurrentMonth = selectedMonth === toMonthKey(new Date());
  // The chosen card; before one is chosen, the best one for the store, else the
  // first with spend this month.
  const active = shown.find((c) => c.id === activeId) ?? (searching ? shown[0] : shown.find((c) => c.spend > 0) ?? shown[0]);
  const { view } = page;
  const wide = width >= 900;

  const changeView = (next) => { setOpenId(null); setDealing(false); remember({ view: next }); };
  const searchStore = (value) => { setStore(value); setActiveId(null); setOpenId(null); };
  const move = (fromId, toId) => {
    const ids = shown.map((c) => c.id);
    const to = ids.indexOf(toId);
    ids.splice(ids.indexOf(fromId), 1);
    ids.splice(to, 0, fromId);
    setStore('');
    remember({ sort: 'custom', order: ids });
  };
  const toPurchases = () => {
    setSheetId(null);
    requestAnimationFrame(() => document.getElementById('card-purchases')?.scrollIntoView({ behavior: play ? 'smooth' : 'auto', block: 'start' }));
  };

  let body = null;
  let details = null;
  if (active) {
    const panel = <CardDetails card={active} monthLabel={monthLabel} />;
    const common = { cards: shown, activeId: active.id, onActivate: setActiveId };
    if (view === 'deck') { body = <CardDeck {...common} />; details = panel; }
    else if (view === 'rows') body = <CardRows {...common} openId={openId} onOpen={setOpenId} monthLabel={monthLabel} />;
    else if (view === 'tiles') body = <CardTiles {...common} onSelect={(id) => { setActiveId(id); setSheetId(id); }} />;
    else {
      body = <CardWallet {...common} marked={wide} openId={openId} onOpen={setOpenId} onReorder={move} />;
      details = wide || openId ? panel : null;
    }
  }
  const beside = details && view === 'wallet' && wide;
  // Rows and tiles also fly when they are put in a new order.
  const stageKey = view === 'rows' || view === 'tiles' ? `${view} ${shown.map((c) => c.id).join()}` : view;

  return (
    // The app shell never scrolls; each page owns its scroll container.
    <div className="cc-scroll">
      <CardPageContext.Provider value={context}>
        <MotionConfig reducedMotion={play ? 'never' : 'always'}>
          <div className="cc-page" ref={ref} data-play={play || undefined} data-deal={(play && dealing) || undefined}>
            <header className="cc-top">
              <div>
                <h1>Credit Card</h1>
                <p>What each card owes this month and how cashback covers losses</p>
              </div>
              <div className="cc-month-nav">
                <button type="button" onClick={() => setSelectedMonth((prev) => offsetMonth(prev, -1))} aria-label="Previous month" className="page-btn page-btn-secondary page-btn-sm page-btn-icon"><ChevronLeft size={14} /></button>
                <span>{monthLabel}</span>
                <button type="button" onClick={() => setSelectedMonth((prev) => offsetMonth(prev, 1))} aria-label="Next month" disabled={isCurrentMonth} className="page-btn page-btn-secondary page-btn-sm page-btn-icon"><ChevronRight size={14} /></button>
              </div>
            </header>

            <DueSoonBanner />

            {!active ? (
              <div className="cc-panel cc-empty">
                <CreditCardIcon size={32} aria-hidden="true" />
                <b>No credit cards set up</b>
                <p>Add a credit card payment method in Settings to start tracking spending and cashback.</p>
              </div>
            ) : (
              <>
                <Summary cards={cards} summary={data?.summary ?? {}} play={play} />
                <div className="cc-toolbar">
                  <h2>Your cards <span>{shown.length}</span></h2>
                  <BestCard store={store} onStore={searchStore} suggestions={suggestions} />
                  <ViewSwitch view={view} onView={changeView} />
                  <label>Sort <select value={page.sort} disabled={searching} onChange={(e) => remember({ sort: e.target.value })}>{Object.entries(SORTS).map(([key, sort]) => <option key={key} value={key}>{sort.label}</option>)}</select></label>
                </div>
                {searching && <BestCardAnswer store={store} cards={shown} />}
                <FlightStage view={stageKey} enabled={play}>
                  {beside
                    ? <div className="cc-split"><div>{body}</div><div className="cc-split-side">{details}</div></div>
                    : <>{body}{details && <div className="cc-below">{details}</div>}</>}
                </FlightStage>
                <PurchasesPanel key={active.id} card={active.source} monthLabel={monthLabel} />
              </>
            )}
          </div>
          <CardSheet key={sheetId} card={shown.find((c) => c.id === sheetId)} onClose={() => setSheetId(null)} monthLabel={monthLabel} onPurchases={toPurchases} />
        </MotionConfig>
      </CardPageContext.Provider>
    </div>
  );
}

export default CreditCard;
