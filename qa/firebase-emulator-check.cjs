const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { join } = require('node:path');
const requireApi = createRequire(join(__dirname, '../selvora-api/package.json'));
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const { initializeApp } = requireApi('firebase-admin/app');
const { getAuth } = requireApi('firebase-admin/auth');
const auth = getAuth(initializeApp({ projectId: 'demo-profittracker' }, 'qa-emulator-only'));
const api = 'http://localhost:3059';
const emulator = 'http://127.0.0.1:9099';
const email = 'browser-qa@example.test', password = 'isolated browser test password';
async function rest(path, body) {
  const response = await fetch(`${emulator}/identitytoolkit.googleapis.com/v1/${path}?key=demo-test-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.status, 200, result.error?.message); return result;
}
async function request(path, body, cookie) {
  const response = await fetch(api + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'http://localhost:5179', 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  const set = response.headers.getSetCookie();
  return { status: response.status, data, cookie: set.find(value => value.startsWith('pt_firebase_session='))?.split(';')[0] || set.find(value => value.startsWith('connect.sid='))?.split(';')[0] || cookie };
}
async function run() {
  let user;
  try { user = await auth.getUserByEmail(email); } catch { user = await auth.createUser({ email, password, emailVerified: false }); }
  await auth.updateUser(user.uid, { emailVerified: false });
  const unverified = await rest('accounts:signInWithPassword', { email, password, returnSecureToken: true });
  const grant = await request('/auth/firebase/intent', { purpose: 'signup' }); assert.equal(grant.status, 200);
  assert.equal((await request('/auth/firebase/session', { ...grant.data, id_token: unverified.idToken }, grant.cookie)).status, 401);
  await auth.updateUser(user.uid, { emailVerified: true });
  const verified = await rest('accounts:signInWithPassword', { email, password, returnSecureToken: true });
  const second = await request('/auth/firebase/intent', { purpose: 'signup' });
  const logged = await request('/auth/firebase/session', { ...second.data, id_token: verified.idToken }, second.cookie);
  assert.equal(logged.status, 200, JSON.stringify(logged.data));
  const me = await request('/auth/me', undefined, logged.cookie); assert.equal(me.status, 200, JSON.stringify(me.data));
  const records = await request('/api/inventory', undefined, logged.cookie); assert.equal(records.status, 200);
  assert.equal((await request('/auth/logout', {}, logged.cookie)).status, 200);
  assert.equal((await request('/auth/me', undefined, logged.cookie)).status, 401);
  const resetEmail = 'password-reset-qa@example.test';
  const oldPassword = 'isolated old reset test password', newPassword = 'isolated new reset test password';
  let resetUser;
  try { resetUser = await auth.getUserByEmail(resetEmail); await auth.updateUser(resetUser.uid, { password: oldPassword }); }
  catch { resetUser = await auth.createUser({ email: resetEmail, password: oldPassword, emailVerified: true }); }
  const resetToken = await rest('accounts:signInWithPassword', { email: resetEmail, password: oldPassword, returnSecureToken: true });
  const resetGrant = await request('/auth/firebase/intent', { purpose: 'signup' });
  const resetSession = await request('/auth/firebase/session', { ...resetGrant.data, id_token: resetToken.idToken }, resetGrant.cookie); assert.equal(resetSession.status, 200);
  await new Promise(resolve => setTimeout(resolve, 1100)); // Firebase revocation timestamps are second-resolution.
  await rest('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email: resetEmail });
  const oob = await (await fetch(`${emulator}/emulator/v1/projects/demo-profittracker/oobCodes`)).json();
  const code = oob.oobCodes.filter(entry => entry.email === resetEmail && entry.requestType === 'PASSWORD_RESET').at(-1).oobCode;
  await rest('accounts:resetPassword', { oobCode: code, newPassword });
  assert.equal((await request('/auth/me', undefined, resetSession.cookie)).status, 401, 'Old cookie must be rejected after Firebase password reset');
  const newToken = await rest('accounts:signInWithPassword', { email: resetEmail, password: newPassword, returnSecureToken: true });
  const newGrant = await request('/auth/firebase/intent', { purpose: 'login' });
  const newSession = await request('/auth/firebase/session', { ...newGrant.data, id_token: newToken.idToken }, newGrant.cookie); assert.equal(newSession.status, 200);
  assert.equal(newSession.data.id, resetSession.data.id);
  const requireWeb = createRequire(join(__dirname, '../selvora-app/package.json'));
  const webApp = requireWeb('firebase/app'), webAuth = requireWeb('firebase/auth');
  const web = webAuth.getAuth(webApp.initializeApp({ apiKey: 'demo-test-key', projectId: 'demo-profittracker' }, 'qa-web-only'));
  webAuth.connectAuthEmulator(web, emulator, { disableWarnings: true });
  await webAuth.setPersistence(web, webAuth.inMemoryPersistence);
  await webAuth.signInWithEmailAndPassword(web, resetEmail, newPassword);
  assert.equal((await request('/auth/firebase/account-check', { id_token: await web.currentUser.getIdToken(true) }, newSession.cookie)).status, 200);
  await new Promise(resolve => setTimeout(resolve, 1100));
  await webAuth.updatePassword(web.currentUser, 'isolated updated settings test password');
  assert.equal((await request('/auth/me', undefined, newSession.cookie)).status, 401, 'Old cookie must be rejected after Web SDK password update');
  await webAuth.signOut(web);
  console.log('PASS: real Firebase emulator SDK exchange; unverified denial; session verification; authenticated inventory; logout replay denial; password-reset cookie revocation and same-account recovery; Web SDK password update revocation.');
  console.log('Browser fixture is ready: browser-qa@example.test (password exists only in this isolated QA script).');
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
