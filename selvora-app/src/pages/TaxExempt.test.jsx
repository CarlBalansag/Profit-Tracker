import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TaxExempt from './TaxExempt';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({ apiFetch: mocks.fetch }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const sale = (id, product, year, taxable, customer_tax_exempt, purchaseExempt = false) => ({ id, sale_date: `${year}-09-01`, quantity: 1, unit_price: 20, status: 'SOLD', taxable, customer_tax_exempt, inventory: { product_name: product, tax_exempt: purchaseExempt, unit_purchase_cost: 10 } });
describe('tax reporting reconciliation', () => {
  it('includes exempt customer sales from taxed purchases and scopes the percentage denominator to the period', async () => {
    const sales = [sale('a', 'Non-taxable product', 2026, false, false), sale('b', 'Customer-exempt product', 2026, true, true), sale('c', 'Ordinary taxed product', 2026, true, false), sale('d', 'Prior exempt purchase', 2025, true, false, true)];
    mocks.fetch.mockImplementation(async path => new Response(JSON.stringify(path === '/api/sales' ? sales : [])));
    render(<TaxExempt />);
    await waitFor(() => expect(screen.getByText('25.0%')).toBeTruthy());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '2026' } });
    expect(screen.getByText('33.3%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Sales/ }));
    expect(screen.getByText('Non-taxable product')).toBeTruthy();
    expect(screen.getByText('Customer-exempt product')).toBeTruthy();
    expect(screen.queryByText('Ordinary taxed product')).toBeNull();
    expect(screen.queryByText('Prior exempt purchase')).toBeNull();
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '4' } });
    expect(screen.getByText('0.0%')).toBeTruthy();
    expect(screen.queryByText('Non-taxable product')).toBeNull();
  });
  it('renders an empty reporting period without invalid totals', async () => {
    mocks.fetch.mockImplementation(async () => new Response('[]'));
    render(<TaxExempt />);
    await waitFor(() => expect(screen.getByText('0.0%')).toBeTruthy());
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
  });
});
