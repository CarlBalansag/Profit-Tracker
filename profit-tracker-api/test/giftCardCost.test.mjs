// "What the gift card cost you" on a purchase: stored only alongside a gift
// card amount, clearable on edit, and validated like other money fields.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');

let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => harness.reset());
afterAll(() => server.close());

const send = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const stored = (id = harness.ids.inventory) => harness.db.inventory.find((row) => row.id === id);
const asNumber = (value) => (value === null || value === undefined ? value : Number(value));
const purchase = (over) => ({ product_name: 'QA Gift Card Buy', vendor_id: harness.ids.vendor, unit_purchase_cost: 100, qty_purchased: 1, ...over });

describe('gift card cost on purchases', () => {
  it('saves the cost with a gift card amount on create', async () => {
    const res = await send('POST', '/api/inventory', purchase({ gift_card_amount: 60, gift_card_cost: '54.00' }));
    expect(res.status).toBe(200);
    expect(asNumber(stored(res.body.id).gift_card_cost)).toBe(54);
  });

  it('leaves it empty when nothing is entered, or when no gift card was used', async () => {
    const blank = await send('POST', '/api/inventory', purchase({ gift_card_amount: 60, gift_card_cost: '' }));
    expect(stored(blank.body.id).gift_card_cost).toBeNull();
    const noCard = await send('POST', '/api/inventory', purchase({ gift_card_amount: 0, gift_card_cost: 20 }));
    expect(stored(noCard.body.id).gift_card_cost).toBeNull();
  });

  it('rejects negative and over-precise amounts without saving', async () => {
    const before = harness.db.inventory.length;
    expect((await send('POST', '/api/inventory', purchase({ gift_card_amount: 60, gift_card_cost: -1 }))).status).toBe(400);
    expect((await send('POST', '/api/inventory', purchase({ gift_card_amount: 60, gift_card_cost: '1.005' }))).status).toBe(400);
    expect(harness.db.inventory.length).toBe(before);
    expect((await send('PUT', `/api/inventory/${harness.ids.inventory}`, { gift_card_cost: 'abc' })).status).toBe(400);
  });

  it('sets, keeps and clears it on edit', async () => {
    expect((await send('PUT', `/api/inventory/${harness.ids.inventory}`, { gift_card_cost: 45 })).status).toBe(200);
    expect(asNumber(stored().gift_card_cost)).toBe(45);
    // An edit that leaves it out keeps it.
    await send('PUT', `/api/inventory/${harness.ids.inventory}`, { tracking_number: 'QA-keep' });
    expect(asNumber(stored().gift_card_cost)).toBe(45);
    // Blanking the field clears it.
    await send('PUT', `/api/inventory/${harness.ids.inventory}`, { gift_card_cost: '' });
    expect(stored().gift_card_cost).toBeNull();
  });

  it('clears it when the gift card amount is set to zero', async () => {
    await send('PUT', `/api/inventory/${harness.ids.inventory}`, { gift_card_cost: 45 });
    await send('PUT', `/api/inventory/${harness.ids.inventory}`, { gift_card_amount: 0 });
    expect(stored().gift_card_cost).toBeNull();
  });

  it('saves through the purchase editor (atomic save) too', async () => {
    const save = (inventory) => send('PUT', `/api/inventory/${harness.ids.inventory}/transaction`, { inventory, sales: [] });
    expect((await save({ gift_card_amount: 50, gift_card_cost: 40 })).status).toBe(200);
    expect(asNumber(stored().gift_card_cost)).toBe(40);
    expect((await save({ gift_card_amount: 0, gift_card_cost: 40 })).status).toBe(200);
    expect(stored().gift_card_cost).toBeNull();
  });

  it('does not let another user change it', async () => {
    harness.db.inventory[0].user_id = 'someone-else';
    const res = await send('PUT', `/api/inventory/${harness.ids.inventory}`, { gift_card_cost: 1 });
    expect(res.status).toBe(404);
    expect(harness.db.inventory[0].gift_card_cost).toBeUndefined();
  });
});
