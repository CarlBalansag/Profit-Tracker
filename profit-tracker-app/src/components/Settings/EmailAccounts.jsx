import React, { useState } from 'react';
import { ExternalLink, Mail, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useEmailAccounts, useEmailMutations, useEmailSetup } from '../../hooks/useApi';
import { FoundInEmail } from './FoundInEmail';
import { EmailOrders } from './EmailOrders';
import { EmailRules } from './EmailRules';

const PANEL = 'rounded-xl border border-gray-800 bg-[#12121A] p-5 sm:p-6 space-y-4';
const INPUT = 'w-full rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-3 py-2 text-base sm:text-sm text-[var(--dp-text-primary)] placeholder-gray-600 focus:outline-none focus:border-[var(--accent)]';
const LABEL = 'block text-xs text-gray-400 mb-1';

const startOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
function ago(iso) {
  if (!iso) return 'Not synced yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${day(iso)}`;
}

function StatusPill({ account }) {
  const [text, tone] = account.syncing ? ['Syncing…', 'text-[var(--accent)] bg-[var(--accent-bg)]']
    : account.status === 'error' ? ['Needs attention', 'text-[var(--dp-warning-text)] bg-[var(--dp-warning-bg)]']
      : account.status === 'disconnected' ? ['Disconnected', 'text-gray-400 bg-white/5']
        : ['Connected', 'text-[var(--dp-green-text)] bg-[var(--dp-green-bg)]'];
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{text}</span>;
}

function PasswordForm({ account, label, onDone }) {
  const { update } = useEmailMutations();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!password) { setError('Enter the app password.'); return; }
    setError(null);
    try {
      await update.mutateAsync({ id: account.id, password });
      setPassword('');
      toast.success('Email connected again');
      onDone?.();
    } catch (err) { setError(err.message); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <label htmlFor={`email-pass-${account.id}`} className="sr-only">{label}</label>
        <input id={`email-pass-${account.id}`} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New app password" className={INPUT} />
        {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      <button type="submit" disabled={update.isPending} className="page-btn page-btn-primary">{update.isPending ? 'Checking…' : label}</button>
    </form>
  );
}

function AccountRow({ account, presets }) {
  const { sync, update, remove } = useEmailMutations();
  const [open, setOpen] = useState(false);
  const preset = presets.find((p) => p.id === account.preset);
  const connected = account.status !== 'disconnected';

  const syncNow = async () => {
    try {
      const r = await sync.mutateAsync(account.id);
      if (r.status === 'error') toast.error(r.error);
      else toast.success(r.found ? `Found ${r.found} new email${r.found === 1 ? '' : 's'}` : 'No new emails');
    } catch (err) { toast.error(err.message); }
  };
  const save = async (data) => {
    try { await update.mutateAsync({ id: account.id, ...data }); toast.success('Saved'); } catch (err) { toast.error(err.message); }
  };
  const disconnect = async (deleteData) => {
    const question = deleteData
      ? `Disconnect ${account.email_address} and delete the ${account.message_count} email${account.message_count === 1 ? '' : 's'} found through it? This can't be undone.`
      : `Disconnect ${account.email_address}? The saved password is erased. Emails already found stay.`;
    if (!window.confirm(question)) return;
    try {
      await remove.mutateAsync({ id: account.id, deleteData });
      toast.success(deleteData ? 'Disconnected and deleted' : 'Disconnected');
    } catch (err) { toast.error(err.message); }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Mail size={16} aria-hidden="true" className="shrink-0 text-gray-500" />
        <span className="min-w-0 break-all text-sm font-medium text-gray-100">{account.email_address}</span>
        <StatusPill account={account} />
      </div>
      <p className="mt-1 pl-7 text-xs text-gray-500">
        {preset?.label || 'IMAP'} · {account.message_count} email{account.message_count === 1 ? '' : 's'} found · {ago(account.last_synced_at)}
      </p>
      {account.last_error && <p className="mt-1 pl-7 text-xs text-[var(--dp-warning-text)]">{account.last_error}</p>}

      <div className="mt-2 flex flex-wrap gap-2 pl-7">
        {connected && account.status !== 'error' && (
          <button type="button" onClick={syncNow} disabled={sync.isPending || account.syncing} className="page-btn page-btn-secondary">
            <RefreshCw size={14} aria-hidden="true" className={sync.isPending || account.syncing ? 'animate-spin' : ''} /> Sync now
          </button>
        )}
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="page-btn page-btn-secondary">{open ? 'Close' : 'Options'}</button>
      </div>

      {account.status === 'error' && <div className="mt-3 pl-7"><PasswordForm account={account} label="Save password" /></div>}
      {account.status === 'disconnected' && <div className="mt-3 pl-7"><PasswordForm account={account} label="Reconnect" /></div>}

      {open && (
        <div className="mt-3 space-y-3 pl-7">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`email-since-${account.id}`} className={LABEL}>Look back to</label>
              <input id={`email-since-${account.id}`} type="date" max={today()} defaultValue={account.sync_since?.slice(0, 10)}
                onChange={(e) => e.target.value && save({ sync_since: e.target.value })} className={INPUT} />
            </div>
            <label className="flex min-h-[44px] items-center gap-3 self-end text-sm text-gray-200">
              <input type="checkbox" checked={account.include_spam} onChange={(e) => save({ include_spam: e.target.checked })} className="h-5 w-5 accent-[var(--accent)]" />
              Also check spam and junk
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {connected && <button type="button" onClick={() => disconnect(false)} className="page-btn page-btn-secondary">Disconnect</button>}
            <button type="button" onClick={() => disconnect(true)} className="page-btn page-btn-secondary text-red-400">Disconnect and delete found emails</button>
          </div>
        </div>
      )}
    </li>
  );
}

function ConnectForm({ presets, senders, onDone }) {
  const { connect } = useEmailMutations();
  const [form, setForm] = useState({ preset: 'gmail', email_address: '', host: '', username: '', password: '', sync_since: startOfYear(), include_spam: false });
  const [error, setError] = useState(null);
  const preset = presets.find((p) => p.id === form.preset) || presets[0];
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.email_address.trim()) { setError('Enter your email address.'); return; }
    if (form.preset === 'other' && !form.host.trim()) { setError('Enter your mail server name.'); return; }
    if (!form.password) { setError('Enter the app password.'); return; }
    try {
      await connect.mutateAsync({
        preset: form.preset, email_address: form.email_address.trim(), password: form.password,
        sync_since: form.sync_since, include_spam: form.include_spam,
        ...(form.preset === 'other' ? { host: form.host.trim(), username: form.username.trim() } : {}),
      });
      toast.success('Email connected. Looking for order emails now.');
      onDone();
    } catch (err) { setError(err.message); }
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby="email-connect-title">
      <h3 id="email-connect-title" className="text-sm font-semibold text-white">Connect an email</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="email-preset" className={LABEL}>Email provider</label>
          <select id="email-preset" value={form.preset} onChange={set('preset')} className={INPUT}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="email-address" className={LABEL}>Email address</label>
          <input id="email-address" type="email" autoComplete="email" value={form.email_address} onChange={set('email_address')} className={INPUT} />
        </div>
        {form.preset === 'other' && (
          <>
            <div>
              <label htmlFor="email-host" className={LABEL}>Mail server (IMAP)</label>
              <input id="email-host" type="text" placeholder="imap.example.com" autoCapitalize="none" spellCheck="false" value={form.host} onChange={set('host')} className={INPUT} />
            </div>
            <div>
              <label htmlFor="email-username" className={LABEL}>Username (if not your email)</label>
              <input id="email-username" type="text" autoCapitalize="none" spellCheck="false" value={form.username} onChange={set('username')} className={INPUT} />
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <label htmlFor="email-password" className={LABEL}>App password</label>
          <input id="email-password" type="password" autoComplete="off" value={form.password} onChange={set('password')} className={INPUT} />
          <p className="mt-1 text-xs text-gray-500">
            {preset?.help}{' '}
            {preset?.helpUrl && <a href={preset.helpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">How to make one <ExternalLink size={11} aria-hidden="true" /></a>}
          </p>
        </div>
        <div>
          <label htmlFor="email-since" className={LABEL}>Look back to</label>
          <input id="email-since" type="date" max={today()} value={form.sync_since} onChange={set('sync_since')} className={INPUT} />
        </div>
        <label className="flex min-h-[44px] items-center gap-3 self-end text-sm text-gray-200">
          <input type="checkbox" checked={form.include_spam} onChange={set('include_spam')} className="h-5 w-5 accent-[var(--accent)]" />
          Also check spam and junk
        </label>
      </div>
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">Which emails are read</summary>
        <p className="mt-1 max-w-prose">Only emails from these senders: {senders.join(', ')}. Nothing is ever deleted, moved, sent or marked as read, and only the sender, subject and date are kept.</p>
      </details>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={connect.isPending} className="page-btn page-btn-primary">{connect.isPending ? 'Checking…' : 'Connect'}</button>
        <button type="button" onClick={onDone} className="page-btn page-btn-secondary">Cancel</button>
      </div>
    </form>
  );
}

export function EmailAccounts() {
  const { data: setup, isLoading: setupLoading, error: setupError } = useEmailSetup();
  const { data: accounts = [], isLoading, error } = useEmailAccounts();
  const found = accounts.reduce((n, a) => n + (a.message_count || 0), 0);
  const [adding, setAdding] = useState(false);

  if (setupLoading || isLoading) return <div className={PANEL}><p className="text-sm text-gray-500">Loading…</p></div>;
  if (setupError || error) return <div className={PANEL}><p className="text-sm text-red-400">Could not load email settings. Reload the page to try again.</p></div>;

  return (
    <div className="space-y-4">
      <section aria-labelledby="email-title" className={PANEL}>
        <div>
          <h2 id="email-title" className="text-sm font-bold text-white">Email</h2>
          <p className="mt-1 max-w-prose text-xs text-gray-500">Connect an inbox to find order, shipping and receipt emails from stores. Only store and shipping emails are read, and nothing in your mailbox is changed.</p>
        </div>

        {!setup?.configured && <p className="text-sm text-gray-400">Email connections aren't turned on for this server yet.</p>}

        {accounts.length > 0 && (
          <ul className="divide-y divide-white/[0.06]">
            {accounts.map((a) => <AccountRow key={a.id} account={a} presets={setup?.presets || []} />)}
          </ul>
        )}

        {setup?.configured && (adding
          ? <ConnectForm presets={setup.presets} senders={setup.senders} onDone={() => setAdding(false)} />
          : <button type="button" onClick={() => setAdding(true)} className="page-btn page-btn-primary"><Plus size={14} aria-hidden="true" /> {accounts.length ? 'Connect another email' : 'Connect an email'}</button>)}
      </section>

      <EmailOrders found={found} />
      {accounts.length > 0 && <EmailRules />}
      <FoundInEmail found={found} />
    </div>
  );
}
