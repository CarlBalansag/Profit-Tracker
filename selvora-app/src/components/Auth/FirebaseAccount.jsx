import { useState } from 'react';
import { signInWithEmailAndPassword, updatePassword, validatePassword, signOut } from 'firebase/auth';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../hooks/useApi';
import { firebaseClient, friendlyAuthError } from '../../services/firebaseAuth';

export default function FirebaseAccount() {
  const { logout } = useAuth();
  const [email, setEmail] = useState('');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function change(event) {
    event.preventDefault();
    if (pending) return;
    if (password.length < 15 || password !== confirmation || password === current) return setMessage('Use a different password with at least 15 characters and matching confirmation.');
    setPending(true); setMessage('');
    let auth;
    try {
      auth = await firebaseClient();
      const result = await signInWithEmailAndPassword(auth, email.trim(), current);
      // Backend confirms this is the exact mapped UID before a sensitive provider operation.
      const response = await apiFetch('/auth/firebase/account-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_token: await result.user.getIdToken(true) }) });
      if (!response.ok) throw new Error('Sign in with the Firebase identity for this account.');
      if (!(await validatePassword(auth, password)).isValid) throw new Error('Choose a password that meets the configured policy.');
      await updatePassword(result.user, password);
      setCurrent(''); setPassword(''); setConfirmation('');
      // Local denial occurs before remote revoke; a failure still requires fresh login.
      const revocation = await apiFetch('/auth/firebase/logout-all', { method: 'POST' });
      setMessage(revocation.ok ? 'Password changed. Sign in again.' : 'Password changed. Sign in again; logout-all confirmation is pending.');
      await logout();
    } catch (error) { setMessage(friendlyAuthError(error)); }
    finally { if (auth) await signOut(auth).catch(() => {}); setPending(false); }
  }
  return <form onSubmit={change} className="space-y-3 max-w-sm"><h3 className="font-semibold">Change Firebase password</h3>
    {[['Account email', email, setEmail, 'email', 'username'], ['Current password', current, setCurrent, 'password', 'current-password'], ['New password', password, setPassword, 'password', 'new-password'], ['Confirm password', confirmation, setConfirmation, 'password', 'new-password']].map(([label, value, setter, type, autoComplete], index) => <div key={label}><label htmlFor={`account-${index}`} className="block">{label}</label><input id={`account-${index}`} required type={type} maxLength={type === 'email' ? 254 : 128} minLength={index > 1 ? 15 : 1} autoComplete={autoComplete} value={value} onChange={event => setter(event.target.value)} disabled={pending} className="w-full rounded border bg-transparent p-2" /></div>)}
    <button disabled={pending} className="rounded bg-[#5865F2] p-2">{pending ? 'Please wait…' : 'Change password and sign out'}</button>{message && <p role="status">{message}</p>}
  </form>;
}
