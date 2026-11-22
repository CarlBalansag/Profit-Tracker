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
  it('pairs each line with the sale it pays for, not a sale on another marketplace', () => {
    const { pairCashoutLines } = require('../services/email/match.js');
    const order = { merchant: 'points4days', first_seen: new Date('2026-11-20'), items: [{ name: 'SAMSUNG 990 EVO 1TB', quantity: 3, unit_payout: '161.00', total: '483.00' }] };
    const sale = (id, platform, price, quantity = 3) => ({ id, quantity, unit_price: price, sale_date: new Date('2026-11-18'), platform: { name: platform }, inventory: { product_name: 'Samsung SSD 990 EVO Plus 1TB' } });
    const { pairs } = pairCashoutLines(order, [sale('ebay', 'eBay', 161), sale('p4d', 'POINTS4DAYS', 161), sale('cheap', 'POINTS4DAYS', 120)]);
    expect(pairs.map((p) => [p.sale.id, p.score])).toEqual([['p4d', 80]]);
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
