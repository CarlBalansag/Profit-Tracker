import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Login from './Login';

const mocks = vi.hoisted(() => ({ user: null, loading: false }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, setUser: vi.fn(), loading: mocks.loading }) }));
vi.mock('../services/firebaseAuth', () => ({ firebaseEnabled: true, signupEnabled: false }));
vi.mock('../components/Auth/FirebaseLoginForm', () => ({
  default: ({ migration, inviteToken } = {}) => (
    <div
      data-testid="firebase-login-form"
      data-migration={String(!!migration)}
      data-invite-token={inviteToken || ''}
    >
      Firebase Login
    </div>
  )
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.user = null; mocks.loading = false; });

function mount(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Firebase login page', () => {
  it('renders the Firebase login form and no Discord or password controls', () => {
    mount();
    expect(screen.getByTestId('firebase-login-form')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Discord/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/invite-only access/i)).not.toBeInTheDocument();
  });

  it('shows the invite-only note when signup is disabled', () => {
    mount();
    expect(screen.getByText(/Returning accounts can sign in. New registration is not open yet/i)).toBeInTheDocument();
  });

  it('says the server is waking up only while the sign-in check is running', () => {
    mount();
    expect(screen.queryByText(/Waking up the server/)).not.toBeInTheDocument();
    cleanup();
    mocks.loading = true;
    mount();
    expect(screen.getByRole('status')).toHaveTextContent(/Waking up the server/);
  });

  it('links back to the landing page and its demo', () => {
    mount();
    expect(screen.getByRole('link', { name: /Back to home/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /Try the demo first/i })).toHaveAttribute('href', '/#demo');
  });

  it('passes migration mode to the login form only when ?migrate=1 is present', () => {
    mount();
    expect(screen.getByTestId('firebase-login-form').dataset.migration).toBe('false');
    cleanup();

    mount('/login?migrate=1');
    expect(screen.getByTestId('firebase-login-form').dataset.migration).toBe('true');
  });

  it('validates invite token and shows welcome banner when valid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ valid: true, expires_at: new Date(Date.now() + 100000).toISOString() }),
    });

    mount('/login?invite=valid-test-token');

    expect(await screen.findByText(/You've been invited!/i)).toBeInTheDocument();
    expect(screen.getByTestId('firebase-login-form').dataset.inviteToken).toBe('valid-test-token');
    expect(screen.getByText(/New here\? Use "Create account" above/i)).toBeInTheDocument();
  });

  it('shows error banner when invite token is invalid or expired', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ valid: false, reason: 'expired' }),
    });

    mount('/login?invite=expired-token');

    expect(await screen.findByText(/Invite link unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/This invite link has expired/i)).toBeInTheDocument();
    expect(screen.getByTestId('firebase-login-form').dataset.inviteToken).toBe('');
  });
});
