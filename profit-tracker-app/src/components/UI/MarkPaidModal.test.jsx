import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkPaidModal from './MarkPaidModal';

afterEach(cleanup);

const sale = { id: 'sale1', quantity: 2, unit_price: 150, commission_fee: 15, sale_shipping: 5 };

const open = (props = {}) => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(<MarkPaidModal open sale={sale} onSubmit={onSubmit} onClose={onClose} {...props} />);
  return { onSubmit, onClose };
};

const submitButton = () => screen.getByRole('button', { name: /Record Payment|Saving/ });

describe('MarkPaidModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<MarkPaidModal open={false} sale={sale} />);
    expect(container.firstChild).toBeNull();
  });

  // The payment date must be entered explicitly -- the server rejects a
  // mark_paid without one, and the plan forbids a one-click Mark Paid.
  it('leaves the payment date empty and cannot be submitted without it', () => {
    const { onSubmit } = open();
    expect(screen.getByLabelText('Payment date').value).toBe('');
    expect(submitButton().disabled).toBe(true);

    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('cannot be submitted when the amount is cleared', () => {
    const { onSubmit } = open();
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-02' } });
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '' } });

    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a negative amount', () => {
    open();
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-02' } });
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '-5' } });
    expect(submitButton().disabled).toBe(true);
  });

  it('prefills the amount with the sale\'s expected payout but still requires an explicit submit', () => {
    const { onSubmit } = open();
    // 2 x 150 - 15 commission - 5 shipping
    expect(screen.getByLabelText('Amount received').value).toBe('280.00');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('leaves the amount blank when the sale has no usable figures', () => {
    render(<MarkPaidModal open sale={{ id: 's' }} onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.getAllByLabelText('Amount received')[0].value).toBe('');
  });

  it('submits the date, amount and a null reference when none is given', () => {
    const { onSubmit } = open();
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-02' } });
    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith({ paid_date: '2026-10-02', amount: '280.00', reference: null });
  });

  it('submits an edited amount and a trimmed reference', () => {
    const { onSubmit } = open();
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-02' } });
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '275.5' } });
    fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: '  PAYOUT-7  ' } });
    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith({ paid_date: '2026-10-02', amount: '275.50', reference: 'PAYOUT-7' });
  });

  it('allows a zero payment', () => {
    const { onSubmit } = open();
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-02' } });
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '0' } });
    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith({ paid_date: '2026-10-02', amount: '0.00', reference: null });
  });

  it('cannot be submitted or dismissed while a save is in flight', () => {
    const { onSubmit, onClose } = open({ busy: true });
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-02' } });

    expect(submitButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('closes on Cancel when idle', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
