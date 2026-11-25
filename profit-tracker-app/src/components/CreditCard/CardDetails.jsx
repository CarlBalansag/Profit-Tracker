import React from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, ListOrdered, Pencil } from 'lucide-react';
import { formatEarnRate } from '../../utils/cardRewards';
import { billKey } from '../../utils/cardWallet';
import { useMarkBillPaid } from '../../hooks/useMarkBillPaid';
import CountUp from '../UI/CountUp';
import { useCardPage } from './context';
import { balanceText, dueText, money, subtitle } from './format';
import { CardChip, UtilBar } from './parts';

const SETTINGS = { tab: 'datasetup', view: 'Payment Methods' };
const pointsText = (n, unit) => (n === null ? null : `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US')} ${unit || 'pts'}`);
const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

function Fact({ label, children, hint }) {
  return <div className="cc-fact"><dt>{label}</dt><dd>{children}{hint && <small>{hint}</small>}</dd></div>;
}

function MonthFacts({ card }) {
  return (
    <dl className="cc-facts">
      <Fact label="Total Spend" hint={`${card.txnCount} item${card.txnCount === 1 ? '' : 's'} this month`}>{money(card.spend)}</Fact>
      <Fact label={card.points ? 'Points Earned' : 'Cashback Earned'} hint={[pointsText(card.earnedPoints, card.reward.unit), card.redeem > 0 && `${money(card.redeem)} redeemed for losses`].filter(Boolean).join(' · ')}>{money(card.earned)}</Fact>
      <Fact label="Keep as Points" hint={card.uncoveredLoss > 0 ? `${money(card.uncoveredLoss)} loss not covered` : pointsText(card.keepPoints, card.reward.unit)}><span className={card.uncoveredLoss > 0 ? 'cc-red' : ''}>{money(card.keep)}</span></Fact>
      {card.minPayment !== null && <Fact label="Min payment">{money(card.minPayment)}</Fact>}
    </dl>
  );
}

function TodayFacts({ card }) {
  return (
    <dl className="cc-facts">
      {card.balance !== null && <Fact label="Balance" hint="estimated, less refunds">{balanceText(card.balance)}</Fact>}
      {card.statementBalance !== null && <Fact label="Last statement" hint={card.billPaid ? 'marked paid' : card.bill !== null ? 'not paid yet' : null}>{money(card.statementBalance)}</Fact>}
      {card.available !== null && <Fact label="Available credit"><span className={card.available < 0 ? 'cc-red' : ''}>{money(card.available)}</span></Fact>}
      {card.limit !== null && <Fact label="Credit limit">{money(card.limit)}</Fact>}
      {card.dueLabel && <Fact label="Payment due" hint={card.billPaid ? 'paid' : dueText(card)}>{card.dueLabel}</Fact>}
      <Fact label="Rewards" hint={card.reward.best ? `best: ${formatEarnRate(card.reward.best.value, card.reward.type)} at ${card.reward.best.store}` : card.reward.label}>{card.reward.short}</Fact>
      {card.annualFee !== null && <Fact label="Annual fee">{card.annualFee === 0 ? 'None' : `$${card.annualFee}`}</Fact>}
    </dl>
  );
}

function MissingSetup({ card }) {
  const missing = [!card.limit && 'credit limit', !card.dueDay && 'payment due day', !card.closeDay && 'statement close day'].filter(Boolean);
  if (!missing.length) return null;
  return <p className="cc-quiet">Add the {list(missing)} <Link className="cc-link" to="/settings" state={SETTINGS}>in Settings</Link> to see more here.</p>;
}

function Actions({ card, onPurchases }) {
  const { markPaid, undo, saving } = useMarkBillPaid();
  const key = card.dueDate && billKey(card.id, card.dueDate);
  return (
    <div className="cc-actions">
      {card.bill !== null && !card.billPaid && <button type="button" className="page-btn page-btn-primary" disabled={saving} onClick={() => markPaid(key)}><CircleCheck size={14} aria-hidden="true" /> Mark paid<span className="sr-only">: {card.name}, {money(card.bill)} due {card.dueLabel}</span></button>}
      {card.billPaid && <button type="button" className="page-btn page-btn-secondary" disabled={saving} onClick={() => undo(key)}>Not paid yet<span className="sr-only">: {card.name}</span></button>}
      {onPurchases && <button type="button" className="page-btn page-btn-secondary" onClick={onPurchases}><ListOrdered size={14} aria-hidden="true" /> Purchases</button>}
      <Link to="/settings" state={SETTINGS} className="page-btn page-btn-secondary"><Pencil size={14} aria-hidden="true" /> Edit card</Link>
    </div>
  );
}

/** Everything about the chosen card. `bare` leaves out the panel and title. */
export default function CardDetails({ card, bare = false, monthLabel, onPurchases }) {
  const { play } = useCardPage();
  const titleId = `card-title-${card.id}`;
  return (
    <section className={bare ? 'cc-details bare' : 'cc-details cc-panel'} aria-labelledby={bare ? undefined : titleId} aria-label={bare ? `${card.name} details` : undefined}>
      {!bare && (
        <header className="cc-details-head">
          <div>
            <h2 id={titleId}>{card.name}</h2>
            <p>{subtitle(card)}</p>
          </div>
          <CardChip card={card} />
        </header>
      )}
      <div className="cc-hero">
        <span className="cc-hero-label">Net to pay · {monthLabel}</span>
        <span className="cc-hero-value">{play ? <CountUp value={money(card.netToPay)} /> : money(card.netToPay)}</span>
        {card.redeem > 0 && <span className="cc-hero-sub">after redeeming {money(card.redeem)} to cover losses</span>}
      </div>
      <div className="cc-swap" key={card.id}>
        <MonthFacts card={card} />
        <h3>Today</h3>
        <UtilBar card={card} label />
        <TodayFacts card={card} />
        <MissingSetup card={card} />
        <Actions card={card} onPurchases={onPurchases} />
      </div>
    </section>
  );
}
