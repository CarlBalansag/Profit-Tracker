import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WorkflowPipeline from './WorkflowPipeline';

afterEach(cleanup);

const pipeline = {
  stages: [
    {
      status: 'AWAITING_SHIPMENT', count: 3, value: 1440, itemCount: 2,
      items: [
        { id: 'sale-s1', name: 'PS5 Pro', party: 'EB', quantity: 2, value: 960, since: '2026-11-12T12:00:00Z' },
        { id: 'sale-s2', name: 'Xbox Series X', party: 'Points4Days', quantity: 1, value: 480, since: '2026-11-10T12:00:00Z' },
      ],
    },
    { status: 'OUTBOUND', count: 0, value: 0, itemCount: 0, items: [] },
    {
      status: 'PAID', count: 25, value: 12345, itemCount: 25,
      items: Array.from({ length: 20 }, (_, i) => ({ id: `sale-p${i}`, name: `Paid ${i}`, party: 'EB', quantity: 1, value: 100, since: null })),
    },
  ],
};

describe('WorkflowPipeline', () => {
  it('shows every step with its units and money, 0 included, in workflow order', () => {
    render(<WorkflowPipeline pipeline={pipeline} />);
    const steps = screen.getAllByRole('button', { expanded: false });
    expect(steps.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Sold — Waiting to Ship'),
      expect.stringContaining('Outbound'),
      expect.stringContaining('Paid'),
    ]);
    // Screen readers get the final numbers.
    expect(within(steps[0]).getByText('3', { selector: '.sr-only' })).toBeInTheDocument();
    expect(within(steps[0]).getByText('$1,440', { selector: '.sr-only' })).toBeInTheDocument();
    expect(within(steps[2]).getByText('$12,345', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('leaves out steps at 0 when asked (the All tab)', () => {
    render(<WorkflowPipeline pipeline={pipeline} hideEmpty />);
    expect(screen.queryByRole('button', { name: /^Outbound/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Paid/ })).toBeInTheDocument();
  });

  it('lists a step\'s items when clicked, and closes on a second click', async () => {
    const onNavigate = vi.fn();
    render(<WorkflowPipeline pipeline={pipeline} onNavigate={onNavigate} />);
    const step = screen.getByRole('button', { name: /Sold — Waiting to Ship/ });
    fireEvent.click(step);
    expect(step).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('PS5 Pro ×2')).toBeInTheDocument();
    expect(screen.getByText('Points4Days')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Xbox Series X'));
    expect(onNavigate).toHaveBeenCalledWith('/statuses');

    fireEvent.click(step);
    expect(step).toHaveAttribute('aria-expanded', 'false');
    // The list shrinks away rather than vanishing at once.
    await waitFor(() => expect(screen.queryByText('PS5 Pro ×2')).not.toBeInTheDocument());
  });

  it('says when a step lists only its newest items, and when a step is empty', () => {
    render(<WorkflowPipeline pipeline={pipeline} />);
    fireEvent.click(screen.getByRole('button', { name: /^Paid/ }));
    expect(screen.getByText('Newest 20 of 25')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Outbound/ }));
    expect(screen.getByText('Nothing in this step.')).toBeInTheDocument();
  });

  it('says so when no step has anything in it', () => {
    render(<WorkflowPipeline pipeline={{ stages: [{ status: 'PAID', count: 0, value: 0, itemCount: 0, items: [] }] }} hideEmpty />);
    expect(screen.getByText('Nothing in any step right now.')).toBeInTheDocument();
    cleanup();
    render(<WorkflowPipeline pipeline={undefined} />);
    expect(screen.getByText('Nothing in any step right now.')).toBeInTheDocument();
  });

  it('keeps the step row the same height with or without steps', () => {
    const { container } = render(<WorkflowPipeline pipeline={pipeline} />);
    expect(container.firstChild.firstChild).toHaveClass('h-[148px]');
    cleanup();
    const empty = render(<WorkflowPipeline pipeline={{ stages: [] }} hideEmpty />);
    expect(empty.container.firstChild.firstChild).toHaveClass('h-[148px]');
  });
});
