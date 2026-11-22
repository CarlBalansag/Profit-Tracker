// Store accounts (Settings > Data Setup > Accounts) for the purchase forms.
// GET /api/platforms returns each platform with its `accounts`, so the forms
// read them from the platform list they already load.

export function accountsForStore(platforms, storeId) {
  if (!storeId) return [];
  const store = (platforms || []).find(p => String(p.id) === String(storeId));
  return store?.accounts || [];
}

// "Main (jdoe)" / "Main (login@email.com)", plus a note when not Active.
export function accountLabel(account) {
  const login = account.username || account.email;
  const status = account.status && account.status !== 'Active' ? ` · ${account.status === 'Review' ? 'In Review' : account.status}` : '';
  return `${account.name}${login ? ` (${login})` : ''}${status}`;
}

// The account id to save: '' when it isn't one of this store's accounts (a
// stale draft, or the store changed), so the API never sees a mismatch.
export function validAccountId(platforms, storeId, accountId) {
  if (!accountId) return '';
  return accountsForStore(platforms, storeId).some(a => String(a.id) === String(accountId)) ? accountId : '';
}

// The store account(s) the purchases were bought on (Inventory.account).
// One name when every purchase shares it, "N accounts" when they differ,
// "Mixed" when one account plus purchases with none, and a quiet dash when
// none has one.
export function commitmentAccountSummary(rows) {
  const names = rows.map((r) => r.sale?.inventory?.account?.name || null);
  const distinct = [...new Set(names.filter(Boolean))];
  if (distinct.length === 0) return { label: null, title: null, mixed: false };
  const missing = names.some((n) => !n);
  if (distinct.length === 1 && !missing) return { label: distinct[0], title: distinct[0], mixed: false };
  const title = [...distinct, ...(missing ? ['No account'] : [])].join(', ');
  return { label: distinct.length === 1 ? 'Mixed' : `${distinct.length} accounts`, title, mixed: true };
}
