import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Login from './Login';
import ChangePassword from './ChangePassword';
import ProtectedRoute from '../components/Auth/ProtectedRoute';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), setUser: vi.fn(), user: null }));
vi.mock('../hooks/useApi', () => ({ apiFetch: mocks.fetch }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, setUser: mocks.setUser, loading: false }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.user = null; });
function mount(path = '/login') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
    <Route path="/" element={<ProtectedRoute><div>Existing dashboard</div></ProtectedRoute>} />
  </Routes></MemoryRouter>);
}
function fillLogin() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'login@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-password' } });
}
describe('invite-only login UI', () => {
  it('shows email/password login and has no Discord login control', () => {
    mount(); expect(screen.getByLabelText('Email')).toBeRequired();
    expect(screen.getByLabelText('Password')).toBeRequired();
    expect(screen.queryByRole('button', { name: /Discord/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Need access or a password reset/)).toBeInTheDocument();
  });
  it('signs returning users into their existing dashboard', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'existing-user', password_change_required: false }) });
    mocks.setUser.mockImplementation(user => { mocks.user = user; });
    mount(); fillLogin(); fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(await screen.findByText('Existing dashboard')).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledWith('/auth/login', expect.objectContaining({ method: 'POST',
      body: JSON.stringify({ email: 'login@example.test', password: 'fixture-password' }) }));
  });
  it('forces a temporary-password user into the password change page', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'existing-user', password_change_required: true }) });
    mocks.setUser.mockImplementation(user => { mocks.user = user; });
    mount(); fillLogin(); fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Change your password' })).toBeInTheDocument();
    expect(screen.queryByText('Existing dashboard')).not.toBeInTheDocument();
  });
  it('blocks duplicate submissions and lets users retry after a failed response', async () => {
    let resolve;
    mocks.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    mount(); fillLogin();
    const button = screen.getByRole('button', { name: 'Sign in', exact: true });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Password')).toBeDisabled();
    await act(async () => resolve({ ok: false, json: async () => ({ error: 'Email or password is incorrect.' }) }));
    expect(screen.getByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(button).toBeEnabled();
    mocks.fetch.mockRejectedValueOnce(new TypeError('Network failed'));
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach sign-in.');
    expect(mocks.setUser).not.toHaveBeenCalled();
  });
  it('prevents protected dashboard navigation until the password change completes', async () => {
    mocks.user = { id: 'existing-user', password_change_required: true };
    mount('/'); expect(await screen.findByRole('heading', { name: 'Change your password' })).toBeInTheDocument();
  });
  it('validates confirmation and preserves the form on failed password change', async () => {
    mocks.user = { id: 'existing-user', password_change_required: true };
    mount('/change-password');
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'temporary-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-private-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-private-password' } });
    mocks.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Current password is incorrect.' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
    expect(screen.getByLabelText('New password')).toHaveValue('new-private-password');
    mocks.setUser.mockImplementation(user => { mocks.user = user; });
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'existing-user', password_change_required: false }) });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Existing dashboard')).toBeInTheDocument();
  });
});
