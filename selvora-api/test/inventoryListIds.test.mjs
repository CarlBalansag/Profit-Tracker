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

describe('inventory list relationship IDs', () => {
  it('returns IDs needed to preserve and filter row relationships', async () => {
    const response = await fetch(`${baseUrl}/api/inventory`);
    const [inventory] = await response.json();

    expect(response.status).toBe(200);
    expect(inventory).toMatchObject({
      vendor_id: harness.ids.vendor,
      payment_method_id: harness.ids.card,
      vendor: { id: harness.ids.vendor },
      payment_method: { id: harness.ids.card },
      sales: [{ platform_id: harness.ids.platform, platform: { id: harness.ids.platform } }],
    });
  });
});
