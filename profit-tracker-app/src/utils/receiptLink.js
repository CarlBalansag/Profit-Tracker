// Opening a receipt. A private receipt comes from the API as a signed link
// that stops working after a few minutes, while a page (and its cached data)
// can stay open far longer. So a private receipt is never opened from the link
// the page already has: a fresh one is fetched at the moment it is opened.
// Older public receipts (plain https links) open as they are.

// A signed, expiring Cloudinary download link (see the API's privateReceipts.js).
export function isExpiringReceiptLink(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'api.cloudinary.com' && parsed.searchParams.has('signature');
  } catch {
    return false;
  }
}

const CANT_OPEN = "This receipt can't be opened right now. Try again in a moment.";

// itemType: 'inventory' | 'expense'. Returns a link that works now.
export async function freshReceiptUrl(apiFetch, itemType, itemId, url) {
  if (!isExpiringReceiptLink(url)) return url;
  const response = await apiFetch(`/api/receipts/link?itemType=${encodeURIComponent(itemType)}&itemId=${encodeURIComponent(itemId)}`);
  if (!response.ok) throw new Error(CANT_OPEN);
  const body = await response.json().catch(() => null);
  if (!body?.receipt_url) throw new Error(CANT_OPEN);
  return body.receipt_url;
}

// Opens the receipt in a new tab. The tab is opened right away (inside the
// click) so popup blockers allow it, then pointed at the fresh link.
export async function openReceiptInNewTab(apiFetch, itemType, itemId, url) {
  if (!isExpiringReceiptLink(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const tab = window.open('', '_blank');
  try {
    const fresh = await freshReceiptUrl(apiFetch, itemType, itemId, url);
    if (tab) {
      tab.opener = null;
      tab.location.replace(fresh);
    } else {
      window.location.assign(fresh);
    }
  } catch (err) {
    tab?.close();
    throw err;
  }
}
