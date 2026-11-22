import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TodoItem from './TodoItem';

const mocks = vi.hoisted(() => ({ accept: vi.fn(), reject: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({
  useEmailOrderMutations: () => ({
    accept: { mutateAsync: mocks.accept, isPending: false },
    reject: { mutateAsync: mocks.reject, isPending: false },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const entry = {
  key: 'email-review:o1:m1', type: 'email_review', group: 'cashout', urgency: 'info', amount: 85,
  title: 'Is this Points4Days email #190261 your sale?', detail: 'Your sale: Amazon Echo Dot · Sale already marked paid',
  email_match: { id: 'm1', order_id: 'o1' }, link: { kind: 'page', to: '/settings', state: { tab: 'email' } }, actions: ['snooze', 'dismiss'],
};
const show = () => render(<MemoryRouter><ul><TodoItem entry={entry} busy={false} onAct={vi.fn()} onEdit={vi.fn()} /></ul></MemoryRouter>);

describe('an order from email on the To-Do', () => {
  it('is answered right there: Yes, link or Not this', async () => {
    mocks.accept.mockResolvedValue({ linked: true });
    show();
    expect(screen.getByText('Is this Points4Days email #190261 your sale?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Yes, link/ }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith('m1'));
    expect(mocks.success).toHaveBeenCalledWith('Linked');

    mocks.reject.mockRejectedValue(new Error('This match is no longer available.'));
    fireEvent.click(screen.getByRole('button', { name: /Not this/ }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('This match is no longer available.'));
  });
});
