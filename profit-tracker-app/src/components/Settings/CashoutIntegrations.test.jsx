import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CashoutIntegrations } from './CashoutIntegrations';

const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true }) });
const mutations = {
  addConnection: mutation(),
  updateConnection: mutation(),
  deleteConnection: mutation(),
  testConnection: mutation(),
};
const connection = { id: 'conn-1', provider: 'eb', keyLast4: '9876', status: 'active', lastError: null };

let providers;
let connections;
let providersState;

vi.mock('../../hooks/useApi', () => ({
  useCashoutProviders: () => ({ data: providers, isLoading: false, error: null, ...providersState }),
  useCashoutConnections: () => ({ data: connections, isLoading: false, error: null }),
  useCashoutMutations: () => mutations,
}));

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(() => 'toast-id'), success: vi.fn(), error: vi.fn() },
}));

afterEach(cleanup);

describe('CashoutIntegrations', () => {
  beforeEach(() => {
    providers = [{ id: 'eb', name: 'ElectronicsBuyer' }];
    connections = [];
    providersState = {};
    vi.clearAllMocks();
    Object.values(mutations).forEach((m) => m.mutateAsync.mockResolvedValue({ success: true }));
  });

  it('shows nothing to accounts with no integrations available', () => {
    providers = [];
    const { container } = render(<CashoutIntegrations />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when integrations fail to load, rather than hiding them', () => {
    providersState = { data: undefined, error: new Error('API error 500') };
    render(<CashoutIntegrations />);
    expect(screen.getByText(/Could not load cashout integrations/)).toBeInTheDocument();
  });

  it('connects with a pasted key and masks the input', async () => {
    render(<CashoutIntegrations />);
    const input = screen.getByLabelText('ElectronicsBuyer API key');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.change(input, { target: { value: '  my-key  ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verify & Connect' }));
    });

    expect(mutations.addConnection.mutateAsync).toHaveBeenCalledWith({ provider: 'eb', api_key: 'my-key' });
  });

  it('requires a key before calling the API', async () => {
    render(<CashoutIntegrations />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verify & Connect' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('API key is required.');
    expect(mutations.addConnection.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows why a key was refused and keeps what was typed', async () => {
    mutations.addConnection.mutateAsync.mockRejectedValue(new Error('ElectronicsBuyer rejected the API key'));
    render(<CashoutIntegrations />);
    const input = screen.getByLabelText('ElectronicsBuyer API key');

    fireEvent.change(input, { target: { value: 'bad-key' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verify & Connect' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('rejected the API key');
    expect(input).toHaveValue('bad-key');
  });

  it('shows only the last four characters of a saved key, and any saved error', () => {
    connections = [{ ...connection, status: 'attention_needed', lastError: 'ElectronicsBuyer API key is invalid or revoked.' }];
    render(<CashoutIntegrations />);

    expect(screen.getByText('••••••••9876')).toBeInTheDocument();
    expect(screen.getByText('Attention Needed')).toBeInTheDocument();
    expect(screen.getByText(/invalid or revoked/)).toBeInTheDocument();
    expect(screen.queryByLabelText('ElectronicsBuyer API key')).not.toBeInTheDocument();
  });

  it('replaces a key without removing the connection', async () => {
    connections = [connection];
    render(<CashoutIntegrations />);

    fireEvent.click(screen.getByRole('button', { name: 'Replace Key' }));
    fireEvent.change(screen.getByLabelText('New ElectronicsBuyer API key'), { target: { value: 'new-key' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verify & Save' }));
    });

    expect(mutations.updateConnection.mutateAsync).toHaveBeenCalledWith({ id: 'conn-1', api_key: 'new-key' });
    expect(mutations.deleteConnection.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Replace Key' })).toBeInTheDocument();
  });

  it('lets a key replacement be cancelled', () => {
    connections = [connection];
    render(<CashoutIntegrations />);

    fireEvent.click(screen.getByRole('button', { name: 'Replace Key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('New ElectronicsBuyer API key')).not.toBeInTheDocument();
    expect(mutations.updateConnection.mutateAsync).not.toHaveBeenCalled();
  });

  it('removes a connection only after confirming', async () => {
    connections = [connection];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CashoutIntegrations />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove ElectronicsBuyer' }));
    });
    expect(mutations.deleteConnection.mutateAsync).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove ElectronicsBuyer' }));
    });
    expect(mutations.deleteConnection.mutateAsync).toHaveBeenCalledWith('conn-1');
    confirm.mockRestore();
  });

  it('tests a saved key', async () => {
    connections = [connection];
    render(<CashoutIntegrations />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    expect(mutations.testConnection.mutateAsync).toHaveBeenCalledWith('conn-1');
  });
});
