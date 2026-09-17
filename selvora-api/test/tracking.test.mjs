import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectCarrier, refreshTracking, checkTrackingRateLimit } = require('../services/tracking');

// Minimal fake of the one Prisma model checkTrackingRateLimit touches, so the
// bucket math can be tested without a real database.
function fakePrisma() {
  const rows = new Map();
  return {
    authAttemptBucket: {
      deleteMany: async ({ where }) => {
        for (const [key, row] of rows) if (row.expires_at < where.expires_at.lt) rows.delete(key);
      },
      upsert: async ({ where, create, update }) => {
        const existing = rows.get(where.key);
        if (!existing) { const row = { key: where.key, count: 1, expires_at: create.expires_at }; rows.set(where.key, row); return row; }
        existing.count += update.count.increment;
        return existing;
      },
    },
  };
}

describe('detectCarrier', () => {
  const cases = [
    ['1Z999AA10123456784', 'UPS'],
    ['123456789012', 'FedEx'],
    ['9400111899561234567890', 'USPS'],
    ['EA123456789US', 'USPS'],
    ['JD123456789012345678', 'DHL'],
    ['1234567890', 'DHL'],
    ['C00000000000014', 'OnTrac'],
    ['TBA123456789012', 'Amazon'],
    ['not-a-real-tracking-number', null],
    [null, null],
  ];

  it.each(cases)('classifies %s as %s', (input, expected) => {
    expect(detectCarrier(input)).toBe(expected);
  });
});

describe('refreshTracking', () => {
  it('returns not_configured when no carrier could be detected', async () => {
    const result = await refreshTracking('not-a-real-tracking-number', {});
    expect(result).toMatchObject({ carrier: null, trackable: false, reason: 'unrecognized' });
  });

  it('returns not_configured when the matched carrier has no API credentials set', async () => {
    const result = await refreshTracking('1Z999AA10123456784', {
      UPS: { isConfigured: () => false, trackByNumber: vi.fn() },
    });
    expect(result).toMatchObject({ carrier: 'UPS', trackable: false, reason: 'not_configured' });
  });

  it('falls back to restricted when USPS denies access to a third-party number', async () => {
    const result = await refreshTracking('9400111899561234567890', {
      USPS: {
        isConfigured: () => true,
        trackByNumber: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { restricted: true })),
      },
    });
    expect(result).toMatchObject({ carrier: 'USPS', trackable: false, reason: 'restricted' });
  });

  it('reports a generic error without throwing when a carrier call fails unexpectedly', async () => {
    const result = await refreshTracking('1Z999AA10123456784', {
      UPS: { isConfigured: () => true, trackByNumber: vi.fn().mockRejectedValue(new Error('network down')) },
    });
    expect(result).toMatchObject({ carrier: 'UPS', trackable: false, reason: 'error' });
  });

  it('normalizes a successful carrier response', async () => {
    const result = await refreshTracking('1Z999AA10123456784', {
      UPS: {
        isConfigured: () => true,
        trackByNumber: vi.fn().mockResolvedValue({
          status: 'Delivered',
          events: [{ date: '2026-09-01T00:00:00.000Z', description: 'Delivered', location: 'Austin, TX' }],
          deliveredAt: '2026-09-01T00:00:00.000Z',
        }),
      },
    });
    expect(result).toMatchObject({ carrier: 'UPS', trackable: true, status: 'Delivered' });
    expect(result.events).toHaveLength(1);
  });
});

describe('checkTrackingRateLimit', () => {
  it('allows up to 10 checks per user within the hour and blocks the 11th', async () => {
    const prisma = fakePrisma();
    for (let i = 1; i <= 10; i++) {
      const result = await checkTrackingRateLimit(prisma, 'user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10 - i);
    }
    const eleventh = await checkTrackingRateLimit(prisma, 'user-1');
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks separate users independently', async () => {
    const prisma = fakePrisma();
    for (let i = 0; i < 10; i++) await checkTrackingRateLimit(prisma, 'user-1');
    const otherUser = await checkTrackingRateLimit(prisma, 'user-2');
    expect(otherUser.allowed).toBe(true);
    expect(otherUser.remaining).toBe(9);
  });
});
