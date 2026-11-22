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
  it('never treats a card number as more than its last four', () => {
    expect(generic.paymentHint('Visa ending in 4242')).toBe('Visa 4242');
    expect(generic.paymentHint('Discover ending in 0000')).toBe('Discover 0000');
    expect(generic.paymentHint('no card here')).toBe(null);
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
