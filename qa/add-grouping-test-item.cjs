// One-off: adds a second inventory item sharing the same tracking number as
// the existing seeded one, to visually verify the Shipping page's grouping UI.
const { createRequire } = require('node:module');
const requireApi = createRequire(require('path').join(__dirname, '../selvora-api/package.json'));
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const { initializeApp } = requireApi('firebase-admin/app');
const { getAuth } = requireApi('firebase-admin/auth');

const auth = getAuth(initializeApp({ projectId: 'demo-profittracker' }, 'group-test-emulator-only'));
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

async function put(path, body, cookie) {
  const response = await fetch(api + path, {
    method: 'PUT',
    headers: { Origin: frontendOrigin, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function run() {
  await auth.getUserByEmail(email);
  const signedIn = await rest('accounts:signInWithPassword', { email, password, returnSecureToken: true });
  const grant = await request('/auth/firebase/intent', { purpose: 'login' });
  const session = await request('/auth/firebase/session', { ...grant.data, id_token: signedIn.idToken }, grant.cookie);
  if (session.status !== 200) throw new Error('login failed: ' + JSON.stringify(session.data));
  const cookie = session.cookie;

  const inventory = await request('/api/inventory', undefined, cookie);
  const vendorItem = inventory.data.find(i => i.tracking_number === '1Z999AA10123456784');
  if (!vendorItem) throw new Error('Seed item with the UPS tracking number not found — run shipping-browser-seed.cjs first.');

  // Create a second, third item sharing the same UPS tracking number (a group of 3).
  for (const name of ['Grouped Item B', 'Grouped Item C']) {
    const created = await request('/api/inventory', {
      product_name: name, vendor_id: vendorItem.vendor_id,
      purchase_date: '2026-09-05', unit_purchase_cost: 20, qty_purchased: 3,
      tracking_number: '1Z999AA10123456784',
    }, cookie);
    if (created.status >= 300) throw new Error('create failed: ' + JSON.stringify(created.data));
    console.log('Created', name, created.data.id);
  }

  // Also set an untracked outbound sale's tracking to test the auto status-advance visually.
  const sales = await request('/api/sales', undefined, cookie);
  const untrackedSale = sales.data.find(s => !s.tracking_number);
  if (untrackedSale) {
    const updated = await put(`/api/sales/${untrackedSale.id}`, { tracking_number: '999999999998' }, cookie);
    console.log('Updated sale status ->', updated.data.status);
  }

  console.log('Done.');
}

run().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; });
