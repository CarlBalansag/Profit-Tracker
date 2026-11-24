// Private receipts are opened from a fresh link, never the one the page has
// (it expires after a few minutes while the page stays open or cached).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshReceiptUrl, isExpiringReceiptLink, openReceiptInNewTab } from './receiptLink';

const SIGNED = 'https://api.cloudinary.com/v1_1/qa/image/download?public_id=x&format=png&type=authenticated&expires_at=1&signature=abc';
const FRESH = 'https://api.cloudinary.com/v1_1/qa/image/download?public_id=x&format=png&type=authenticated&expires_at=9999999999&signature=def';
const PUBLIC = 'https://res.cloudinary.com/qa/image/upload/old.png';
const ok = (body) => ({ ok: true, json: async () => body });

afterEach(() => vi.restoreAllMocks());

describe('receipt links', () => {
  it('tells an expiring signed link from a plain one', () => {
    expect(isExpiringReceiptLink(SIGNED)).toBe(true);
    expect(isExpiringReceiptLink(PUBLIC)).toBe(false);
    expect(isExpiringReceiptLink('data:application/pdf;base64,AAAA')).toBe(false);
    expect(isExpiringReceiptLink(null)).toBe(false);
    expect(isExpiringReceiptLink('not a url')).toBe(false);
  });

  it('fetches a fresh link for a private receipt and leaves public ones alone', async () => {
    const apiFetch = vi.fn(async () => ok({ receipt_url: FRESH, receipt_private: true }));
    expect(await freshReceiptUrl(apiFetch, 'expense', 'e 1', SIGNED)).toBe(FRESH);
    expect(apiFetch).toHaveBeenCalledWith('/api/receipts/link?itemType=expense&itemId=e%201');
    expect(await freshReceiptUrl(apiFetch, 'expense', 'e1', PUBLIC)).toBe(PUBLIC);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('says so when a fresh link is not available', async () => {
    await expect(freshReceiptUrl(async () => ({ ok: false, status: 404 }), 'expense', 'e1', SIGNED)).rejects.toThrow(/can't be opened/);
    await expect(freshReceiptUrl(async () => ok({ receipt_url: null }), 'expense', 'e1', SIGNED)).rejects.toThrow(/can't be opened/);
    await expect(freshReceiptUrl(async () => ({ ok: true, json: async () => { throw new Error('bad'); } }), 'expense', 'e1', SIGNED)).rejects.toThrow(/can't be opened/);
  });

  it('opens the tab during the click, then points it at the fresh link', async () => {
    const tab = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab);
    await openReceiptInNewTab(async () => ok({ receipt_url: FRESH }), 'inventory', 'i1', SIGNED);
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.location.replace).toHaveBeenCalledWith(FRESH);
    expect(tab.opener).toBeNull();
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('closes the empty tab when the link cannot be fetched, and opens public links directly', async () => {
    const tab = { location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab);
    await expect(openReceiptInNewTab(async () => ({ ok: false }), 'inventory', 'i1', SIGNED)).rejects.toThrow();
    expect(tab.close).toHaveBeenCalled();
    open.mockClear();
    await openReceiptInNewTab(vi.fn(), 'inventory', 'i1', PUBLIC);
    expect(open).toHaveBeenCalledWith(PUBLIC, '_blank', 'noopener,noreferrer');
  });
});
