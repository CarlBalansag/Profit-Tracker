import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const servicePath = require.resolve('../services/calendarFeed');
const prismaPath = require.resolve('../prisma');
const cloudinaryPath = require.resolve('cloudinary');
const originalCloudName = process.env.CLOUDINARY_CLOUD_NAME;

function loadFeedService(purchaseOverrides = {}) {
  const upload = vi.fn().mockResolvedValue({ secure_url: 'https://example.test/calendar.ics' });
  require.cache[prismaPath] = {
    exports: {
      user: { findUnique: vi.fn().mockResolvedValue({ calendar_token: 'private-token' }) },
      calendarEvent: { findMany: vi.fn().mockResolvedValue([{ id: 'manual-1', date: '2026-09-12', title: 'Ship order', notes: 'Bring label' }]) },
      inventory: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'inventory-1', product_name: 'Sneaker', purchase_date: new Date('2026-09-10') }])
          .mockResolvedValueOnce([{ id: 'inventory-1', product_name: 'Sneaker', purchase_date: new Date('2026-09-10'), qty_purchased: 1, unit_purchase_cost: 100, sales_tax: 5, shipping_cost_inbound: 0, payment_method: { due_day: 15 }, ...purchaseOverrides }]),
      },
      sales: { findMany: vi.fn().mockResolvedValue([{ id: 'sale-1', sale_date: new Date('2026-09-11'), payout_date: null, inventory: { product_name: 'Sneaker' } }]) },
    },
  };
  require.cache[cloudinaryPath] = { exports: { v2: { config: vi.fn(), uploader: { upload } } } };
  process.env.CLOUDINARY_CLOUD_NAME = 'qa-cloud';
  delete require.cache[servicePath];
  return { service: require('../services/calendarFeed'), upload };
}

afterEach(() => {
  delete require.cache[servicePath];
  delete require.cache[prismaPath];
  delete require.cache[cloudinaryPath];
  process.env.CLOUDINARY_CLOUD_NAME = originalCloudName;
});

describe('Cloudinary calendar feed', () => {
  it('matches the exact purchase basis including fees and gift credit', async () => {
    const { service } = loadFeedService({ qty_purchased: 3, unit_purchase_cost: 0.1,
      unit_purchase_cost_decimal: '0.10', sales_tax: 0.2, fees: 0.05, gift_card_amount: 0.1 });
    expect(await service.buildCalendarFeed('user-1')).toContain('SUMMARY:CC Due: Sneaker ($0.45)');
  });
  it('publishes one stable raw ICS file with calendar data', async () => {
    const { service, upload } = loadFeedService();

    const feedUrl = await service.publishCalendarFeed('user-1');

    expect(feedUrl).toBe('https://res.cloudinary.com/qa-cloud/raw/upload/selvora/calendar-feeds/private-token.ics');
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0][1]).toMatchObject({ resource_type: 'raw', public_id: 'selvora/calendar-feeds/private-token.ics', overwrite: true, invalidate: true });
    const ics = Buffer.from(upload.mock.calls[0][0].split(',')[1], 'base64').toString('utf8');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Ship order');
    expect(ics).toContain('SUMMARY:Purchase: Sneaker');
    expect(ics).toContain('SUMMARY:Sale: Sneaker');
    expect(ics).toContain('SUMMARY:CC Due: Sneaker ($105.00)');
  });
});
