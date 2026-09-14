import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../hooks/useApi';

export default function PasswordLoginForm() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      const response = await apiFetch('/auth/login', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Sign-in failed. Please try again.');
      if (!data.id) throw new Error('Sign-in failed. Please try again.');
      setPassword('');
      setUser(data);
      navigate(data.password_change_required ? '/change-password' : '/', { replace: true });
    } catch (failure) {
      setError(failure instanceof TypeError || failure instanceof SyntaxError
        ? 'Could not reach sign-in. Please try again.' : failure.message);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-3 text-left">
      <p className="text-xs text-white/50">Invite-only access · Your existing records stay with your account.</p>
      <label htmlFor="login-email" className="block text-sm text-white/70">Email</label>
      <input id="login-email" type="email" autoComplete="username" required maxLength={254} value={email}
        onChange={event => setEmail(event.target.value)} disabled={pending}
        className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white" />
      <label htmlFor="login-password" className="block text-sm text-white/70">Password</label>
      <input id="login-password" type="password" autoComplete="current-password" required maxLength={128} value={password}
        onChange={event => setPassword(event.target.value)} disabled={pending}
        className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white" />
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button type="submit" disabled={pending}
        className="rounded-lg bg-[#5865F2] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-xs text-white/40">Need access or a password reset? Contact the owner.</p>
    </form>
  );
}
