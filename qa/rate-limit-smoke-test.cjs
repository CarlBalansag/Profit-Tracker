// One-off smoke test: confirms the 10-per-hour tracking rate limit actually
// kicks in against the real running API + Neon branch, using the seeded test user.
const { createRequire } = require('node:module');
const requireApi = createRequire(require('path').join(__dirname, '../selvora-api/package.json'));
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const { initializeApp } = requireApi('firebase-admin/app');
const { getAuth } = requireApi('firebase-admin/auth');

const auth = getAuth(initializeApp({ projectId: 'demo-profittracker' }, 'ratelimit-emulator-only'));
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
  const identity = await auth.getUserByEmail(email);
  const signedIn = await rest('accounts:signInWithPassword', { email, password, returnSecureToken: true });

  const grant = await request('/auth/firebase/intent', { purpose: 'login' });
  const session = await request('/auth/firebase/session', { ...grant.data, id_token: signedIn.idToken }, grant.cookie);
  if (session.status !== 200) throw new Error('login failed: ' + JSON.stringify(session.data));
  const cookie = session.cookie;
  console.log('Logged in as', session.data.email);

  const inventory = await request('/api/inventory', undefined, cookie);
  const tracked = inventory.data.find(i => i.tracking_number);
  if (!tracked) throw new Error('No inventory item with a tracking number found — run the seed script first.');
  console.log('Using inventory item', tracked.id, 'tracking_number', tracked.tracking_number);

  for (let i = 1; i <= 11; i++) {
    const res = await request(`/api/inventory/${tracked.id}/track`, {}, cookie);
    console.log(`Check #${i}: status=${res.status}`, res.status === 429 ? res.data : `remaining=${res.data.rate_limit?.remaining}`);
  }
}

run().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; });
