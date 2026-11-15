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
  default: ({ migration } = {}) => <div data-testid="firebase-login-form" data-migration={String(!!migration)}>Firebase Login</div>
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
});
