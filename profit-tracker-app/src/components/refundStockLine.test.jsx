import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import RefundsPanel from './RefundsPanel';

let refunds = [];

vi.mock('../hooks/useApi', () => ({
  useRefunds: () => ({ data: refunds, isLoading: false }),
  useRefundMutations: () => ({ add: {}, remove: {} }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const refund = (over) => ({ id: 'r1', amount: 100, quantity: 0, date: '2026-11-03', note: null, ...over });

afterEach(() => {
  cleanup();
  refunds = [];
});

describe('store refund stock line', () => {
  it('says every unit is still available when nothing was sent back', () => {
    refunds = [refund()];
    render(<RefundsPanel kind="purchase" id="p1" maxUnits={10} />);
    expect(screen.getByText('10 units still available to sell · 0 sent back')).toBeTruthy();
  });

  it('counts what went back when 10 of 20 were sent', () => {
    refunds = [refund({ quantity: 10 })];
    render(<RefundsPanel kind="purchase" id="p1" maxUnits={10} />);
    expect(screen.getByText('10 units still available to sell · 10 sent back')).toBeTruthy();
  });

  it('stays out of the way before any refund and on sales', () => {
    const { rerender } = render(<RefundsPanel kind="purchase" id="p1" maxUnits={10} />);
    expect(screen.queryByText(/still available to sell ·/)).toBeNull();
    refunds = [refund()];
    rerender(<RefundsPanel kind="sale" id="s1" maxUnits={2} />);
    expect(screen.queryByText(/still available to sell ·/)).toBeNull();
  });
});
