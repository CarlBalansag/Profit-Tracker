// E2: reading order details out of store emails, against synthetic fixtures.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { FIXTURES, mime } from './fixtures/emails.mjs';

const require = createRequire(import.meta.url);
const { parseSource, extractEmail, parserVersion } = require('../services/email/extract/index.js');
const generic = require('../services/email/extract/generic.js');

const read = async (f) => extractEmail({ merchant: f.merchant, ...(await parseSource(f.raw)) });

describe('store emails', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const r = await read(fixture);
      const { parserIncludes, ...fields } = fixture.expect;
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'items') {
          expect(r.items, 'items').toEqual(value.map((v) => expect.objectContaining(v)));
        } else {
          expect(r[key], key).toEqual(value);
        }
      }
      if (parserIncludes) expect(r.parser).toContain(parserIncludes);
      expect(r.parser_version).toBe(parserVersion(fixture.merchant));
    });
  }
});

describe('confidence', () => {
  it('trusts structured data most, then store templates, then plain text', async () => {
    const target = await read(FIXTURES.targetSchemaOrg);
    expect(target.confidence.order_number).toBeGreaterThan(0.9);
    const amazon = await read(FIXTURES.amazonOrder);
    expect(amazon.confidence.order_number).toBe(0.85);
    expect(amazon.confidence.total).toBe(0.6);
  });
  it('marks a total that does not add up as one to check', () => {
    const r = extractEmail({ merchant: 'walmart', subject: 'Thanks for your order', text: 'Order number: 2000123-45678901\nSubtotal $10.00\nTax $1.00\nTotal $50.00' });
    expect(r.total).toBe('50.00');
    expect(r.confidence.total).toBe(0.4);
  });
});

describe('stores that put the item name on its own line', () => {
  it("reads Lowe's items: the name above Item #, the unit price and the quantity", () => {
    const text = ['Order Details', 'SHIPPING', '1-1/2-in Carbide-tipped Straight Router Bit', 'Item #: 76740 |Model #: 85680MC', 'Unit Price $45.98 | Subtotal $91.96', 'QTY', '2',
      'Mainstays Hose Nozzle', 'Item #: 1234 |Model #: HN-1', 'Unit Price $9.98 | Subtotal $9.98', 'QTY', '1', 'Order Total $101.94'].join('\n');
    const r = extractEmail({ merchant: 'lowes', subject: 'Thanks for your order', text: `Order # 300906290260518059\n${text}` });
    expect(r.items).toEqual([
      { name: '1-1/2-in Carbide-tipped Straight Router Bit', quantity: 2, unit_price: 45.98, total: '91.96' },
      { name: 'Mainstays Hose Nozzle', quantity: 1, unit_price: 9.98, total: '9.98' },
    ]);
  });
  it('reads GameStop items between View order details and Order summary, once each', () => {
    const text = ['Order Number: 1101000080429674', 'VIEW ORDER DETAILS', 'GameStop Pro', 'GameStop Pro', 'ORDER SUMMARY', 'Subtotal', '$25.00', 'Estimated Tax', '$2.19', 'Estimated Total', '$27.19'].join('\n');
    const r = extractEmail({ merchant: 'gamestop', subject: 'Thank you for your order!', text });
    expect(r.items).toEqual([{ name: 'GameStop Pro', quantity: 1, total: null }]);
    expect(r.order_number).toBe('1101000080429674');
  });
  it('reads GameStop pickup items from the line above QTY, never the pickup block (store, address, who picks up)', () => {
    const text = ['VIEW ORDER DETAILS', 'STORE PICK-UP', 'PRE ORDER', 'Pick-up at:', 'GameStop', '1689 Arden Way,', 'Sacramento, CA, 95815', 'Pick-up by: Pat Example',
      '2026 Topps Chrome Formula 1 Value Box', 'QTY: 2', '$34.99', 'ORDER SUMMARY'].join('\n');
    expect(extractEmail({ merchant: 'gamestop', subject: 'Thank you for your order!', text }).items).toEqual([{ name: '2026 Topps Chrome Formula 1 Value Box', quantity: 2, unit_price: 34.99, total: '69.98' }]);
    const noItems = ['VIEW ORDER DETAILS', 'STORE PICK-UP', 'Pick-up at:', 'GameStop', '10853 Olson Dr,', 'Rancho Cordova, CA, 95670', 'Pick-up by: Pat Example', 'ORDER SUMMARY'].join('\n');
    expect(extractEmail({ merchant: 'gamestop', subject: 'Thank you for your order!', text: noItems }).items || []).toEqual([]);
  });
});

describe('generic reader', () => {
  it('reads amounts on the same line or the next', () => {
    expect(generic.amounts('Order Total:\n$1,234.56\nSales tax $3.10')).toMatchObject({ total: '1234.56', tax: '3.10' });
    expect(generic.amounts('Subtotal $5.00\nTotal $5.00').total).toBe('5.00');
    expect(generic.amounts('Shipping: FREE').shipping).toBe('0.00');
  });
  it('ignores dates and short numbers as order numbers', () => {
    expect(generic.orderNumber('Order placed 03-02-2026')).toBe(null);
    expect(generic.orderNumber('Order # 12')).toBe(null);
    expect(generic.orderNumber('Order number: AB12345')).toBe('AB12345');
  });
  it('finds UPS and USPS tracking numbers once each', () => {
    expect(generic.trackingNumbers('1Z999AA10123456784 and again 1Z999AA10123456784; USPS 9400 1118 9922 3344 5566 77')).toEqual(['1Z999AA10123456784', '9400111899223344556677']);
  });
  it('reads "Total" without mistaking Total Fee, Total Tax or a count for it', () => {
    expect(generic.amounts('Total # of items purchased: 1\nTotal Fee $0.00\nTotal Tax $ 4.02\nTotal $ 50.00')).toMatchObject({ total: '50.00', tax: '4.02' });
  });
  it('spots sign-in codes and security notices', () => {
    for (const s of ['Your verification code is 555203', 'USPS.com Multifactor Authentication', 'fedex.com Security Preference Change Confirmed', 'Verify Your Email Address to Complete Setup', 'Your Recovery Email Has Been Updated', 'Your FedEx user ID is ready', 'Reset your password']) {
      expect(generic.looksPrivate(s), s).toBe(true);
    }
    for (const s of ['Thanks for your order', 'Your package is on its way', 'Your Lowe\'s Purchase Receipt']) expect(generic.looksPrivate(s), s).toBe(false);
  });
  it('never treats a card number as more than its last four', () => {
    expect(generic.paymentHint('Visa ending in 4242')).toBe('Visa 4242');
    expect(generic.paymentHint('Discover ending in 0000')).toBe('Discover 0000');
    expect(generic.paymentHint('no card here')).toBe(null);
  });
});

describe('stores in your email', () => {
  const { tally, baseDomain, sourceLabel } = require('../services/email/storeScan.js');
  const h = (fromAddress, subject, fromName = null) => ({ fromAddress, fromName, subject, date: new Date('2026-11-01') });
  it('counts order-like mail per store, apart from supported stores, people, ads and codes', () => {
    const r = tally([
      h('orders@mail.target-like.co.uk', 'Your order has shipped', 'Target Like'),
      h('noreply@target-like.co.uk', 'Receipt for your purchase', 'Target Like'),
      h('deals@target-like.co.uk', '20% off deals today'),
      h('auto-confirm@amazon.com', 'Your Amazon.com order'),
      h('friend@gmail.com', 'Re: your order'),
      h('help@shop.com', 'Your verification code'),
      h('store+topps@shopifyemail.com', 'Order #1001 confirmed', 'Topps'),
      h('store+topps@shopifyemail.com', 'Your order is on the way', 'Topps'),
      h('store+other@shopifyemail.com', 'Order #9 confirmed', 'Other Shop'),
      h('store+other@shopifyemail.com', 'Your receipt', 'Other Shop'),
      h('billing@anthropic.com', 'Your receipt from Anthropic'),
      h('billing@anthropic.com', 'Your receipt from Anthropic'),
    ], { trusted: new Set(['anthropic.com']) });
    expect(r.supported).toEqual([{ key: 'amazon', label: 'Amazon', order_emails: 1 }]);
    expect(r.candidates.map((c) => [c.domain, c.label, c.order_emails])).toEqual([
      ['target-like.co.uk', 'Target Like', 2], ['shopify:topps', 'Topps', 2], ['shopify:other-shop', 'Other Shop', 2],
    ]);
    expect(sourceLabel('shopify:topps')).toBe('Shopify store');
    expect(baseDomain('a@b.mail.example.com')).toBe('example.com');
  });
});

describe('cash-out receipts', () => {
  const { readCashoutReceipt } = require('../services/email/extract/cashoutReceipt.js');
  it('reads each item with its UPC, tracking and serials, and skips the customer block', () => {
    const r = readCashoutReceipt([
      'CUSTOMER ID: 9146', 'Sample Name', '1 Example St', 'TITLE  UPC  QTY  PRICE  COMMISION  TOTAL',
      '1  ACME-WIDGET [W-1]  3  $1,154.99  $6.01  $3,483.00', '887276843711', '2  UPS TRACKING #: 1Z999AA10123456784', '3  SERIALS: AB12; CD34, EF56',
      '4  OTHER ITEM  012345678905  1  $10.00  $0.00  $10.00', 'TOTAL  4  $6.01  $3,493.00', 'Created: 1/5/2026 07:52pm',
    ].join('\n'));
    expect(r).toEqual({
      items: [
        { name: 'ACME-WIDGET [W-1]', upc: '887276843711', quantity: 3, unit_price: '1154.99', commission: '6.01', unit_payout: '1161.00', total: '3483.00', tracking: '1Z999AA10123456784', serials: ['AB12', 'CD34', 'EF56'] },
        { name: 'OTHER ITEM', upc: '012345678905', quantity: 1, unit_price: '10.00', commission: '0.00', unit_payout: '10.00', total: '10.00', tracking: null, serials: [] },
      ],
      total: '3493.00', tracking_numbers: ['1Z999AA10123456784'], receipt_date: '2026-01-05',
    });
    expect(JSON.stringify(r)).not.toMatch(/Sample Name|Example St|9146/);
    expect(readCashoutReceipt('Thank you for your business.')).toBe(null);
  });
  it('reads a check notice and finds the sales it pays out', () => {
    const r = extractEmail({ merchant: 'points4days', subject: 'POINTS4DAYS has a check waiting for you for $1,478.25!', text: 'Please login and click on "MOBILE CHECKS" on the menu to view check number 1185.' });
    expect([r.status, r.kind, r.order_number, r.total]).toEqual(['extracted', 'check', 'CHECK 1185', '1478.25']);
    const { salesForAmount } = require('../services/email/automations.js');
    const s = (id, paid) => ({ id, paid_amount: paid });
    expect(salesForAmount([s('a', 10), s('b', 20.5)], 3050).map((x) => x.id)).toEqual(['a', 'b']);
    expect(salesForAmount([s('a', 10), s('b', 20.5), s('c', 5), s('d', 15.5)], 2050).map((x) => x.id)).toEqual(['b']);
    expect(salesForAmount([s('a', 10), s('b', 5), s('c', 15.5)], 2550).map((x) => x.id)).toEqual(['a', 'c']);
    expect(salesForAmount([s('a', 10)], 999)).toBe(null);
  });
  it('pairs each line with the sale it pays for, not a sale on another marketplace', () => {
    const { pairCashoutLines } = require('../services/email/match.js');
    const order = { merchant: 'points4days', first_seen: new Date('2026-11-20'), items: [{ name: 'SAMSUNG 990 EVO 1TB', quantity: 3, unit_payout: '161.00', total: '483.00' }] };
    const sale = (id, platform, price, quantity = 3) => ({ id, quantity, unit_price: price, sale_date: new Date('2026-11-18'), platform: { name: platform }, inventory: { product_name: 'Samsung SSD 990 EVO Plus 1TB' } });
    const { pairs } = pairCashoutLines(order, [sale('ebay', 'eBay', 161), sale('p4d', 'POINTS4DAYS', 161), sale('cheap', 'POINTS4DAYS', 120)]);
    expect(pairs.map((p) => [p.sale.id, p.score])).toEqual([['p4d', 80]]);
  });
});

describe('store layouts found in real inboxes (synthetic copies)', () => {
  it('names an item past its store IDs, prices and gift lines (Home Depot, Best Buy)', () => {
    expect(generic.items(['Starlink Mini Kit', 'Store SKU #1012317132', 'Internet #331732584', '1 x $249.00 $249.00'].join('\n')))
      .toEqual([{ name: 'Starlink Mini Kit', quantity: 1, total: '249.00' }]);
    expect(generic.items([
      'Logitech - PRO X2 Wireless Gaming Mouse', '$179.99', 'Model #: 910-007700', 'Qty: 1', '----------------------------------------',
      'Gift with Purchase', 'Discord- 1-Month of Discord Nitro free', 'FREE', 'Digital delivery or service details sending to:', 'buyer@example.test', 'Qty: 1',
    ].join('\n'))).toEqual([
      { name: 'Logitech - PRO X2 Wireless Gaming Mouse', quantity: 1, total: '179.99' },
      { name: 'Discord- 1-Month of Discord Nitro free', quantity: 1, total: '0.00' },
    ]);
  });
  it('skips option, fee and spaced model lines above a price (Apple, Best Buy)', () => {
    expect(generic.items(['iPhone 18 Pro 256GB Burgundy', 'CA CBE Recycle Fee', '($15.00)', '$1,199.00', 'Qty 1'].join(String.fromCharCode(10)))).toEqual([{ name: 'iPhone 18 Pro 256GB Burgundy', quantity: 1, total: '1199.00' }]);
    expect(generic.items(['iPhone Duo 256GB Night Sky', 'Carrier: Connect on your own later', '$1,999.00', 'Qty 1'].join(String.fromCharCode(10)))).toEqual([{ name: 'iPhone Duo 256GB Night Sky', quantity: 1, total: '1999.00' }]);
    expect(generic.items(['HiBoy - MAX Pro Electric Scooter', '$0.01', 'Model #: MAX Pro-BLACK', 'Qty: 1'].join(String.fromCharCode(10)))).toEqual([{ name: 'HiBoy - MAX Pro Electric Scooter', quantity: 1, total: '0.01' }]);
  });
  it('reads Amazon categories and the ship-to city and state, never the name', () => {
    const r = extractEmail({ merchant: 'amazon', subject: 'Ordered 5 items: Supplements, Skin Care, and more', text: ['Arriving Sunday', '4 items: 1 Supplements, 1 Crafts, and 2 others', 'Sam - SACRAMENTO, CA', 'Order # 113-3449308-9990666', 'Grand Total: $10.82'].join('\n') });
    expect([r.kind, r.order_number, r.total, r.ship_to]).toEqual(['order', '113-3449308-9990666', '10.82', 'SACRAMENTO, CA']);
    expect(r.items).toEqual([{ name: 'Supplements', quantity: 1, category: true }, { name: 'Crafts', quantity: 1, category: true }, { name: 'Other items', quantity: 2, category: true }]);
    expect(JSON.stringify(r)).not.toContain('Sam');
    const p4d = extractEmail({ merchant: 'amazon', subject: 'Ordered: 1 Jewelry item', text: '1 Jewelry item\nP4D - MIDDLETOWN, DE\nOrder # 113-0633337-3945812\nGrand Total: $30.00' });
    expect([p4d.ship_to, p4d.items]).toEqual(['MIDDLETOWN, DE', [{ name: 'Jewelry', quantity: 1, category: true }]]);
  });
  it('does not put the order total on the only item a store lists when the email says there are more (Walmart)', () => {
    const html = '<script type="application/ld+json">{"@context":"http://schema.org","@type":"Order","orderNumber":"200014355865102","orderStatus":"OrderPickupAvailable","price":"$113.73","acceptedOffer":{"@type":"Offer","price":"$113.73","eligibleQuantity":{"value":"1"},"itemOffered":{"@type":"Product","name":"Mainstays Ice Tray Set"}}}</script>';
    const r = extractEmail({ merchant: 'walmart', subject: 'Picked up at 6:04pm: Mainstays 2pack Silico... +1 item', html, text: '2 ITEMS PICKED UP' });
    expect(r.total).toBe('113.73');
    expect(r.items).toEqual([{ name: 'Mainstays Ice Tray Set', quantity: 1, unit_price: null, total: null }, { name: '1 more item', quantity: 1, more: true }]);
  });
  it('keeps a refund in brackets as a positive amount (Apple)', () => {
    const r = extractEmail({ merchant: 'apple', subject: 'We received your items.', text: 'Order W1429583066\nSubtotal\n($1,314.00)\nTotal\n($1,427.66)' });
    expect([r.total, r.subtotal]).toEqual(['1427.66', '1314.00']);
  });
});

describe('sorting orders with no matching purchase', () => {
  const { sortOrder } = require('../services/email/sorting.js');
  const order = (over) => ({ merchant: 'amazon', ship_to: null, items: [], ...over });
  const opts = { homeState: 'CA', personalWords: ['purina'], pastNames: ['Apple Watch Series 11 GPS 42mm'] };
  it('sorts by the rules, in order', () => {
    expect(sortOrder(order({ ship_to: 'MIDDLETOWN, DE', items: [{ name: 'Jewelry', category: true }] }), opts)).toEqual({ leaning: 'resale', reason: 'Ships to MIDDLETOWN, DE' });
    expect(sortOrder(order({ ship_to: 'SACRAMENTO, CA', items: [{ name: 'Apple Watch Series 11 [GPS 42mm]', quantity: 1 }] }), opts)).toEqual({ leaning: 'resale', reason: "You've bought this before" });
    expect(sortOrder(order({ ship_to: 'MIDDLETOWN, DE', items: [{ name: 'Echo Show 8', quantity: 2 }] }), { ...opts, homeState: null })).toEqual({ leaning: 'resale', reason: '2 of the same item' });
    expect(sortOrder(order({ ship_to: 'SACRAMENTO, CA', items: [{ name: 'Vitamins', quantity: 2 }] }), opts)).toEqual({ leaning: 'ask', reason: '2 of the same item, shipped to SACRAMENTO, CA' });
    expect(sortOrder(order({ ship_to: 'SACRAMENTO, CA', items: [{ name: 'Pet Supplies', category: true }] }), opts)).toEqual({ leaning: 'personal', reason: 'Ships to SACRAMENTO, CA' });
    expect(sortOrder(order({ ship_to: 'MIDDLETOWN, DE', items: [{ name: 'Purina Tidy Cats', quantity: 1 }] }), opts)).toEqual({ leaning: 'personal', reason: 'Has "purina"' });
  });
  it('asks when nothing decides it: other stores, no home state, no ship-to', () => {
    expect(sortOrder(order({ merchant: 'bestbuy', ship_to: 'SACRAMENTO, CA', items: [{ name: 'Mouse', quantity: 1 }] }), opts).leaning).toBe('ask');
    expect(sortOrder(order({ ship_to: 'MIDDLETOWN, DE' }), { ...opts, homeState: null }).leaning).toBe('ask');
    expect(sortOrder(order({ items: [{ name: 'Lamp', quantity: 1 }] }), opts).leaning).toBe('ask');
  });
});

describe('robustness', () => {
  it('handles a plain-text email, bad JSON-LD and a huge body', async () => {
    const plain = await read({ merchant: 'walmart', raw: mime({ from: 'help@walmart.com', subject: 'Your order has shipped', text: 'Order number: 2000123-45678901\nTracking number: 1Z999AA10123456784' }) });
    expect(plain).toMatchObject({ kind: 'shipped', order_number: '2000123-45678901', tracking_numbers: ['1Z999AA10123456784'] });
    const bad = await read({ merchant: 'target', raw: mime({ from: 'x@target.com', subject: 'Thanks for your order', html: '<script type="application/ld+json">{not json</script><p>Order # 912000000001</p>' }) });
    expect(bad.order_number).toBe('912000000001');
    const huge = await read({ merchant: 'amazon', raw: mime({ from: 'a@amazon.com', subject: 'Ordered: "Thing"', html: `<p>Order #112-1111111-2222222</p>${'<p>filler</p>'.repeat(80000)}` }) });
    expect(huge.order_number).toBe('112-1111111-2222222');
  });
});
