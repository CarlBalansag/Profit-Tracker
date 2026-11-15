// Fake data and the math behind the landing page demo.
//
// Everything lives in memory and resets on reload. Money is kept in whole
// cents so totals never drift by a fraction of a cent. Dates are built
// relative to today so the demo always looks current.

export const PLATFORMS = [
  { id: 'eBay', fee: 0.1325 },
  { id: 'StockX', fee: 0.12 },
  { id: 'GOAT', fee: 0.095 },
  { id: 'Mercari', fee: 0.10 },
  { id: 'Facebook', fee: 0 },
];

export const CARDS = [
  { id: 'flex', name: 'Freedom Flex', last4: '4417', rate: 0.05, limit: 800000 },
  { id: 'blue', name: 'Blue Cash Preferred', last4: '1009', rate: 0.03, limit: 1200000 },
  { id: 'venture', name: 'Venture X', last4: '8823', rate: 0.02, limit: 1500000 },
];

export const MAX_CENTS = 10_000_000; // $100,000: plenty for one demo item

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysAgo(n, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() - n);
  return toISODate(d);
}

export function platformFee(platformId, priceCents) {
  const p = PLATFORMS.find((x) => x.id === platformId);
  return p ? Math.round(priceCents * p.fee) : 0;
}

// Parses a dollar amount typed by a visitor ("42", "42.5", "$1,200.99").
// Returns cents, or null when it isn't a usable positive amount.
export function parseDollars(value) {
  if (value == null) return null;
  const s = String(value).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

export function formatMoney(cents, { sign = false, whole = false } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(cents) / 100;
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  if (neg) return `-$${body}`;
  return `${sign && cents > 0 ? '+' : ''}$${body}`;
}

// ─── Seed ──────────────────────────────────────────────────────────────────

// [name, category, cost $, card, store, bought days ago, sale?]
// sale: [price $, platform, shipping $, sold days ago, paid]
const SEED = [
  ['Jordan 4 Retro "Bred"', 'Sneakers', 215, 'flex', 'Nike', 158, [338, 'StockX', 0, 141, true]],
  ['PS5 Slim Console', 'Electronics', 449.99, 'blue', 'Target', 150, [545, 'eBay', 18.5, 136, true]],
  ['LEGO Rivendell 10316', 'Toys', 399.99, 'venture', 'LEGO', 131, [520, 'eBay', 24, 112, true]],
  ['Nike Dunk Low "Panda"', 'Sneakers', 115, 'flex', 'Nike', 120, [168, 'GOAT', 0, 104, true]],
  ['Stanley Quencher 40oz (x6)', 'Home', 270, 'blue', 'Target', 98, [396, 'Mercari', 42, 83, true]],
  ['AirPods Pro 2', 'Electronics', 189.99, 'venture', 'Best Buy', 90, [229, 'eBay', 9, 71, true]],
  ['Pokémon 151 Booster Box', 'Collectibles', 264, 'flex', 'Pokémon Center', 76, [372, 'eBay', 16, 52, true]],
  ['Yeezy Slide "Onyx"', 'Sneakers', 70, 'flex', 'Adidas', 60, [131, 'StockX', 0, 41, true]],
  ['Switch OLED Zelda Ed.', 'Electronics', 359.99, 'blue', 'Walmart', 44, [455, 'Facebook', 0, 27, true]],
  ['New Balance 990v6', 'Sneakers', 199.99, 'venture', 'New Balance', 33, [262, 'GOAT', 0, 12, true]],
  ['Dyson Airwrap (open box)', 'Home', 329, 'blue', 'Costco', 24, [449, 'eBay', 21, 5, false]],
  ['Pokémon Prismatic ETB (x4)', 'Collectibles', 239.96, 'flex', 'Target', 15, [356, 'eBay', 14, 2, false]],
  ['Travis Scott Jordan 1 Low', 'Sneakers', 150, 'flex', 'SNKRS', 11, null],
  ['Steam Deck OLED 1TB', 'Electronics', 649, 'venture', 'Steam', 9, null],
  ['LEGO Titanic 10294', 'Toys', 679.99, 'blue', 'LEGO', 6, null],
  ['Owala FreeSip (x10)', 'Home', 279.9, 'flex', 'Target', 3, null],
];

const cents = (d) => Math.round(d * 100);

export function createSeed(today = new Date()) {
  const items = SEED.map(([name, category, cost, card, store, bought, sale], i) => ({
    id: `seed-${i + 1}`,
    name,
    category,
    cost: cents(cost),
    card,
    store,
    boughtOn: daysAgo(bought, today),
    sale: sale
      ? {
          price: cents(sale[0]),
          platform: sale[1],
          fees: platformFee(sale[1], cents(sale[0])),
          shipping: cents(sale[2]),
          soldOn: daysAgo(sale[3], today),
          paid: sale[4],
        }
      : null,
  }));
  return { items, nextId: items.length + 1 };
}

// ─── Reducer ───────────────────────────────────────────────────────────────

// Returns { state, error }. A rejected action leaves the state untouched.
export function applyAction(state, action) {
  switch (action.type) {
    case 'logSale': {
      const item = state.items.find((x) => x.id === action.itemId);
      if (!item) return { state, error: 'Pick an item from your inventory.' };
      if (item.sale) return { state, error: 'That item is already sold.' };
      const price = parseDollars(action.price);
      if (price == null) return { state, error: 'Enter a sale price above $0.' };
      if (!PLATFORMS.some((p) => p.id === action.platform)) return { state, error: 'Pick where it sold.' };
      const shipping = action.shipping === '' || action.shipping == null ? 0 : parseDollars(action.shipping);
      if (shipping == null) return { state, error: 'Shipping must be a dollar amount (or blank).' };
      if (shipping >= price) return { state, error: "Shipping can't be more than the sale price." };
      if (!action.date) return { state, error: 'Pick the sale date.' };
      if (action.date < item.boughtOn) return { state, error: "The sale date can't be before you bought it." };
      const sale = {
        price,
        platform: action.platform,
        fees: platformFee(action.platform, price),
        shipping,
        soldOn: action.date,
        paid: false,
      };
      return {
        state: { ...state, items: state.items.map((x) => (x.id === item.id ? { ...x, sale } : x)) },
        error: null,
        item: { ...item, sale },
      };
    }
    case 'logPurchase': {
      const name = String(action.name ?? '').trim();
      if (!name) return { state, error: 'Give the item a name.' };
      if (name.length > 60) return { state, error: 'Keep the name under 60 characters.' };
      const cost = parseDollars(action.cost);
      if (cost == null) return { state, error: 'Enter what you paid (above $0).' };
      if (!CARDS.some((c) => c.id === action.card)) return { state, error: 'Pick the card you paid with.' };
      if (!action.date) return { state, error: 'Pick the purchase date.' };
      const item = {
        id: `demo-${state.nextId}`,
        name,
        category: action.category || 'Other',
        cost,
        card: action.card,
        store: String(action.store ?? '').trim() || 'Retail',
        boughtOn: action.date,
        sale: null,
      };
      return { state: { items: [item, ...state.items], nextId: state.nextId + 1 }, error: null, item };
    }
    case 'markPaid': {
      const item = state.items.find((x) => x.id === action.itemId);
      if (!item?.sale || item.sale.paid) return { state, error: null };
      return {
        state: {
          ...state,
          items: state.items.map((x) => (x.id === item.id ? { ...x, sale: { ...x.sale, paid: true } } : x)),
        },
        error: null,
      };
    }
    case 'reset':
      return { state: createSeed(action.today), error: null };
    default:
      return { state, error: null };
  }
}

// ─── Derived numbers ───────────────────────────────────────────────────────

export const saleNet = (item) => (item.sale ? item.sale.price - item.sale.fees - item.sale.shipping : 0);
export const itemProfit = (item) => (item.sale ? saleNet(item) - item.cost : 0);
export const cardOf = (id) => CARDS.find((c) => c.id === id);
export const cashbackOf = (item) => Math.round(item.cost * (cardOf(item.card)?.rate ?? 0));

export function totals(items) {
  const sold = items.filter((x) => x.sale);
  const inStock = items.filter((x) => !x.sale);
  const revenue = sold.reduce((s, x) => s + x.sale.price, 0);
  const profit = sold.reduce((s, x) => s + itemProfit(x), 0);
  const soldCost = sold.reduce((s, x) => s + x.cost, 0);
  const cashback = items.reduce((s, x) => s + cashbackOf(x), 0);
  return {
    revenue,
    profit,
    cashback,
    roi: soldCost ? profit / soldCost : 0,
    margin: revenue ? profit / revenue : 0,
    unitsSold: sold.length,
    inStockCount: inStock.length,
    inventoryValue: inStock.reduce((s, x) => s + x.cost, 0),
  };
}

const monthKey = (iso) => iso.slice(0, 7);

export function lastMonths(count, today = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      label: d.toLocaleString('en-US', { month: 'short' }),
    });
  }
  return out;
}

export function monthlySeries(items, today = new Date(), count = 6) {
  return lastMonths(count, today).map((m) => {
    const sold = items.filter((x) => x.sale && monthKey(x.sale.soldOn) === m.key);
    const bought = items.filter((x) => monthKey(x.boughtOn) === m.key);
    const paidIn = items.filter((x) => x.sale?.paid && monthKey(x.sale.soldOn) === m.key);
    return {
      ...m,
      revenue: sold.reduce((s, x) => s + x.sale.price, 0),
      profit: sold.reduce((s, x) => s + itemProfit(x), 0),
      moneyOut: bought.reduce((s, x) => s + x.cost, 0),
      moneyIn: paidIn.reduce((s, x) => s + saleNet(x), 0),
    };
  });
}

export function byPlatform(items) {
  return PLATFORMS.map((p) => {
    const sold = items.filter((x) => x.sale?.platform === p.id);
    return {
      id: p.id,
      count: sold.length,
      revenue: sold.reduce((s, x) => s + x.sale.price, 0),
      profit: sold.reduce((s, x) => s + itemProfit(x), 0),
    };
  })
    .filter((p) => p.count > 0)
    .sort((a, b) => b.profit - a.profit);
}

export function cardSummary(items, today = new Date()) {
  const thisMonth = monthKey(toISODate(today));
  return CARDS.map((c) => {
    const mine = items.filter((x) => x.card === c.id);
    const monthSpend = mine.filter((x) => monthKey(x.boughtOn) === thisMonth).reduce((s, x) => s + x.cost, 0);
    return {
      ...c,
      purchases: mine.length,
      totalSpend: mine.reduce((s, x) => s + x.cost, 0),
      monthSpend,
      cashback: mine.reduce((s, x) => s + cashbackOf(x), 0),
      utilization: Math.min(monthSpend / c.limit, 1),
    };
  });
}

export function cashFlow(items) {
  const moneyOut = items.reduce((s, x) => s + x.cost, 0);
  const paid = items.filter((x) => x.sale?.paid);
  const pending = items.filter((x) => x.sale && !x.sale.paid);
  const moneyIn = paid.reduce((s, x) => s + saleNet(x), 0);
  return {
    moneyOut,
    moneyIn,
    pendingTotal: pending.reduce((s, x) => s + saleNet(x), 0),
    pending,
    tiedUp: items.filter((x) => !x.sale).reduce((s, x) => s + x.cost, 0),
    net: moneyIn - moneyOut,
  };
}

// Purchases and sales grouped by day: { 'YYYY-MM-DD': [{ kind, item }] }
export function calendarEvents(items) {
  const map = {};
  const add = (date, ev) => { (map[date] ??= []).push(ev); };
  items.forEach((item) => {
    add(item.boughtOn, { kind: 'bought', item });
    if (item.sale) add(item.sale.soldOn, { kind: 'sold', item });
  });
  return map;
}
