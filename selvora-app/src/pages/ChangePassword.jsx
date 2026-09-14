import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';

export default function ChangePassword() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (password !== confirmation) return setError('Passwords do not match.');
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      const response = await apiFetch('/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Password could not be changed.');
      if (!data.id) throw new Error('Password could not be changed.');
      setCurrent(''); setPassword(''); setConfirmation('');
      setUser(data);
      navigate('/', { replace: true });
    } catch (failure) {
      setError(failure instanceof TypeError || failure instanceof SyntaxError ? 'Could not reach the server. Please try again.' : failure.message);
    } finally { submitting.current = false; setPending(false); }
  }
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">Change your password</h1>
      <p className="mt-2 text-sm">Choose a private password before opening your records. Use at least 15 characters.</p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <label htmlFor="current-password" className="block">Current password</label>
        <input id="current-password" type="password" autoComplete="current-password" required maxLength={128}
          value={current} onChange={event => setCurrent(event.target.value)} disabled={pending}
          className="w-full rounded border bg-transparent p-2" />
        <label htmlFor="new-password" className="block">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" required minLength={15} maxLength={128}
          value={password} onChange={event => setPassword(event.target.value)} disabled={pending}
          className="w-full rounded border bg-transparent p-2" />
        <label htmlFor="confirm-password" className="block">Confirm new password</label>
        <input id="confirm-password" type="password" autoComplete="new-password" required minLength={15} maxLength={128}
          value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={pending}
          className="w-full rounded border bg-transparent p-2" />
        {error && <p role="alert" className="text-red-500">{error}</p>}
        <button type="submit" disabled={pending} className="rounded bg-[#5865F2] px-4 py-2 text-white disabled:opacity-50">
          {pending ? 'Saving…' : 'Save password'}
        </button>
        <button type="button" disabled={pending} className="ml-3 underline"
          onClick={() => navigate('/login', { replace: true })}>Back to sign in</button>
      </form>
    </main>
  );
}
