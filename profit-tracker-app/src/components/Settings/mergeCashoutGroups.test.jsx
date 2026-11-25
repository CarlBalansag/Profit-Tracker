import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cashouts } from './Cashouts';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), all: vi.fn(), platforms: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ all: mocks.all, platforms: mocks.platforms }),
}));
vi.mock('./CashoutIntegrations', () => ({ CashoutIntegrations: () => null }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const group = (id, name, extra = {}) => ({ id, name, type: 'Cashout', tax_exempt_place: false, ...extra });
const NONE = { sales: 0, purchases: 0, store_accounts: 0, connections: 0, imports: 0, tax_forms: 0 };
let groups;
let onPreview;
let onMerge;

beforeEach(() => {
  vi.clearAllMocks();
  groups = [group('efb', 'EarnFromBuying'), group('la', 'LA Cashout'), group('wc', 'Windy City')];
  onPreview = () => Promise.resolve(json({ counts: { ...NONE, sales: 2, imports: 1 } }));
  onMerge = () => Promise.resolve(json({ platform: groups[0], moved: {}, activity_id: 'act-1' }));
  mocks.apiFetch.mockImplementation((path, options = {}) => {
    if (path === '/api/platforms') return Promise.resolve(json([...groups, { id: 'm', name: 'eBay', type: 'Marketplace' }]));
    if (path.endsWith('/merge-preview')) return onPreview(path);
    if (path.endsWith('/merge')) return onMerge(path, options);
    return Promise.resolve(json({}));
  });
});
afterEach(cleanup);

const merges = () => mocks.apiFetch.mock.calls.filter(([p]) => p.endsWith('/merge'));
const openFor = async (name) => {
  render(<Cashouts />);
  fireEvent.click(await screen.findByRole('button', { name: `Merge ${name} into another group` }));
  return screen.getByRole('dialog', { name: 'Merge cashout groups' });
};
const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const confirm = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Merge' });

describe('merging cashout groups', () => {
  it('opens for a group, says what moves, and merges it into the one to keep', async () => {
    await openFor('LA Cashout');
    expect(screen.getByLabelText('Group to merge and remove')).toHaveValue('la');
    expect(confirm()).toBeDisabled();
    pick('Group to keep', 'efb');
    expect(await screen.findByText('Moves to EarnFromBuying')).toBeInTheDocument();
    expect(screen.getByText('2 sales')).toBeInTheDocument();
    expect(screen.getByText('1 past import')).toBeInTheDocument();
    expect(screen.getByText(/LA Cashout is then removed/)).toBeInTheDocument();
    fireEvent.click(confirm());
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(merges()[0][0]).toBe('/api/platforms/la/merge');
    expect(JSON.parse(merges()[0][1].body)).toEqual({ into: 'efb' });
    expect(mocks.success.mock.calls[0][0]).toBe('LA Cashout merged into EarnFromBuying.');
    expect(mocks.success.mock.calls[0][1].action.label).toBe('Undo');
    expect(mocks.all).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the Merge button with nothing picked; only cashout groups are listed', async () => {
    render(<Cashouts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }));
    const from = screen.getByLabelText('Group to merge and remove');
    expect(from).toHaveValue('');
    expect(within(from).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select a group…', 'EarnFromBuying', 'LA Cashout', 'Windy City']);
    pick('Group to merge and remove', 'la');
    expect(within(screen.getByLabelText('Group to keep')).queryByText('LA Cashout')).toBeNull();
    await screen.findByText('On LA Cashout');
  });

  it('swaps which group is kept', async () => {
    await openFor('LA Cashout');
    pick('Group to keep', 'efb');
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    expect(screen.getByLabelText('Group to merge and remove')).toHaveValue('efb');
    expect(await screen.findByText('Moves to LA Cashout')).toBeInTheDocument();
  });

  it('picking the kept group as the one to remove clears the kept one', async () => {
    await openFor('LA Cashout');
    pick('Group to keep', 'efb');
    pick('Group to merge and remove', 'efb');
    expect(screen.getByLabelText('Group to keep')).toHaveValue('');
    expect(confirm()).toBeDisabled();
  });

  it('says when a group has nothing on it', async () => {
    onPreview = () => Promise.resolve(json({ counts: NONE }));
    await openFor('Windy City');
    pick('Group to keep', 'efb');
    expect(await screen.findByText('Nothing is recorded on Windy City.')).toBeInTheDocument();
    expect(confirm()).toBeEnabled();
  });

  it('warns when only one of the two is tax exempt', async () => {
    groups[0].tax_exempt_place = true;
    await openFor('LA Cashout');
    pick('Group to keep', 'efb');
    expect(await screen.findByText(/EarnFromBuying is tax exempt and LA Cashout isn't/)).toBeInTheDocument();
  });

  it("can't merge until what moves is known, and retries", async () => {
    onPreview = () => Promise.resolve(json({ error: 'Server busy' }, 500));
    await openFor('LA Cashout');
    pick('Group to keep', 'efb');
    expect(await screen.findByText(/Server busy/)).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    onPreview = () => Promise.resolve(json({ counts: { ...NONE, sales: 1 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('1 sale')).toBeInTheDocument();
    expect(confirm()).toBeEnabled();
  });

  it('ignores a slow answer for a group picked earlier', async () => {
    let slow;
    onPreview = (path) => (path.includes('/la/') ? new Promise((resolve) => { slow = resolve; }) : Promise.resolve(json({ counts: { ...NONE, sales: 7 } })));
    await openFor('LA Cashout');
    pick('Group to merge and remove', 'wc');
    expect(await screen.findByText('7 sales')).toBeInTheDocument();
    slow(json({ counts: { ...NONE, sales: 2 } }));
    await Promise.resolve();
    expect(screen.getByText('7 sales')).toBeInTheDocument();
  });

  it('stays open with the reason when the merge fails, and cancel sends nothing', async () => {
    onMerge = () => Promise.resolve(json({ error: 'The group to keep no longer exists.' }, 404));
    await openFor('LA Cashout');
    pick('Group to keep', 'efb');
    await screen.findByText('2 sales');
    fireEvent.click(confirm());
    expect(await screen.findByRole('alert')).toHaveTextContent('The group to keep no longer exists.');
    expect(confirm()).toBeEnabled();
    expect(mocks.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(merges()).toHaveLength(1);
  });

  it('is not offered with a single group', async () => {
    groups = [groups[0]];
    render(<Cashouts />);
    await screen.findByRole('button', { name: 'Edit EarnFromBuying' });
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
  });
});
