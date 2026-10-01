import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useModalKeyboard } from './useModalKeyboard';

// jsdom has no layout engine, so offsetParent is always null. Real browsers use it
// to skip hidden elements in the focus trap; shim it here so that check is exercised.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    get() { return this.parentElement; },
    configurable: true,
  });
});

function TestModal({ isOpen, onClose }) {
  const ref = useModalKeyboard(isOpen, onClose);
  if (!isOpen) return null;
  return (
    <div ref={ref} role="dialog">
      <button>First</button>
      <button>Middle</button>
      <button>Last</button>
    </div>
  );
}

function Harness({ onClose }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open trigger</button>
      <TestModal isOpen={open} onClose={() => { onClose?.(); setOpen(false); }} />
    </div>
  );
}

// Mirrors ExpenseModal: a close button rendered before the field that should
// actually receive initial focus (e.g. a name input), wired via initialFocusRef
// instead of a second, independently-timed focus() call.
function TestModalWithPreferredFocus({ isOpen, onClose }) {
  const nameRef = useRef(null);
  const ref = useModalKeyboard(isOpen, onClose, nameRef);
  if (!isOpen) return null;
  return (
    <div ref={ref} role="dialog">
      <button>Close</button>
      <input ref={nameRef} placeholder="Name" />
    </div>
  );
}

function PreferredFocusHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open trigger</button>
      <TestModalWithPreferredFocus isOpen={open} onClose={() => setOpen(false)} />
    </div>
  );
}

afterEach(cleanup);

describe('useModalKeyboard', () => {
  it('moves focus into the modal on open', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open trigger'));
    return vi.waitFor(() => expect(document.activeElement).toBe(screen.getByText('First')));
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText('Open trigger'));
    await vi.waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus within the modal, wrapping from last back to first', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open trigger'));
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByText('First')));

    screen.getByText('Last').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('traps Shift+Tab from the first element back to the last', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open trigger'));
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByText('First')));

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last'));
  });

  it('focuses the given initialFocusRef instead of the first focusable element', async () => {
    render(<PreferredFocusHarness />);
    fireEvent.click(screen.getByText('Open trigger'));
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText('Name')));
    // The close button is first in DOM order but must never receive initial
    // focus here -- Space on a focused button activates it, so if focus ever
    // lands there this keypress would close the modal instead of typing.
    expect(document.activeElement).not.toBe(screen.getByText('Close'));
  });

  it('restores focus to the trigger element after closing', async () => {
    render(<Harness />);
    const trigger = screen.getByText('Open trigger');
    trigger.focus();
    fireEvent.click(trigger);
    await vi.waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    fireEvent.keyDown(document, { key: 'Escape' });
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
