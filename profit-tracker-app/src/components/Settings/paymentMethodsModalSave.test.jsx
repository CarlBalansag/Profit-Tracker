import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentMethods } from './PaymentMethods';
import { _resetCatalogCacheForTests } from '../../utils/cardRewards';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidatePaymentMethods: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ paymentMethods: mocks.invalidatePaymentMethods }),
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'tester' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

const CATALOG = {
  cards: [
    {
      id: 'us-amex-gold', name: 'American Express® Gold Card', issuer: 'American Express', reward_type: 'points',
      rewards_label: 'Membership Rewards points', base_rate: 1, annual_fee: 325,
      categories: [{ label: 'Restaurants worldwide', rate: 4, cap: null }, { label: 'U.S. supermarkets', rate: 4, cap: null }],
      benefits: [{ title: 'Dunkin\' statement credit', category: 'credit', description: 'Monthly credit.' }],
    },
    {
      id: 'us-citi-double-cash', name: 'Citi Double Cash® Card', issuer: 'Citi', reward_type: 'cashback',
      rewards_label: 'Cash back', base_rate: 2, annual_fee: 0, categories: [], benefits: [],
    },
  ],
  last_verified: '2026-10-22',
  attribution: { name: 'OpenCard DB', license: 'CC BY 4.0' },
};

// Routes the page's requests: GET the card list and the catalog, and hands
// every write to `onWrite` so each test decides the save's outcome.
let savedMethods;
let onWrite;
const route = (path, options = {}) => {
  const method = options.method || 'GET';
  if (method === 'GET' && path === '/api/card-catalog') return Promise.resolve(json(CATALOG));
  if (method === 'GET' && path === '/api/payment-methods') return Promise.resolve(json(savedMethods));
  return onWrite(path, options);
};
const writes = () => mocks.apiFetch.mock.calls.filter(([, o]) => o && o.method && o.method !== 'GET');

describe('QA-20/QA-23 regression: card modals do not close/clear before save succeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCatalogCacheForTests();
    savedMethods = [];
    onWrite = () => Promise.resolve(json({}));
    mocks.apiFetch.mockImplementation(route);
  });

  it('keeps the Custom Card modal open and shows an error when the save fails', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    expect(await screen.findByText('Add Card')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'My Card' } });

    onWrite = () => Promise.resolve(json({ error: 'Card creation failed' }, 500));
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.getByText('Add Card')).toBeTruthy();
    expect(screen.getByDisplayValue('My Card')).toBeTruthy();
  });

  it('closes the Custom Card modal and refreshes only after a successful save', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    expect(await screen.findByText('Add Card')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'My Card' } });

    onWrite = () => Promise.resolve(json({ id: 'c1', name: 'My Card', type: 'Credit', default_cashback_rate: 0, category_rates: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));

    await waitFor(() => expect(screen.queryByText('Add Card')).toBeNull());
    expect(mocks.invalidatePaymentMethods).toHaveBeenCalled();
  });

  it('sends the entered Last 4 Digits in the save request', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    expect(await screen.findByText('Add Card')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'My Card' } });
    fireEvent.change(screen.getByPlaceholderText('0000'), { target: { value: '1234' } });

    onWrite = () => Promise.resolve(json({ id: 'c1', name: 'My Card', type: 'Credit', last4: '1234', category_rates: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));

    await waitFor(() => expect(screen.queryByText('Add Card')).toBeNull());
    expect(JSON.parse(writes()[0][1].body).last4).toBe('1234');
  });

  it('does not close the Custom Card modal on Escape while a save is in flight', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    expect(await screen.findByText('Add Card')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'My Card' } });

    let resolveSave;
    onWrite = () => new Promise(resolve => { resolveSave = resolve; });
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving...' })).toBeTruthy());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Add Card')).toBeTruthy();

    resolveSave(json({ id: 'c2', name: 'My Card', type: 'Credit', category_rates: [] }));
    await waitFor(() => expect(screen.queryByText('Add Card')).toBeNull());
  });

  it('keeps the Quick Add modal open with the selection intact when a card fails to add', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Quick Add/ }));
    expect(await screen.findByText('Quick Add Cards')).toBeTruthy();

    const cardButton = await screen.findByRole('button', { name: /Citi Double Cash/ });
    fireEvent.click(cardButton);

    onWrite = () => Promise.resolve(json({ error: 'failed' }, 500));
    fireEvent.click(screen.getByRole('button', { name: /Add Cards/ }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.getByText('Quick Add Cards')).toBeTruthy();
    expect(cardButton.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Card catalog: points vs cashback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCatalogCacheForTests();
    savedMethods = [];
    onWrite = (path, options) => Promise.resolve(json({ id: 'new', ...JSON.parse(options.body) }));
    mocks.apiFetch.mockImplementation(route);
  });

  it('labels catalog cards as Points or Cashback and credits OpenCard DB', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Quick Add/ }));
    const gold = await screen.findByRole('button', { name: /American Express® Gold Card/ });
    expect(within(gold).getByText('Points')).toBeTruthy();
    expect(within(gold).getByText(/1x base/)).toBeTruthy();
    const citi = screen.getByRole('button', { name: /Citi Double Cash/ });
    expect(within(citi).getByText('Cashback')).toBeTruthy();
    expect(within(citi).getByText(/2% base/)).toBeTruthy();
    expect(screen.getByText('OpenCard DB')).toBeTruthy();
  });

  it('filters to points cards only', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Quick Add/ }));
    await screen.findByRole('button', { name: /American Express® Gold Card/ });
    fireEvent.click(screen.getByRole('button', { name: 'Points & miles' }));
    expect(screen.queryByRole('button', { name: /Citi Double Cash/ })).toBeNull();
    expect(screen.getByRole('button', { name: /American Express® Gold Card/ })).toBeTruthy();
  });

  it('asks the server to fill a points card from the catalog, with the chosen point value', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Quick Add/ }));
    fireEvent.click(await screen.findByRole('button', { name: /American Express® Gold Card/ }));
    fireEvent.change(screen.getByLabelText('Each point is worth'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Cards/ }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = JSON.parse(writes()[0][1].body);
    expect(body).toEqual({
      name: 'American Express Gold Card', type: 'Credit', catalog_card_id: 'us-amex-gold',
      apply_catalog: true, include_store_rates: true, category_rates: [], point_value_cents: 1.5,
    });
  });

  it('blocks adding a points card with an invalid point value', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Quick Add/ }));
    fireEvent.click(await screen.findByRole('button', { name: /American Express® Gold Card/ }));
    fireEvent.change(screen.getByLabelText('Each point is worth'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /Add Cards/ }).disabled).toBe(true);
  });

  it('a Custom points card sends points fields, and a debit card saves as Debit', async () => {
    render(<PaymentMethods />);
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    fireEvent.change(await screen.findByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'My Amex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Points / miles' }));
    fireEvent.change(screen.getByLabelText('Points per $1'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Point value (¢)'), { target: { value: '2' } });
    expect(screen.getByText(/Counts as 6% back/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ type: 'Credit', reward_type: 'points', points_base_rate: 3, point_value_cents: 2 });

    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    fireEvent.change(await screen.findByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'Checking' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Debit' } });
    expect(screen.getByText(/Most debit cards earn nothing/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(JSON.parse(writes()[1][1].body)).toMatchObject({ type: 'Debit', reward_type: 'cashback', default_cashback_rate: 0 });
  });

  it('shows a points card as a multiplier with its dollar value, plus its catalog perks', async () => {
    savedMethods = [{
      id: 'gold', name: 'Amex Gold', type: 'Credit', reward_type: 'points', points_base_rate: 1, point_value_cents: 2,
      default_cashback_rate: 2, rewards_label: 'Membership Rewards points', catalog_card_id: 'us-amex-gold',
      category_rates: [{ store: 'Dining', points: 4, rate: 8 }], total_spend: 0,
    }];
    render(<PaymentMethods />);
    expect(await screen.findByText('1x pts')).toBeTruthy();
    expect(screen.getByText(/at 2¢ each ≈ 2.00%/)).toBeTruthy();
    expect(await screen.findByText('1 perks · 1 cards')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show or hide rates' }));
    expect(screen.getByText('4x · ≈8%')).toBeTruthy();
  });

  it('shows when a catalog card last took its rates from the card data', async () => {
    savedMethods = [{
      id: 'gold', name: 'Amex Gold', type: 'Credit', reward_type: 'points', points_base_rate: 1, point_value_cents: 1,
      default_cashback_rate: 1, catalog_card_id: 'us-amex-gold', catalog_synced_at: '2026-11-16T12:00:00Z',
      category_rates: [], total_spend: 0,
    }];
    render(<PaymentMethods />);
    expect(await screen.findByText(/Rates kept current · last updated Nov 16, 2026/)).toBeTruthy();
  });
});

describe('Edit card: re-link to a different card from the list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCatalogCacheForTests();
    onWrite = (path, options) => Promise.resolve(json({ id: 'gold', ...JSON.parse(options.body) }));
    mocks.apiFetch.mockImplementation(route);
    // Saved as the Gold, plus one store rate the user added.
    savedMethods = [{
      id: 'gold', name: 'American Express Gold Card', type: 'Credit', reward_type: 'points', points_base_rate: 1,
      point_value_cents: 1.5, default_cashback_rate: 1.5, catalog_card_id: 'us-amex-gold', last4: '1001',
      category_rates: [{ store: 'Dining', points: 4, rate: 6, source: 'catalog' }, { store: 'eBay', rate: 2, points: 1.333333 }],
      total_spend: 0,
    }];
  });

  const openEdit = async () => {
    render(<PaymentMethods />);
    await screen.findAllByText('American Express Gold Card');
    fireEvent.click(screen.getByRole('button', { name: 'Edit card' }));
    expect(await screen.findByText('Card from the list')).toBeTruthy();
  };

  it('shows the linked card and warns that editing points per $1 stops updates', async () => {
    await openEdit();
    expect(await screen.findByText('American Express® Gold Card')).toBeTruthy();
    expect(screen.getByText('Changing this stops automatic rate updates for this card.')).toBeTruthy();
  });

  it('re-links to the picked card, renames it and keeps the user\'s own store rate', async () => {
    await openEdit();
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Search the card list'), { target: { value: 'double cash' } });
    fireEvent.click(screen.getByRole('button', { name: /Citi Double Cash® Card/ }));
    expect(screen.getByText(/Saving switches this card's rates to Citi Double Cash® Card/)).toBeTruthy();
    expect(screen.getByDisplayValue('Citi Double Cash Card')).toBeTruthy(); // followed the new card's name
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, options] = writes()[0];
    expect(path).toBe('/api/payment-methods/gold');
    expect(JSON.parse(options.body)).toMatchObject({
      name: 'Citi Double Cash Card', type: 'Credit', catalog_card_id: 'us-citi-double-cash', apply_catalog: true,
      include_store_rates: true, last4: '1001', category_rates: [{ store: 'eBay', rate: 2, points: 1.333333 }],
    });
  });

  it('keeps the card\'s last 4 digits when an edit is saved', async () => {
    await openEdit();
    expect(screen.getByDisplayValue('1001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body).last4).toBe('1001');
  });

  it('Undo puts the original link and name back', async () => {
    await openEdit();
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Search the card list'), { target: { value: 'double cash' } });
    fireEvent.click(screen.getByRole('button', { name: /Citi Double Cash® Card/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByDisplayValue('American Express Gold Card')).toBeTruthy();
    expect(screen.queryByText(/Saving switches this card's rates/)).toBeNull();
  });
});

describe('"Credit cards were reworked" notice', () => {
  const legacyGold = {
    id: 'gold', name: 'My Gold', type: 'Credit', reward_type: 'cashback', default_cashback_rate: 1,
    preset_card_id: 'amex-gold', last4: '1001', total_spend: 0, rework_prompt_state: null,
    // Dining 4 is the old built-in rate; "eBay 2" is one the user added.
    category_rates: [{ store: 'Dining', rate: 4 }, { store: 'eBay', rate: 2 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCatalogCacheForTests();
    savedMethods = [legacyGold];
    onWrite = () => Promise.resolve(json({}));
    mocks.apiFetch.mockImplementation(route);
  });

  it('offers to switch an old preset card to points', async () => {
    render(<PaymentMethods />);
    expect(await screen.findByText('Credit cards were reworked')).toBeTruthy();
    expect(screen.getByText(/Earns Membership Rewards points/)).toBeTruthy();
  });

  it('"Switch to points" saves catalog rates, keeps the user\'s own store rate and answers the notice', async () => {
    render(<PaymentMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to points' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, options] = writes()[0];
    expect(path).toBe('/api/payment-methods/gold');
    expect(options.method).toBe('PUT');
    const body = JSON.parse(options.body);
    // The server fills the catalog's rates; the client sends only the
    // user's own store rate (Dining 4 was the old built-in one).
    expect(body).toEqual({
      name: 'My Gold', type: 'Credit', catalog_card_id: 'us-amex-gold', apply_catalog: true,
      include_store_rates: true, point_value_cents: 1, category_rates: [{ store: 'eBay', rate: 2 }],
      rework_prompt_state: 'switched',
    });
  });

  it('"Keep as is" only records the answer', async () => {
    render(<PaymentMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep as is' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, options] = writes()[0];
    expect(path).toBe('/api/payment-methods/gold/rework-prompt');
    expect(JSON.parse(options.body)).toEqual({ state: 'kept' });
  });

  it('never shows for answered, catalog or custom cards', async () => {
    savedMethods = [
      { ...legacyGold, id: 'a', rework_prompt_state: 'kept' },
      { ...legacyGold, id: 'b', catalog_card_id: 'us-amex-gold', rework_prompt_state: 'switched' },
      { ...legacyGold, id: 'c', preset_card_id: null },
    ];
    render(<PaymentMethods />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/card-catalog'));
    await screen.findAllByText('My Gold');
    expect(screen.queryByText('Credit cards were reworked')).toBeNull();
  });
});
