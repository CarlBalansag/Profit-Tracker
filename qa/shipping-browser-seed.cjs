// One-off seed script for manually verifying the Shipping page in a real browser.
// Creates a verified Firebase-emulator user, registers it against the running
// API (Neon "shipping" branch), and adds sample inventory/sales rows covering
// all four Shipping-page quadrants (inbound/outbound x tracked/untracked).
const { createRequire } = require('node:module');
const requireApi = createRequire(require('path').join(__dirname, '../selvora-api/package.json'));
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const { initializeApp } = requireApi('firebase-admin/app');
const { getAuth } = requireApi('firebase-admin/auth');

const auth = getAuth(initializeApp({ projectId: 'demo-profittracker' }, 'seed-emulator-only'));
const api = 'http://localhost:3000';
const emulator = 'http://127.0.0.1:9099';
const frontendOrigin = 'http://localhost:5173';
const email = 'shipping-browser-qa@example.test';
const password = 'isolated shipping browser qa password';

async function rest(path, body) {
  const response = await fetch(`${emulator}/identitytoolkit.googleapis.com/v1/${path}?key=demo-test-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (response.status !== 200) throw new Error(result.error?.message || 'emulator REST call failed');
  return result;
}

async function request(path, body, cookie) {
  const response = await fetch(api + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: frontendOrigin, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  const set = response.headers.getSetCookie();
  const nextCookie = set.map(v => v.split(';')[0]).join('; ') || cookie;
  return { status: response.status, data, cookie: nextCookie };
}

async function run() {
  let user;
  try { user = await auth.getUserByEmail(email); } catch { user = await auth.createUser({ email, password, emailVerified: true }); }
  await auth.updateUser(user.uid, { emailVerified: true });

  const signedIn = await rest('accounts:signInWithPassword', { email, password, returnSecureToken: true });

  const grant = await request('/auth/firebase/intent', { purpose: 'signup' });
  if (grant.status !== 200) throw new Error('intent failed: ' + JSON.stringify(grant.data));
  const session = await request('/auth/firebase/session', { ...grant.data, id_token: signedIn.idToken }, grant.cookie);
  if (session.status !== 200) throw new Error('session exchange failed: ' + JSON.stringify(session.data));
  const cookie = session.cookie;
  console.log('Logged in as', session.data.email, '(user id', session.data.id + ')');

  // Vendor + marketplace platforms are required FKs for inventory/sales.
  const vendor = await request('/api/platforms', { name: 'Seed Vendor', type: 'Vendor' }, cookie);
  const marketplace = await request('/api/platforms', { name: 'Seed Marketplace', type: 'Marketplace' }, cookie);

  // Inbound #1 — has a tracking number (UPS format) -> should land in "Tracked".
  const inv1 = await request('/api/inventory', {
    product_name: 'Seed Item — Tracked Inbound', vendor_id: vendor.data.id,
    purchase_date: '2026-09-01', unit_purchase_cost: 50, qty_purchased: 1,
    tracking_number: '1Z999AA10123456784',
  }, cookie);

  // Inbound #2 — no tracking number -> should land in "Needs Tracking #".
  const inv2 = await request('/api/inventory', {
    product_name: 'Seed Item — Untracked Inbound', vendor_id: vendor.data.id,
    purchase_date: '2026-09-05', unit_purchase_cost: 30, qty_purchased: 1,
  }, cookie);

  // Outbound #1 — inv1 resold with its own outbound tracking number (FedEx format).
  const sale1 = await request('/api/sales', {
    inventory_id: inv1.data.id, platform_id: marketplace.data.id,
    quantity: 1, unit_price: 90, sale_date: '2026-09-10',
    tracking_number: '999999999999',
  }, cookie);

  // Outbound #2 — inv2 resold with no outbound tracking number yet.
  const sale2 = await request('/api/sales', {
    inventory_id: inv2.data.id, platform_id: marketplace.data.id,
    quantity: 1, unit_price: 60, sale_date: '2026-09-12',
  }, cookie);

  for (const [label, r] of [['vendor', vendor], ['marketplace', marketplace], ['inv1', inv1], ['inv2', inv2], ['sale1', sale1], ['sale2', sale2]]) {
    if (r.status >= 300) throw new Error(`${label} failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  console.log('Seed complete.');
  console.log('Browser login:', email, '/', password);
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
