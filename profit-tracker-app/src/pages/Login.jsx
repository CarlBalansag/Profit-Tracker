import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import FirebaseLoginForm from '../components/Auth/FirebaseLoginForm';
import { signupEnabled } from '../services/firebaseAuth';
import AnimatedLogo from '../components/UI/AnimatedLogo';
import '../components/Landing/landing.css';

// Sign-in page. The marketing content and demo live on the landing page (/).
const Login = () => {
  // One-off, unlisted entry point for a legacy account's owner to migrate to
  // Firebase (?migrate=1) -- see scripts/approveFirebaseMigration.js. Not
  // linked from anywhere in the app; this is deliberately link-only until a
  // real self-service migration page is built.
  const [searchParams] = useSearchParams();
  const migration = searchParams.get('migrate') === '1';

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
          <div className="lp-card p-5 sm:p-6 lp-login-form">
            <FirebaseLoginForm migration={migration} />
          </div>
          <p className="text-[12.5px] text-[var(--lp-text-3)] text-center mt-5">
            {signupEnabled
              ? 'New here? Use "Create account" above. It\'s free.'
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
