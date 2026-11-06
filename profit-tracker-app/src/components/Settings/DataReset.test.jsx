import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataReset } from './DataReset';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status });
let client;

function open(buttonName) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DataReset /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  return screen.getByRole('dialog');
}

const dialogButton = (name) => screen.getAllByRole('button', { name }).at(-1);
const typeConfirmation = (value) =>
  fireEvent.change(screen.getByLabelText('Type RESET to confirm'), { target: { value } });

beforeEach(() => {
  toastSuccess.mockClear();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { scope: 'transactions', deleted: {} })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DataReset', () => {
  it('states what each choice deletes and keeps', () => {
    const transactions = open('Reset transactions');
    expect(transactions.textContent).toContain('Do you really want to do this?');
    expect(transactions.textContent).toContain('All purchases and sales');
    const [, kept] = transactions.textContent.split('This will be kept');
    expect(kept).toContain('Payment methods, vendors, accounts, marketplaces, cashouts');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    cleanup();

    const everything = open('Reset everything');
    const [deleted] = everything.textContent.split('This will be kept');
    for (const item of ['Payment methods', 'Vendors, marketplaces and cashouts', 'Accounts and buyers', 'Expenses']) {
      expect(deleted).toContain(item);
    }
  });

  it('keeps the confirm button off until RESET is typed exactly', () => {
    open('Reset everything');
    const confirm = dialogButton('Reset everything');
    expect(confirm.disabled).toBe(true);

    for (const value of ['reset', 'RESET ', 'RESE']) {
      typeConfirmation(value);
      expect(confirm.disabled).toBe(true);
    }
    typeConfirmation('RESET');
    expect(confirm.disabled).toBe(false);
  });

  it('sends nothing on cancel and forgets what was typed', () => {
    open('Reset transactions');
    typeConfirmation('RESET');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset transactions' }));
    expect(screen.getByLabelText('Type RESET to confirm').value).toBe('');
  });

  it('resets the chosen scope, refreshes every query and clears the form draft', async () => {
    localStorage.setItem('add_transaction_draft', '{"data":{}}');
    open('Reset everything');
    const resetQueries = vi.spyOn(client, 'resetQueries');
    typeConfirmation('RESET');
    fireEvent.click(dialogButton('Reset everything'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('All your data has been reset.'));
    const [path, options] = fetch.mock.calls[0];
    expect(path).toContain('/api/data-reset');
    expect(JSON.parse(options.body)).toEqual({ scope: 'everything', confirmation: 'RESET' });
    expect(resetQueries).toHaveBeenCalled();
    expect(localStorage.getItem('add_transaction_draft')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says nothing was deleted when the server refuses, and allows a retry', async () => {
    localStorage.setItem('add_transaction_draft', '{"data":{}}');
    fetch.mockResolvedValueOnce(jsonResponse(500, { error: 'Internal Server Error' }));
    open('Reset transactions');
    typeConfirmation('RESET');
    fireEvent.click(dialogButton('Reset transactions'));

    expect((await screen.findByRole('alert')).textContent).toContain('nothing was deleted');
    expect(localStorage.getItem('add_transaction_draft')).not.toBeNull();

    fireEvent.click(dialogButton('Reset transactions'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not claim nothing was deleted when the connection drops', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    open('Reset transactions');
    typeConfirmation('RESET');
    fireEvent.click(dialogButton('Reset transactions'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('nothing was deleted');
    expect(alert.textContent).toContain('Reload the page');
  });
});
