import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CalendarEventModal from './Calendar/CalendarEventModal';
import { CustomCardModal } from './Settings/CustomCardModal';
import { QuickAddModal } from './Settings/QuickAddModal';
import ProductNoteButton from './ProductNoteButton';

const mocks = vi.hoisted(() => ({ update: vi.fn(), note: 'Saved note', saveNote: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  useCalendarMutations: () => ({ create: { mutateAsync: vi.fn() }, update: { mutateAsync: mocks.update }, remove: { mutateAsync: vi.fn() } }),
  useProductNote: () => ({ data: { note: mocks.note } }),
  useProductNoteMutations: () => ({ upsert: { mutate: mocks.saveNote }, remove: { mutate: vi.fn() } }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('modal initialization without synchronization effects', () => {
  it('discards cancelled calendar drafts and changes the selected record cleanly', () => {
    const props = { open: true, event: { id: 'a', title: 'Saved event', date: '2026-09-12' }, onClose: vi.fn() };
    const view = render(<CalendarEventModal {...props} />);
    fireEvent.change(screen.getByDisplayValue('Saved event'), { target: { value: 'Draft' } });
    view.rerender(<CalendarEventModal {...props} open={false} />);
    view.rerender(<CalendarEventModal {...props} />);
    expect(screen.getByDisplayValue('Saved event')).toBeTruthy();
    view.rerender(<CalendarEventModal {...props} event={{ id: 'b', title: 'Other event', date: '2026-09-13' }} />);
    expect(screen.getByDisplayValue('Other event')).toBeTruthy();
  });
  it('preserves calendar draft on failed save and permits retry', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Save failed')).mockResolvedValueOnce({});
    const close = vi.fn();
    render(<CalendarEventModal open event={{ id: 'a', title: 'Saved event', date: '2026-09-12' }} onClose={close} />);
    fireEvent.change(screen.getByDisplayValue('Saved event'), { target: { value: 'Edited event' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.getByText('Save failed')).toBeTruthy());
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[1][0]).toMatchObject({ title: 'Edited event' });
  });
  it('reopens card edits from saved values including zero and clears validation for new cards', () => {
    const props = { isOpen: true, onClose: vi.fn(), onAddCard: vi.fn(), cardToEdit: { id: 'a', name: 'Saved card', credit_limit: 0, min_payment_pct: 0 } };
    const view = render(<CustomCardModal {...props} />);
    expect(document.querySelector('input[name="credit_limit"]').value).toBe('0');
    fireEvent.change(screen.getByDisplayValue('Saved card'), { target: { value: 'Draft' } });
    view.rerender(<CustomCardModal {...props} isOpen={false} />);
    view.rerender(<CustomCardModal {...props} />);
    expect(screen.getByDisplayValue('Saved card')).toBeTruthy();
    view.rerender(<CustomCardModal {...props} cardToEdit={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));
    expect(screen.getByText('Card name is required')).toBeTruthy();
    expect(props.onAddCard).not.toHaveBeenCalled();
  });
  it('resets quick-add search after dismissal', () => {
    const props = { isOpen: true, onClose: vi.fn(), onAddCards: vi.fn() };
    const view = render(<QuickAddModal {...props} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No matching card' } });
    view.rerender(<QuickAddModal {...props} isOpen={false} />);
    view.rerender(<QuickAddModal {...props} />);
    expect(screen.getByRole('textbox').value).toBe('');
  });
  it('loads the saved product note on reopening and retains a draft during data refresh', () => {
    const view = render(<ProductNoteButton productName="Fixture" />);
    fireEvent.click(screen.getByTitle(/note/i));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft note' } });
    mocks.note = 'Refreshed note';
    view.rerender(<ProductNoteButton productName="Fixture" />);
    expect(screen.getByRole('textbox').value).toBe('Draft note');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    fireEvent.click(screen.getByTitle(/note/i));
    expect(screen.getByRole('textbox').value).toBe('Refreshed note');
    mocks.note = 'Saved note';
  });
});
