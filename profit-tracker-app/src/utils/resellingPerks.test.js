import { describe, expect, it } from 'vitest';
import { isResellingPerk } from './cardRewards';

const perk = (title, description = '') => ({ title, description });

describe('isResellingPerk', () => {
  it('keeps inventory protection, employee cards and financing', () => {
    for (const title of ['Purchase Protection', 'Extended Warranty Protection', 'Return Protection', 'Price Protection', 'Free Employee Cards', '0% Intro APR for 12 months', 'Unlimited Cashback Match']) {
      expect(isResellingPerk(perk(title))).toBe(true);
    }
  });

  it('keeps statement credits for shipping, supplies and stores', () => {
    expect(isResellingPerk(perk('$240 Flexible Business Credit', 'Up to $20 a month at FedEx, Grubhub and office supply stores.'))).toBe(true);
    expect(isResellingPerk(perk('$155 Walmart+ Credit'))).toBe(true);
    expect(isResellingPerk(perk('$140 annual credit', 'Credit for Amazon Prime membership fees.'))).toBe(true);
  });

  it('hides travel, dining, phone and fraud perks', () => {
    for (const title of ['Trip Cancellation and Interruption Insurance', 'Auto Rental Coverage', 'Baggage Delay Insurance', 'Chase Sapphire Lounge access', 'DoorDash DashPass', 'Zero Liability Protection', '24/7 Fraud Monitoring', 'Cell Phone Protection', 'Travel and Emergency Assistance', '$300 dining credit']) {
      expect(isResellingPerk(perk(title))).toBe(false);
    }
  });

  it("doesn't keep a perk just because its description names a store", () => {
    expect(isResellingPerk(perk('Unlimited United Club access', 'Including at Target Field.'))).toBe(false);
    expect(isResellingPerk(perk('Instant Card Number', 'Shop at Amazon right away.'))).toBe(false);
    expect(isResellingPerk(perk('0% intro APR on balance transfers'))).toBe(false);
  });
});
