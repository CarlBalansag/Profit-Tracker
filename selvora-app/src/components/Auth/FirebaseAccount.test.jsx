// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FirebaseAccount from './FirebaseAccount';

const mocks = vi.hoisted(() => ({
  signin: vi.fn(), updatePassword: vi.fn(), policy: vi.fn(), signout: vi.fn(),
  client: vi.fn(), logout: vi.fn(), apiFetch: vi.fn(),
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: mocks.signin,
  updatePassword: mocks.updatePassword,
  validatePassword: mocks.policy,
  signOut: mocks.signout,
}));
vi.mock('../../services/firebaseAuth', () => ({
  firebaseClient: mocks.client,
  friendlyAuthError: (error) => (error.code ? 'Safe authentication failure' : error.message),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ logout: mocks.logout }) }));
vi.mock('../../hooks/useApi', () => ({ apiFetch: mocks.apiFetch }));

const firebaseUser = { uid: 'uid-1', getIdToken: vi.fn().mockResolvedValue('id-token') };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockResolvedValue({});
  mocks.signin.mockResolvedValue({ user: firebaseUser });
  mocks.policy.mockResolvedValue({ isValid: true });
  mocks.updatePassword.mockResolvedValue();
  mocks.signout.mockResolvedValue();
  mocks.apiFetch.mockResolvedValue(new Response(null, { status: 200 }));
  mocks.logout.mockResolvedValue();
});
afterEach(cleanup);

function openModal() {
  render(<FirebaseAccount />);
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

function fillForm({ email = 'me@example.test', current = 'current password', next = 'a brand new long password', confirm = 'a brand new long password' } = {}) {
  fireEvent.change(screen.getByLabelText('Account email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
}

describe('FirebaseAccount password change', () => {
  it('renders as a small collapsed button, not an always-visible form', () => {
    render(<FirebaseAccount />);
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Account email')).not.toBeInTheDocument();
  });

  it('opens a modal with all four fields on click', () => {
    openModal();
    expect(screen.getByText('Change Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Account email')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  it('rejects a mismatched confirmation before touching Firebase', async () => {
    openModal();
    fillForm({ confirm: 'a totally different password' });
    fireEvent.click(screen.getByRole('button', { name: 'Change password and sign out' }));
    expect(await screen.findByText(/at least 15 characters and matching confirmation/)).toBeInTheDocument();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than 15 characters', async () => {
    openModal();
    fillForm({ next: 'short', confirm: 'short' });
    fireEvent.click(screen.getByRole('button', { name: 'Change password and sign out' }));
    expect(await screen.findByText(/at least 15 characters/)).toBeInTheDocument();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('changes the password and signs out on success', async () => {
    openModal();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Change password and sign out' }));
    await waitFor(() => expect(mocks.updatePassword).toHaveBeenCalledWith(firebaseUser, 'a brand new long password'));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalled());
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
  });

  it('closes and resets the form via the X button', () => {
    openModal();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Change Password')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText('Account email')).toHaveValue('');
  });
});
