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
