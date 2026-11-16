import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, UserPlus, AlertCircle } from 'lucide-react';
import FirebaseLoginForm from '../components/Auth/FirebaseLoginForm';
import { signupEnabled } from '../services/firebaseAuth';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import AnimatedLogo from '../components/UI/AnimatedLogo';
import '../components/Landing/landing.css';

// Sign-in page. The marketing content and demo live on the landing page (/).
const Login = () => {
  // One-off, unlisted entry point for a legacy account's owner to migrate to
  // Firebase (?migrate=1) -- see scripts/approveFirebaseMigration.js.
  const [searchParams] = useSearchParams();
  const migration = searchParams.get('migrate') === '1';
  const rawInvite = searchParams.get('invite');
  const inviteToken = rawInvite ? rawInvite.trim() : null;

  const [inviteStatus, setInviteStatus] = useState(
    inviteToken ? { loading: true, valid: false } : null
  );

  // True while the server is still waking up (see AuthContext).
  const { loading: serverWaking } = useAuth() ?? {};

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    apiFetch(`/api/invites/validate?token=${encodeURIComponent(inviteToken)}`)
      .then(async (res) => {
        let data = {};
        try { data = await res.json(); } catch { data = {}; }
        if (!cancelled) {
          if (res.ok && data.valid) {
            setInviteStatus({ loading: false, valid: true, expires_at: data.expires_at });
          } else {
            setInviteStatus({ loading: false, valid: false, reason: data.reason || 'invalid' });
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInviteStatus({ loading: false, valid: false, reason: 'network_error' });
        }
      });
    return () => { cancelled = true; };
  }, [inviteToken]);

  return (
    <div className="lp min-h-screen flex flex-col">
      <div className="lp-hero-glow fixed inset-0 pointer-events-none" aria-hidden="true" />
      <header className="relative px-4 sm:px-8 h-14 flex items-center">
        <Link to="/" className="lp-focus inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--lp-text-2)] hover:text-[var(--lp-text)] rounded-md">
          <ArrowLeft size={14} /> Back to home
        </Link>
      </header>
      <main className="relative flex-1 flex items-start sm:items-center justify-center px-4 pb-16 pt-6 sm:pt-0">
        <div className="w-full max-w-[400px]">
          <div className="flex flex-col items-center text-center mb-6">
            <AnimatedLogo size={40} label={null} />
            <h1 className="text-[15px] font-extrabold tracking-tight mt-3 text-[var(--lp-text-2)]">Profit Tracker</h1>
          </div>
          {serverWaking && (
            <p role="status" className="flex items-center justify-center gap-2 text-[12.5px] text-[var(--lp-text-2)] mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-warn)] animate-pulse" aria-hidden="true" />
              Waking up the server. Signing in may take up to a minute.
            </p>
          )}

          {inviteStatus && !inviteStatus.loading && inviteStatus.valid && (
            <div className="mb-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs flex items-start gap-2.5">
              <UserPlus size={16} className="flex-shrink-0 mt-0.5 text-emerald-400" />
              <div>
                <p className="font-semibold text-emerald-200">You've been invited!</p>
                <p className="text-[11.5px] text-emerald-300/80 mt-0.5">
                  Create your account below to join. This link is single-use and valid for 3 days.
                </p>
              </div>
            </div>
          )}

          {inviteStatus && !inviteStatus.loading && !inviteStatus.valid && (
            <div className="mb-4 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-rose-400" />
              <div>
                <p className="font-semibold text-rose-200">Invite link unavailable</p>
                <p className="text-[11.5px] text-rose-300/80 mt-0.5">
                  {inviteStatus.reason === 'expired'
                    ? 'This invite link has expired. Please ask for a new invite.'
                    : inviteStatus.reason === 'consumed'
                    ? 'This invite link has already been used to create an account.'
                    : 'This invite link is invalid. Please double-check your link.'}
                </p>
              </div>
            </div>
          )}

          <div className="lp-card p-5 sm:p-6 lp-login-form">
            <FirebaseLoginForm
              migration={migration}
              inviteToken={inviteStatus?.valid ? inviteToken : null}
            />
          </div>
          <p className="text-[12.5px] text-[var(--lp-text-3)] text-center mt-5">
            {signupEnabled || inviteStatus?.valid
              ? 'New here? Use "Create account" above.'
              : 'Returning accounts can sign in. New registration is not open yet.'}
          </p>
          <p className="text-[12.5px] text-center mt-2">
            <Link to="/#demo" className="lp-focus font-bold text-[var(--lp-accent-text)] hover:underline rounded">Try the demo first</Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default Login;
