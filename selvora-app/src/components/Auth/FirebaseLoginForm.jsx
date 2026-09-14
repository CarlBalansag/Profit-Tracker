import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut, reload, validatePassword } from 'firebase/auth';
import { useAuth } from '../../context/AuthContext';
import { firebaseClient, signupEnabled, exchangeFirebase, emailActionSettings, friendlyAuthError } from '../../services/firebaseAuth';
import { apiFetch } from '../../hooks/useApi';

export default function FirebaseLoginForm({ migration = false }) {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [current, setCurrent] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [providerUser, setProviderUser] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; firebaseClient().then(signOut).catch(() => {}); }; }, []);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  async function run(action) {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage('');
    try { await action(); } catch (error) { if (mounted.current) setMessage(friendlyAuthError(error)); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function finish(user, purpose) {
    const data = await exchangeFirebase(user, purpose, current);
    if (!mounted.current) return;
    setPassword(''); setCurrent(''); setConfirmation(''); setUser(data); navigate('/', { replace: true });
  }
  function submit(event) {
    event.preventDefault();
    if (mode === 'signup' && (password.length < 15 || password !== confirmation)) return setMessage('Use at least 15 characters and matching passwords.');
    run(async () => {
      const auth = await firebaseClient();
      if (mode === 'reset') {
        try { await sendPasswordResetEmail(auth, email.trim(), emailActionSettings()); }
        catch (error) { if (!['auth/user-not-found', 'auth/invalid-email'].includes(error.code)) throw error; }
        if (mounted.current) { setMessage('If this account can receive recovery email, a reset link has been sent.'); setCooldown(60); }
        return;
      }
      if (mode === 'signup') {
        const policy = await validatePassword(auth, password);
        if (!policy.isValid) throw new Error('Choose a password that meets the configured password policy.');
      }
      const result = await (mode === 'signup' ? createUserWithEmailAndPassword : signInWithEmailAndPassword)(auth, email.trim(), password);
      if (!mounted.current) { await signOut(auth); return; }
      setPassword(''); setConfirmation(''); setProviderUser(result.user);
      if (!result.user.emailVerified) {
        if (mode === 'signup') { await sendEmailVerification(result.user, emailActionSettings()); setCooldown(60); }
        setMessage('Verify your email, then continue. A refresh may require signing in again.');
        return;
      }
      await finish(result.user, migration ? 'migration' : mode === 'signup' ? 'signup' : 'login');
    });
  }
  const inputClass = 'w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2';
  return <form onSubmit={submit} className="w-full max-w-sm space-y-3">
    <h2 className="font-semibold">{migration ? 'Move your existing account to Firebase' : mode === 'signup' ? 'Create an account' : mode === 'reset' ? 'Reset password' : 'Sign in'}</h2>
    {migration && <><p>Your records stay with this account. Verify a real email, then request owner approval before continuing.</p>
      <label htmlFor="migration-password">Existing private password</label><input id="migration-password" type="password" required maxLength={128} autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} className={inputClass} disabled={pending} /></>}
    {!providerUser && <><label htmlFor="login-email">Email</label><input id="login-email" type="email" required maxLength={254} autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} className={inputClass} disabled={pending} />
      {mode !== 'reset' && <><label htmlFor="firebase-password">{migration ? 'Firebase password' : 'Password'}</label><input id="firebase-password" type="password" required minLength={mode === 'signup' ? 15 : 1} maxLength={128} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} className={inputClass} disabled={pending} /></>}
      {mode === 'signup' && <><label htmlFor="firebase-confirm">Confirm password</label><input id="firebase-confirm" type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className={inputClass} disabled={pending} /></>}
      <button type="submit" disabled={pending || (mode === 'reset' && cooldown > 0)} className="rounded bg-[#5865F2] p-2 disabled:opacity-50">{pending ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in'}</button></>}
    {providerUser && <><p>Account email: {providerUser.email}</p>
      {migration && <p>Firebase UID for the owner’s approval: <code>{providerUser.uid}</code></p>}
      <button type="button" disabled={pending} onClick={() => run(async () => { await reload(providerUser); if (!providerUser.emailVerified) throw new Error('Your email is not verified yet.'); await finish(providerUser, migration ? 'migration' : mode === 'signup' ? 'signup' : 'login'); })} className="rounded bg-[#5865F2] p-2">{migration ? 'Complete approved migration' : 'Continue after verification'}</button>
      <button type="button" disabled={pending || cooldown > 0} onClick={() => run(async () => { await sendEmailVerification(providerUser, emailActionSettings()); setCooldown(60); setMessage('Verification email sent.'); })} className="block underline">{cooldown ? `Resend in ${cooldown}s` : 'Resend verification'}</button>
      {!migration && signupEnabled && mode !== 'signup' && <button type="button" disabled={pending} onClick={() => run(async () => { await reload(providerUser); if (!providerUser.emailVerified) throw new Error('Verify your email first.'); await finish(providerUser, 'signup'); })} className="block underline">Register this verified account</button>}
      <button type="button" disabled={pending} onClick={() => run(async () => { await signOut(providerUser.auth); setProviderUser(null); setCurrent(''); })} className="block underline">Cancel and sign in again</button></>}
    {!providerUser && <div className="flex gap-3">{(signupEnabled || migration) && <button type="button" disabled={pending} onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setPassword(''); setConfirmation(''); setMessage(''); }} className="underline">{mode === 'signup' ? 'Already have an account?' : 'Create account'}</button>}
      <button type="button" disabled={pending} onClick={() => { setMode(mode === 'reset' ? 'login' : 'reset'); setPassword(''); setMessage(''); }} className="underline">{mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}</button></div>}
    {message && <p role="status">{message}</p>}
    {!migration && <button type="button" disabled={pending} onClick={() => run(async () => { const response = await apiFetch('/auth/logout', { method: 'POST' }); if (!response.ok) throw new Error('Could not clear the session. Please retry.'); if (providerUser) await signOut(providerUser.auth); setProviderUser(null); setPassword(''); setCurrent(''); setUser(null); setMessage('Session cleared. Please sign in again.'); })} className="block underline text-sm">Clear session and try again</button>}
  </form>;
}
