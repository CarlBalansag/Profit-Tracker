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
let saved; let taxMath; let calls; let entries; let payments;
const ledgerOf = () => {
  const sum = (k) => entries.filter((e) => e.kind === k).reduce((t, e) => t + Number(e.amount), 0);
  return { entries, setAside: sum('set_aside').toFixed(2), released: sum('released').toFixed(2), balance: (sum('set_aside') - sum('released')).toFixed(2) };
};
beforeEach(() => {
  saved = null; taxMath = 'simple'; calls = []; entries = []; payments = [];
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockImplementation(async (path, options = {}) => {
    if (options.method) calls.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    if (path === '/api/preferences/tax-math') {
      if (options.method === 'PUT') taxMath = JSON.parse(options.body).taxMath;
      return json({ taxMath });
    }
    if (path.startsWith('/api/tax/payments/entry/')) { payments = payments.filter((x) => x.id !== path.split('/').pop()); return json({ payments }); }
    if (path.startsWith('/api/tax/payments/')) {
      if (options.method === 'POST') payments = [{ id: `p${payments.length + 1}`, year: 2026, ...JSON.parse(options.body) }, ...payments];
      return json({ payments });
    }
    if (path.startsWith('/api/tax/reserves/entry/')) { entries = entries.filter((e) => e.id !== path.split('/').pop()); return json(ledgerOf()); }
    if (path.startsWith('/api/tax/reserves/')) {
      if (options.method === 'POST') { entries = [{ id: `e${entries.length + 1}`, ...JSON.parse(options.body) }, ...entries]; return json(ledgerOf()); }
      return json(ledgerOf());
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
    expect(within(state).getByRole('option', { name: 'New York (not supported yet)' })).toBeInTheDocument();
    expect(within(state).getByRole('option', { name: 'California (estimate)' })).toBeInTheDocument();
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
    expect(within(cardValue('Business tax')).getByText('$9,732.07')).toBeInTheDocument();
    expect(within(cardValue('Business tax')).getByText('About 19.5% of your profit')).toBeInTheDocument();
    expect(within(cardValue('Set aside')).getByText('$9,732.07')).toBeInTheDocument();
    expect(within(cardValue('Next payment')).getByText('Jan 15, 2027')).toBeInTheDocument();
    expect(within(cardValue('Next payment')).getByText('Federal (IRS) Q4: $8,758.86, including $6,569.16 overdue')).toBeInTheDocument();
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
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/dollars and cents/);
    expect(calls).toEqual([]);
  });

  it('says when the state is not included', async () => {
    saved = { year: 2026, state: 'NY', filing_status: 'single', non_business_income: '0', reserve_mode: 'personalized' };
    mountOverview();
    expect(await screen.findByText(/New York income tax is not supported yet/)).toBeInTheDocument();
  });

  it('shows an error and a retry when loading fails', async () => {
    mocks.apiFetch.mockImplementation(async () => json({ error: 'Enable Schedule C in Settings first' }, false));
    mountOverview();
    expect((await screen.findByRole('alert')).textContent).toBe('Enable Schedule C in Settings first');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  describe('projection and tax savings', () => {
    // 325 days into 2026, $10,000 so far, $4,500 in the last 90 days, and 80%
    // of last year's profit was made by this date.
    const forecast = { status: 'current', asOf: '2026-11-21', daysElapsed: 325, daysInYear: 365, recent: { days: 90, profit: 4500 }, prior: { netProfit: '9000.00', shareByThen: 0.8 }, monthly: [] };
    const withForecast = () => mountOverview({ books: { netProfit: '10000.00', forecast } });
    beforeEach(() => { saved = { year: 2026, state: 'TX', filing_status: 'single', non_business_income: '0', reserve_mode: 'personalized', forecast_method: null, profit_target: null }; });

    it('projects the year at the same pace by default and lets you choose another way', async () => {
      withForecast();
      expect(await screen.findByText(/Projected for 2026:/)).toBeInTheDocument();
      expect(within(cardValue('Profit so far')).getByText('$10,000.00')).toBeInTheDocument();
      expect(within(cardValue('Profit so far')).getByText('$11,230.77')).toBeInTheDocument();
      fireEvent.click(screen.getByText(/Projection for 2026/));
      fireEvent.click(screen.getByRole('radio', { name: /Last year's pattern/ }));
      await waitFor(() => expect(calls.at(-1)).toMatchObject({ path: '/api/tax/profile/2026', method: 'PUT', body: { forecast_method: 'seasonal', filing_status: 'single', state: 'TX' } }));
      expect(calls.at(-1).body).not.toHaveProperty('year');
      expect(await screen.findByText(/Projection for 2026: last year's pattern \(\$12,500\.00\)/)).toBeInTheDocument();
    });

    it('uses your own estimate once you enter one', async () => {
      withForecast();
      fireEvent.click(await screen.findByText(/Projection for 2026/));
      fireEvent.click(screen.getByRole('button', { name: 'Use my estimate' }));
      expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/full-year profit estimate/);
      fireEvent.change(screen.getByLabelText('My full-year profit estimate'), { target: { value: '50000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use my estimate' }));
      await waitFor(() => expect(calls.at(-1).body).toMatchObject({ forecast_method: 'target', profit_target: '50000' }));
      // $50,000, single, Texas: the business adds $9,732.07 (the engine walk-through).
      await waitFor(() => expect(within(cardValue('Business tax')).getByText('$9,732.07')).toBeInTheDocument());
    });

    it('records money set aside and counts it toward the recommendation', async () => {
      withForecast();
      fireEvent.click(await screen.findByText(/already saved and paid/));
      fireEvent.click(screen.getByRole('button', { name: 'Record money set aside' }));
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
      fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'moved to savings' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls.at(-1)).toMatchObject({ path: '/api/tax/reserves/2026', method: 'POST', body: { kind: 'set_aside', amount: '500', date: '2026-11-21', note: 'moved to savings' } }));
      expect(await screen.findByText('+$500.00')).toBeInTheDocument();
      const row = screen.getByText('In your tax savings').closest('tr');
      expect(within(row).getByText('$500.00')).toBeInTheDocument();
      // Delete asks first.
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
      await waitFor(() => expect(calls.at(-1)).toMatchObject({ path: '/api/tax/reserves/entry/e1', method: 'DELETE' }));
      await waitFor(() => expect(screen.queryByText('+$500.00')).toBeNull());
    });

    it('refuses a bad amount without sending it', async () => {
      withForecast();
      fireEvent.click(await screen.findByText(/already saved and paid/));
      fireEvent.click(screen.getByRole('button', { name: 'Record money set aside' }));
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/dollars and cents/);
      expect(calls.filter((c) => c.path.startsWith('/api/tax/reserves'))).toEqual([]);
    });
  });

  describe('tax payments', () => {
    // $50,000 profit, single, Texas, 2026: $8,758.86 of estimated payments,
    // $2,189.72/$2,189.71... per quarter; on Nov 21 only Q4 is still ahead.
    beforeEach(() => { saved = { year: 2026, state: 'TX', filing_status: 'single', non_business_income: '0', reserve_mode: 'personalized' }; });

    it('flags unpaid past quarters and folds them into the next payment', async () => {
      mountOverview();
      const alert = (await screen.findByText('3 estimated tax payments look unpaid')).closest('[role="status"]');
      expect(alert.textContent).toMatch(/^3 estimated tax payments look unpaid/);
      expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Federal (IRS) Q1, due Apr 15, 2026: $2,189.72', 'Federal (IRS) Q2, due Jun 15, 2026: $2,189.72', 'Federal (IRS) Q3, due Sep 15, 2026: $2,189.72']);
      expect(within(cardValue('Next payment')).getByText(/Federal \(IRS\) Q4: \$8,758\.86, including \$6,569\.16 overdue/)).toBeInTheDocument();
      expect(screen.getAllByText('Overdue')).toHaveLength(3);
    });

    it('records a payment, prefilled with the earliest unpaid quarter, and marks it paid', async () => {
      mountOverview();
      fireEvent.click(await screen.findByRole('button', { name: 'Record a payment' }));
      expect(screen.getByLabelText('Paid to').value).toBe('US');
      expect(screen.getByLabelText('For').value).toBe('Q1');
      expect(screen.getByLabelText('Amount').value).toBe('2189.72');
      fireEvent.change(screen.getByLabelText('Confirmation number (optional)'), { target: { value: 'DP-123' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
      await waitFor(() => expect(calls.at(-1)).toMatchObject({ path: '/api/tax/payments/2026', method: 'POST', body: { jurisdiction: 'US', period: 'Q1', amount: '2189.72', paid_date: '2026-11-21', reference: 'DP-123' } }));
      expect(await screen.findByText(/Federal \(IRS\) · Q1 · Nov 21, 2026/)).toBeInTheDocument();
      expect(screen.getAllByText('Overdue')).toHaveLength(2);
      expect(screen.getByText('Paid')).toBeInTheDocument();
      expect(screen.getByText(/Tax payments \(\$2,189\.72 paid\)/)).toBeInTheDocument();
    });

    it('deletes a payment after asking, and refuses a bad amount', async () => {
      payments = [{ id: 'p1', year: 2026, jurisdiction: 'US', period: 'Q1', amount: '100.00', paid_date: '2026-04-10', reference: null }];
      mountOverview();
      await screen.findByText(/Federal \(IRS\) · Q1 · Apr 10, 2026/);
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
      await waitFor(() => expect(calls.at(-1)).toMatchObject({ path: '/api/tax/payments/entry/p1', method: 'DELETE' }));
      fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '-4' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
      expect(within(screen.getByRole('form', { name: 'Record a tax payment' })).getByRole('alert').textContent).toMatch(/amount you paid/);
      expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    });
  });

  describe('what-if and deduction checks', () => {
    beforeEach(() => { saved = { year: 2026, state: 'TX', filing_status: 'single', non_business_income: '0', reserve_mode: 'personalized' }; localStorage.clear(); });
    const worksheet = { groups: [{ id: 'SUPPLIES', count: 2 }], rows: [{ id: 'x', name: 'Verizon Wireless', source: 'manual' }] };

    it('runs a scenario through the engine and explains what a deduction really saves', async () => {
      mountOverview();
      fireEvent.click(await screen.findByText('What if…'));
      expect(screen.getByText(/spending \$100 on a deductible expense would cut your tax by \$10/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('A deductible business expense'), { target: { value: '1000' } });
      expect(await screen.findByText(/Your total tax would go down by \$230\.52\. Spending \$1,000\.00 saves about 23\.1% of it in tax, so it still costs you about \$769\.48\./)).toBeInTheDocument();
      const row = screen.getByText('Total tax').closest('tr');
      expect(within(row).getByText('$9,501.55')).toBeInTheDocument();
      expect(calls).toEqual([]); // nothing saved
      fireEvent.change(screen.getByLabelText('A deductible business expense'), { target: { value: '-5' } });
      expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/A deductible business expense/);
    });

    it('lists deduction checks the records do not cover, and hides one on request', async () => {
      mountOverview({ worksheet, books: { netProfit: '50000.00', sales: { count: 4 } } });
      fireEvent.click(await screen.findByText('Deductions you might be missing'));
      expect(screen.getByText('Driving for the business')).toBeInTheDocument();
      expect(screen.queryByText('Packing and shipping supplies')).toBeNull(); // supplies recorded
      expect(screen.queryByText('Phone and internet, business share')).toBeNull(); // Verizon recorded
      fireEvent.click(screen.getByText('Driving for the business'));
      expect(screen.getByRole('link', { name: 'IRS: Standard mileage rates' })).toHaveAttribute('href', 'https://www.irs.gov/tax-professionals/standard-mileage-rates');
      fireEvent.click(screen.getAllByRole('button', { name: "Doesn't apply to me" })[0]);
      expect(screen.queryByText('Driving for the business')).toBeNull();
      expect(JSON.parse(localStorage.getItem('pt.taxDeductionChecks.hidden'))).toEqual(['mileage']);
      fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden suggestion' }));
      expect(screen.getByText('Driving for the business')).toBeInTheDocument();
    });
  });
});
