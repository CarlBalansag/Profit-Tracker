import { initializeApp, getApps } from 'firebase/app';
import { getAuth, inMemoryPersistence, setPersistence, signOut, connectAuthEmulator } from 'firebase/auth';
import { apiFetch } from '../hooks/useApi';

export const firebaseEnabled = import.meta.env.VITE_FIREBASE_AUTH_ENABLED === 'true';
export const signupEnabled = import.meta.env.VITE_FIREBASE_SIGNUP_ENABLED === 'true';
if (import.meta.env.PROD && import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL) throw new Error('Firebase emulator forbidden in production');
let ready;
export async function firebaseClient() {
  if (!firebaseEnabled) return Promise.reject(new Error('Firebase sign-in is not configured.'));
  if (!ready) {
    const app = getApps().find(app => app.name === 'profittracker-auth') || initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, appId: import.meta.env.VITE_FIREBASE_APP_ID,
    }, 'profittracker-auth');
    const auth = getAuth(app);
    if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL) connectAuthEmulator(auth, import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL);
    ready = setPersistence(auth, inMemoryPersistence).then(() => auth).catch(error => { ready = undefined; throw error; });
  }
  return ready;
}
export async function authRequest(path, body) {
  const response = await apiFetch(`/auth/firebase/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Could not reach sign-in. Please retry.'); }
  if (!response.ok) throw new Error(data.error || 'Sign-in failed. Please retry.');
  return data;
}
export async function exchangeFirebase(user, purpose, currentPassword) {
  const grant = await authRequest('intent', { purpose, ...(purpose === 'migration' ? { current_password: currentPassword } : {}) });
  const id_token = await user.getIdToken(true);
  const result = await authRequest(purpose === 'migration' ? 'link' : 'session', { ...grant, id_token });
  await signOut(user.auth).catch(() => {});
  return result;
}
export const emailActionSettings = () => ({ url: `${window.location.origin}/login`, handleCodeInApp: false });
export function friendlyAuthError(error) {
  if (!error?.code) return error?.message || 'Could not complete sign-in. Please retry.';
  if (error.code === 'auth/too-many-requests') return 'Too many attempts. Please try again later.';
  if (error.code === 'auth/network-request-failed') return 'Could not reach sign-in. Please retry.';
  if (error.code === 'auth/weak-password' || error.code === 'auth/password-does-not-meet-requirements') return 'Choose a password that meets the password policy.';
  return 'Could not complete sign-in. Check your details or use password recovery.';
}
