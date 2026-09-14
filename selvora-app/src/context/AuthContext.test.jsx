// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useApi', () => ({ apiFetch: fetchMock }));
vi.mock('../components/Auth/ServerWakeUpScreen', () => ({ default: () => <div>Loading auth</div> }));
beforeEach(() => { vi.clearAllMocks(); fetchMock.mockResolvedValue({ ok: false, status: 401 }); });
afterEach(cleanup);
function Controls() {
  const { user, setUser, logout } = useAuth();
  return <><p>User: {user?.id || 'none'}</p><button onClick={() => setUser({ id: 'a' })}>Login A</button><button onClick={() => setUser({ id: 'b' })}>Login B</button><button onClick={logout}>Logout</button></>;
}
function mount(strict = false) {
  const client = new QueryClient();
  const content = <QueryClientProvider client={client}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>;
  render(strict ? <StrictMode>{content}</StrictMode> : content); return client;
}
describe('auth state and query isolation', () => {
  it('clears cached business data when switching users and when an API session expires', async () => {
    const client = mount(); await screen.findByText('User: none'); fireEvent.click(screen.getByText('Login A'));
    client.setQueryData(['inventory'], [{ user_id: 'a', secret: 'private record' }]);
    fireEvent.click(screen.getByText('Login B')); expect(client.getQueryData(['inventory'])).toBeUndefined(); expect(screen.getByText('User: b')).toBeInTheDocument();
    client.setQueryData(['inventory'], [{ user_id: 'b' }]);
    window.dispatchEvent(new Event('auth-expired'));
    await waitFor(() => expect(screen.getByText('User: none')).toBeInTheDocument()); expect(client.getQueryData(['inventory'])).toBeUndefined();
  });
  it('reports failed server logout honestly, clears local data and permits a safe retry', async () => {
    const client = mount(); await screen.findByText('User: none'); fireEvent.click(screen.getByText('Login A')); client.setQueryData(['sales'], ['private']);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 }); fireEvent.click(screen.getByText('Logout'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-out was not confirmed'); expect(client.getQueryData(['sales'])).toBeUndefined();
    fetchMock.mockResolvedValueOnce({ ok: true }); fireEvent.click(screen.getByText('Retry sign out'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it('ignores a stale StrictMode auth response that arrives after the newer unauthenticated response', async () => {
    let resolve;
    fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ ok: false, status: 401 });
    mount(true); await screen.findByText('User: none'); resolve({ ok: true, status: 200, json: async () => ({ id: 'stale-a' }) });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); expect(screen.getByText('User: none')).toBeInTheDocument();
  });
});
