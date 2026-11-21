// The Schedule C tax estimate: first-time setup, estimating without saving,
// saving and deleting a profile, the Simple / Detailed view, and the answers.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaxOverview } from './TaxOverview';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../../utils/returnWindow', () => ({ localToday: () => '2026-11-21' }));

const json = (body, ok = true) => ({ ok, json: async () => structuredClone(body) });
let saved; let taxMath; let calls;
beforeEach(() => {
  saved = null; taxMath = 'simple'; calls = [];
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockImplementation(async (path, options = {}) => {
    if (options.method) calls.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    if (path === '/api/preferences/tax-math') {
      if (options.method === 'PUT') taxMath = JSON.parse(options.body).taxMath;
      return json({ taxMath });
    }
    if (path.startsWith('/api/tax/profile/')) {
      if (options.method === 'PUT') { saved = { ...JSON.parse(options.body), year: 2026, updated_at: 'now' }; return json({ profile: saved }); }
      if (options.method === 'DELETE') { saved = null; return json({ deleted: 1 }); }
      return json({ profile: saved });
    }
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(cleanup);

const mountOverview = (props = {}) => render(<TaxOverview year={2026} books={{ netProfit: '50000.00' }} pendingExpenses={2} missingReceipts={1} onShowWorksheet={vi.fn()} {...props} />);
const fillSetup = async ({ state = 'TX', status = 'single', income = '0' } = {}) => {
  await screen.findByRole('form', { name: 'Set up your tax estimate' });
  fireEvent.change(screen.getByLabelText('State you live in'), { target: { value: state } });
  fireEvent.change(screen.getByLabelText('Filing status'), { target: { value: status } });
  fireEvent.change(screen.getByLabelText('Income outside this business in 2026'), { target: { value: income } });
};
const cardValue = (title) => screen.getByText(title).parentElement;

describe('Tax estimate', () => {
  it('asks three questions first, and labels state coverage', async () => {
    mountOverview();
    await screen.findByRole('form', { name: 'Set up your tax estimate' });
    const state = screen.getByLabelText('State you live in');
    expect(within(state).getByRole('option', { name: 'Texas (no state income tax)' })).toBeInTheDocument();
    expect(within(state).getByRole('option', { name: 'California (not supported yet)' })).toBeInTheDocument();
    expect(within(state).getByRole('option', { name: 'Colorado' })).toBeInTheDocument();
    expect(screen.getByText(/never ask for your Social Security number/)).toBeInTheDocument();
  });

  it('estimates without saving: nothing is sent, and the answers show', async () => {
    mountOverview();
    await fillSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Estimate without saving' }));
    expect(await screen.findByText(/Not saved: these details are only in this browser tab/)).toBeInTheDocument();
    expect(calls).toEqual([]);
    expect(within(cardValue('Profit so far')).getByText('$50,000.00')).toBeInTheDocument();
    expect(within(cardValue('Tax the business adds')).getByText('$9,732.07')).toBeInTheDocument();
    expect(within(cardValue('Tax the business adds')).getByText('About 19.5% of your profit')).toBeInTheDocument();
    expect(within(cardValue('Set aside')).getByText('$9,732.07')).toBeInTheDocument();
    expect(within(cardValue('Next payment due')).getByText('Jan 15, 2027')).toBeInTheDocument();
    expect(within(cardValue('Next payment due')).getByText('Federal (IRS) Q4: $2,189.70')).toBeInTheDocument();
    expect(screen.getByText(/2 expenses are waiting for review/)).toBeInTheDocument();
    // Saving later sends exactly what was typed.
    fireEvent.click(screen.getByRole('button', { name: 'Save them' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ path: '/api/tax/profile/2026', method: 'PUT', body: { state: 'TX', filing_status: 'single', non_business_income: '0', reserve_mode: 'personalized', wages: null } });
    await waitFor(() => expect(screen.queryByText(/Not saved/)).toBeNull());
  });

  it('saves from setup, then edits and deletes the saved details', async () => {
    mountOverview();
    await fillSetup({ state: 'CO', status: 'mfj', income: '60000' });
    fireEvent.click(screen.getByRole('button', { name: 'Save and see my estimate' }));
    expect(await screen.findByText(/Married filing jointly, Colorado/)).toBeInTheDocument();
    expect(calls[0].body).toMatchObject({ state: 'CO', filing_status: 'mfj', non_business_income: '60000' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit my tax details' }));
    fireEvent.change(screen.getByLabelText('Federal tax withheld from paychecks'), { target: { value: '4000' } });
    fireEvent.click(screen.getByLabelText(/Conservative/));
    fireEvent.change(screen.getByLabelText('Safety buffer'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toMatchObject({ federal_withholding: '4000', reserve_mode: 'conservative', buffer_rate: '0.2', non_business_income: '60000' });
    expect(await screen.findByText(/conservative ·/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete saved details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await screen.findByRole('form', { name: 'Set up your tax estimate' });
    expect(calls[2]).toMatchObject({ path: '/api/tax/profile/2026', method: 'DELETE' });
  });

  it('switches between Simple and Detailed, and remembers the choice', async () => {
    saved = { year: 2026, state: 'TX', filing_status: 'single', non_business_income: '0', reserve_mode: 'personalized' };
    mountOverview();
    await screen.findByText('Your 2026 tax estimate');
    expect(screen.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('columnheader', { name: 'With business' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Detailed' }));
    expect(await screen.findByRole('columnheader', { name: 'With business' })).toBeInTheDocument();
    expect(screen.getByText(/Rules used: federal/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Publication 505/ })).toHaveAttribute('href', 'https://www.irs.gov/publications/p505');
    await waitFor(() => expect(calls).toContainEqual({ path: '/api/preferences/tax-math', method: 'PUT', body: { taxMath: 'detailed' } }));
  });

  it('can skip to a flat percentage without a filing status', async () => {
    mountOverview();
    await screen.findByRole('form', { name: 'Set up your tax estimate' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip: use a flat 25%' }));
    expect(within(cardValue('Set aside')).getByText('$12,500.00')).toBeInTheDocument();
    expect(screen.getByText('Add your filing status to see this')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('refuses incomplete or impossible answers without sending them', async () => {
    mountOverview();
    await screen.findByRole('form', { name: 'Set up your tax estimate' });
    fireEvent.click(screen.getByRole('button', { name: 'Save and see my estimate' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Choose your filing status/);
    fireEvent.change(screen.getByLabelText('Filing status'), { target: { value: 'single' } });
    fireEvent.change(screen.getByLabelText('Income outside this business in 2026'), { target: { value: '12.345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and see my estimate' }));
    expect(screen.getByRole('alert').textContent).toMatch(/dollars and cents/);
    expect(calls).toEqual([]);
  });

  it('says when the state is not included', async () => {
    saved = { year: 2026, state: 'CA', filing_status: 'single', non_business_income: '0', reserve_mode: 'personalized' };
    mountOverview();
    expect(await screen.findByText(/California income tax is not supported yet/)).toBeInTheDocument();
  });

  it('shows an error and a retry when loading fails', async () => {
    mocks.apiFetch.mockImplementation(async () => json({ error: 'Enable Schedule C in Settings first' }, false));
    mountOverview();
    expect((await screen.findByRole('alert')).textContent).toBe('Enable Schedule C in Settings first');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
