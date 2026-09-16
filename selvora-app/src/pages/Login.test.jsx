import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Login from './Login';

const mocks = vi.hoisted(() => ({ user: null }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, setUser: vi.fn(), loading: false }) }));
vi.mock('../services/firebaseAuth', () => ({ firebaseEnabled: true, signupEnabled: false }));
vi.mock('../components/Auth/FirebaseLoginForm', () => ({
  default: ({ migration } = {}) => <div data-testid="firebase-login-form" data-migration={String(!!migration)}>Firebase Login</div>
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.user = null; });

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

  it('shows invite-only FAQ text when signup is disabled', () => {
    mount();
    fireEvent.click(screen.getByText('Is this free to use?'));
    expect(screen.getByText(/Returning accounts can sign in; new registration is not open yet/i)).toBeInTheDocument();
  });
});
