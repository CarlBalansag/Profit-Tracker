import { describe, expect, it } from 'vitest';
import { detectCarrier, carrierTrackingUrl } from './carrier';

describe('detectCarrier', () => {
  const cases = [
    ['1Z999AA10123456784', 'UPS'],
    ['123456789012', 'FedEx'],
    // A 22-digit "94..." number matches both USPS's prefixed pattern and FedEx's
    // generic digit-count pattern — USPS must win. Regression test for a real
    // misclassification bug found while building the Shipping page.
    ['9400111899561234567890', 'USPS'],
    ['EA123456789US', 'USPS'],
    ['JD123456789012345678', 'DHL'],
    ['1234567890', 'DHL'],
    ['C00000000000014', 'OnTrac'],
    ['TBA123456789012', 'Amazon'],
    ['', null],
    [null, null],
  ];

  it.each(cases)('classifies %s as %s', (input, expected) => {
    expect(detectCarrier(input)?.label ?? null).toBe(expected);
  });

  it('falls back to a generic chip for an unrecognized format', () => {
    expect(detectCarrier('not-a-real-tracking-number')).toMatchObject({ label: 'Track' });
  });
});

describe('carrierTrackingUrl', () => {
  it('builds a carrier-specific tracking URL with the number encoded', () => {
    expect(carrierTrackingUrl('UPS', '1Z 999')).toBe('https://www.ups.com/track?tracknum=1Z%20999');
  });

  it('returns null for a carrier with no known public tracking URL', () => {
    expect(carrierTrackingUrl('Amazon', 'TBA123')).toBeNull();
  });

  it('returns null when carrier or tracking number is missing', () => {
    expect(carrierTrackingUrl(null, '123')).toBeNull();
    expect(carrierTrackingUrl('UPS', null)).toBeNull();
  });
});
