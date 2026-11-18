import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ebAdapter = require('../services/cashouts/eb');

const sampleFixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/eb-deals.json'), 'utf8'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ElectronicsBuyer deal link', () => {
  it('links every deal to the deals page on the EB dashboard', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => sampleFixture,
    });
    vi.stubGlobal('fetch', fetchMock);

    const deals = await ebAdapter.fetchDeals('test-key');

    expect(deals.length).toBe(sampleFixture.data.length);
    expect(deals.length).toBeGreaterThan(0);
    for (const deal of deals) expect(deal.dealUrl).toBe('https://electronicsbuyer.gg/app/deals');
    // The API is still read from the API host.
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/api\.electronicsbuyer\.gg\//);
  });
});
