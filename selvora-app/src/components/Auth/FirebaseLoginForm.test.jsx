// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FirebaseLoginForm from './FirebaseLoginForm';
const mocks = vi.hoisted(() => ({ signup: vi.fn(), signin: vi.fn(), send: vi.fn(), reset: vi.fn(), reload: vi.fn(), exchange: vi.fn(), setUser: vi.fn(), signout: vi.fn(), client: vi.fn(), policy: vi.fn() }));
vi.mock('firebase/auth', () => ({ createUserWithEmailAndPassword: mocks.signup, signInWithEmailAndPassword: mocks.signin, sendEmailVerification: mocks.send, sendPasswordResetEmail: mocks.reset, signOut: mocks.signout, reload: mocks.reload, validatePassword: mocks.policy }));
vi.mock('../../services/firebaseAuth', () => ({ firebaseClient: mocks.client, signupEnabled: true, exchangeFirebase: mocks.exchange, emailActionSettings: () => ({ url: 'http://localhost/login' }), friendlyAuthError: error => error.code ? 'Safe authentication failure' : error.message }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ setUser: mocks.setUser }) }));
const firebaseUser = { uid: 'provider-uid', email: 'real@example.test', emailVerified: false, auth: {} };
beforeEach(() => { vi.clearAllMocks(); mocks.client.mockResolvedValue({}); mocks.policy.mockResolvedValue({ isValid: true }); mocks.signout.mockResolvedValue(); mocks.reload.mockResolvedValue(); firebaseUser.emailVerified = false; mocks.signup.mockResolvedValue({ user: firebaseUser }); mocks.signin.mockResolvedValue({ user: firebaseUser }); mocks.send.mockResolvedValue(); mocks.exchange.mockResolvedValue({ id: 'existing-neon-user' }); });
afterEach(cleanup);
const mount = migration => render(<MemoryRouter><FirebaseLoginForm migration={migration} /></MemoryRouter>);
function fill() { fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'real@example.test' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'private firebase password' } }); }
describe('Firebase email UI', () => {
  it('creates a provider account, waits for verification and uses a fresh token exchange before business access', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Create account' })); fill();
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'private firebase password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(await screen.findByText(/Verify your email/)).toBeInTheDocument(); expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.send).toHaveBeenCalled();
    firebaseUser.emailVerified = true;
    fireEvent.click(screen.getByRole('button', { name: 'Continue after verification' }));
    await waitFor(() => expect(mocks.exchange).toHaveBeenCalledWith(firebaseUser, 'signup', ''));
    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'existing-neon-user' });
  });
  it('blocks repeated submissions and preserves verification/retry after failure', async () => {
    mount(); fill(); let resolve; mocks.signin.mockReturnValue(new Promise(done => { resolve = done; }));
    const button = screen.getByRole('button', { name: 'Sign in', exact: true }); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(mocks.signin).toHaveBeenCalledTimes(1)); resolve({ user: firebaseUser });
    expect(await screen.findByRole('button', { name: 'Continue after verification' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue after verification' }));
    expect(await screen.findByText('Your email is not verified yet.')).toBeInTheDocument(); expect(mocks.setUser).not.toHaveBeenCalled();
  });
  it('rejects mismatched signup passwords before provider writes', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Create account' })); fill();
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different firebase password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(await screen.findByText(/matching passwords/)).toBeInTheDocument(); expect(mocks.signup).not.toHaveBeenCalled();
  });
  it('uses generic recovery messages and a resend cooldown', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'unknown@example.test' } });
    mocks.reset.mockRejectedValue({ code: 'auth/user-not-found' }); fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }));
    expect(await screen.findByText(/If this account can receive/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Send reset email' })).toBeDisabled();
  });
  it('shows the exact migration UID and never auto-creates a Neon account', async () => {
    mount(true); fireEvent.change(screen.getByLabelText('Existing private password'), { target: { value: 'existing private password' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'real@example.test' } });
    fireEvent.change(screen.getByLabelText('Firebase password'), { target: { value: 'private firebase password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(await screen.findByText('provider-uid')).toBeInTheDocument(); expect(mocks.exchange).not.toHaveBeenCalled();
    firebaseUser.emailVerified = true; fireEvent.click(screen.getByRole('button', { name: 'Complete approved migration' }));
    await waitFor(() => expect(mocks.exchange).toHaveBeenCalledWith(firebaseUser, 'migration', 'existing private password'));
  });
  it('recovers an existing verified provider account with explicit registration after an interrupted signup', async () => {
    mount(); fill(); firebaseUser.emailVerified = true; mocks.exchange.mockRejectedValueOnce(new Error('Account not registered'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(await screen.findByText('Account not registered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Register this verified account' }));
    await waitFor(() => expect(mocks.exchange).toHaveBeenLastCalledWith(firebaseUser, 'signup', ''));
  });
});
