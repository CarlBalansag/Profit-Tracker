import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailAccounts } from './EmailAccounts';

const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });
const mutations = { connect: mutation(), update: mutation(), sync: mutation(), remove: mutation() };

const presets = [
  { id: 'gmail', label: 'Gmail', host: 'imap.gmail.com', help: 'Create an app password.', helpUrl: 'https://myaccount.google.com/apppasswords' },
  { id: 'other', label: 'Other (IMAP)', host: null, help: 'Use your server name.', helpUrl: null },
];
let setup;
let accounts;
let messages;
let extra = 0;
const messageCalls = [];

vi.mock('../../hooks/useApi', () => ({
  useEmailSetup: () => ({ data: setup, isLoading: false, error: null }),
  useEmailAccounts: () => ({ data: accounts, isLoading: false, error: null }),
  useEmailMessages: (opts) => { messageCalls.push(opts); return { data: { messages, total: messages.length + extra } }; },
  useEmailMutations: () => mutations,
  useEmailOrders: () => ({ data: { orders: [], counts: {}, total: 0 } }),
  useEmailAutomation: () => ({ data: { linkMatches: true } }),
  useEmailOrderMutations: () => ({ accept: mutation(), reject: mutation(), acceptAll: mutation(), dismiss: mutation(), automation: mutation() }),
  useEmailRules: () => ({ data: { rules: [], suggestions: [], stores: [] } }),
  useEmailRuleMutations: () => ({ save: mutation(), remove: mutation(), addExpense: mutation(), addPurchase: mutation(), handled: mutation(), saveInvoice: mutation() }),
  useEmailStores: () => ({ data: { supported: [], candidates: [], scanned_at: null, all_stores: [] } }),
  useEmailStoreMutations: () => ({ scan: mutation(), request: mutation() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const account = (over = {}) => ({
  id: 'acct-1', preset: 'gmail', email_address: 'me@gmail.com', status: 'active', last_error: null,
  sync_since: '2026-01-01T00:00:00.000Z', include_spam: false, last_synced_at: new Date().toISOString(),
  message_count: 3, syncing: false, ...over,
});

describe('EmailAccounts', () => {
  beforeEach(() => {
    setup = { configured: true, presets, senders: ['Amazon', 'Walmart'] };
    accounts = [];
    messages = [];
    extra = 0;
    messageCalls.length = 0;
    vi.clearAllMocks();
    Object.values(mutations).forEach((m) => m.mutateAsync.mockResolvedValue({}));
  });

  it('says when the server has no email key, and offers no connect button', () => {
    setup = { ...setup, configured: false };
    render(<EmailAccounts />);
    expect(screen.getByText(/aren't turned on for this server/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect an email/ })).not.toBeInTheDocument();
  });

  it('connects with an app password and shows the provider help link', async () => {
    render(<EmailAccounts />);
    fireEvent.click(screen.getByRole('button', { name: /Connect an email/ }));
    expect(screen.getByRole('link', { name: /How to make one/ })).toHaveAttribute('href', 'https://myaccount.google.com/apppasswords');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email address.');
    expect(mutations.connect.mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' me@gmail.com ' } });
    fireEvent.change(screen.getByLabelText('App password'), { target: { value: 'abcd efgh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(mutations.connect.mutateAsync).toHaveBeenCalled());
    const sent = mutations.connect.mutateAsync.mock.calls[0][0];
    expect(sent).toMatchObject({ preset: 'gmail', email_address: 'me@gmail.com', password: 'abcd efgh', include_spam: false });
    expect(sent).not.toHaveProperty('host');
  });

  it('asks for the server name for Other and shows a failed connection', async () => {
    mutations.connect.mutateAsync.mockRejectedValue(new Error("The mail server didn't accept that email and password."));
    render(<EmailAccounts />);
    fireEvent.click(screen.getByRole('button', { name: /Connect an email/ }));
    fireEvent.change(screen.getByLabelText('Email provider'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('App password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your mail server name.');
    fireEvent.change(screen.getByLabelText('Mail server (IMAP)'), { target: { value: 'imap.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/didn't accept that email/)).toBeInTheDocument();
    expect(mutations.connect.mutateAsync.mock.calls[0][0]).toMatchObject({ preset: 'other', host: 'imap.example.com' });
  });

  it('lists accounts and found emails, syncs, and confirms before deleting', async () => {
    accounts = [account()];
    messages = [{ id: 'm1', subject: 'Your Amazon.com order', from_name: 'Amazon.com', from_address: 'a@amazon.com', sent_at: '2026-03-01T12:00:00Z' }];
    mutations.sync.mutateAsync.mockResolvedValue({ status: 'ok', found: 2 });
    render(<EmailAccounts />);
    expect(screen.getByText('me@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/3 emails found/)).toBeInTheDocument();
    expect(screen.getByText('Your Amazon.com order')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Sync now/ }));
    await waitFor(() => expect(mutations.sync.mutateAsync).toHaveBeenCalledWith('acct-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: /Disconnect and delete/ }));
    expect(mutations.remove.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Disconnect and delete/ }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith({ id: 'acct-1', deleteData: true }));
    expect(confirm.mock.calls[0][0]).toMatch(/delete the 3 emails/);
    confirm.mockRestore();
  });

  it('asks for a new password when an account needs attention', async () => {
    accounts = [account({ status: 'error', last_error: 'Gmail, iCloud, Yahoo and AOL need an app password.' })];
    render(<EmailAccounts />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sync now/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Save password'), { target: { value: 'new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalledWith({ id: 'acct-1', password: 'new-pass' }));
  });

  it('offers Reconnect for a disconnected account', () => {
    accounts = [account({ status: 'disconnected' })];
    render(<EmailAccounts />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('shows what was read from each email, flags unsure values, and filters', () => {
    accounts = [account()];
    extra = 25;
    messages = [{
      id: 'm2', merchant: 'walmart', kind: 'order', status: 'extracted', subject: 'Thanks for your order', sent_at: '2026-03-02T12:00:00Z',
      order_number: '2000123-45678901', total: '64.74', tax: '4.80', tracking_numbers: [], payment_hint: 'Mastercard 5555',
      items: [{ name: 'Pokemon Booster Bundle', quantity: 2, total: '59.94' }], confidence: { order_number: 0.85, total: 0.4, items: 0.4 },
      link: 'https://mail.google.com/mail/u/0/#search/rfc822msgid%3Ax',
    }];
    render(<EmailAccounts />);
    expect(screen.getByText('Found in email')).toBeInTheDocument();
    expect(screen.getByText('#2000123-45678901 · $64.74')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Walmart/ }));
    expect(screen.getAllByText('check')).toHaveLength(2); // total and items are guesses
    expect(screen.getByText('2 × Pokemon Booster Bundle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Gmail/ })).toHaveAttribute('href', expect.stringContaining('rfc822msgid'));
    fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
    expect(messageCalls.at(-1)).toMatchObject({ kind: 'sales', limit: 10 });
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    expect(messageCalls.at(-1)).toMatchObject({ limit: 30 });
  });
});
