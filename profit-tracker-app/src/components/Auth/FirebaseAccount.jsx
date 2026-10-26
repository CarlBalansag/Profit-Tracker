import { useState } from 'react';
import { X } from 'lucide-react';
import { signInWithEmailAndPassword, updatePassword, validatePassword, signOut } from 'firebase/auth';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../hooks/useApi';
import { firebaseClient, friendlyAuthError } from '../../services/firebaseAuth';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

export default function FirebaseAccount() {
  const { logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const modalRef = useModalKeyboard(isOpen, () => { if (!pending) close(); });

  function close() {
    setIsOpen(false);
    setEmail(''); setCurrent(''); setPassword(''); setConfirmation(''); setMessage('');
  }

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

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="text-xs text-gray-500 hover:text-white underline underline-offset-2 transition-colors"
      >
        Change password
      </button>
    );
  }

  const inputClass = 'w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500 transition-colors';
  const fields = [
    ['Account email', email, setEmail, 'email', 'username'],
    ['Current password', current, setCurrent, 'password', 'current-password'],
    ['New password', password, setPassword, 'password', 'new-password'],
    ['Confirm password', confirmation, setConfirmation, 'password', 'new-password'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div ref={modalRef} className="bg-[#12121A] border border-gray-800 rounded-xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-gray-800/50">
          <h2 className="text-lg font-bold text-white">Change Password</h2>
          <button onClick={() => { if (!pending) close(); }} aria-label="Close" className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={change} className="p-6 space-y-4">
          {fields.map(([label, value, setter, type, autoComplete], index) => (
            <div key={label} className="space-y-1.5">
              <label htmlFor={`account-${index}`} className="text-xs font-bold text-gray-400 uppercase tracking-wider block">{label}</label>
              <input
                id={`account-${index}`}
                required
                type={type}
                maxLength={type === 'email' ? 254 : 128}
                minLength={index > 1 ? 15 : 1}
                autoComplete={autoComplete}
                value={value}
                onChange={event => setter(event.target.value)}
                disabled={pending}
                className={inputClass}
              />
            </div>
          ))}
          <button disabled={pending} className="w-full px-6 py-2.5 rounded-lg text-sm font-bold bg-[#1A1A24] border border-gray-700 hover:border-gray-500 text-white transition-all shadow-lg active:scale-95 disabled:opacity-50">
            {pending ? 'Please wait…' : 'Change password and sign out'}
          </button>
          {message && <p role="status" className="text-[11px] text-gray-400">{message}</p>}
        </form>
      </div>
    </div>
  );
}
