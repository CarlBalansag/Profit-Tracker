import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StatusPipeline from './StatusPipeline';

afterEach(cleanup);

const statuses = [
  { key: 'PURCHASED', count: 2 },
  { key: 'INBOUND', count: 0 },
  { key: 'WAITING_FOR_PAYMENT', count: 5 },
];

const tile = (name) => screen.getByRole('button', { name: new RegExp(name) });

describe('StatusPipeline', () => {
  it('renders one tile per given status, labelled from the shared vocabulary', () => {
    render(<StatusPipeline statuses={statuses} onSelect={() => {}} />);
    expect(screen.getByText('Purchased')).toBeTruthy();
    expect(screen.getByText('Inbound')).toBeTruthy();
    expect(screen.getByText('Waiting for Payment')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('shows each status count, including zero', () => {
    render(<StatusPipeline statuses={statuses} onSelect={() => {}} />);
    expect(tile('Purchased').textContent).toContain('2');
    expect(tile('Inbound').textContent).toContain('0');
    expect(tile('Waiting for Payment').textContent).toContain('5');
  });

  it('accepts a caller-supplied label instead of the vocabulary one', () => {
    render(<StatusPipeline statuses={[{ key: '__UNASSIGNED__', label: 'No status yet', count: 1 }]} onSelect={() => {}} />);
    expect(screen.getByText('No status yet')).toBeTruthy();
  });

  it('calls onSelect with the clicked status key', () => {
    const onSelect = vi.fn();
    render(<StatusPipeline statuses={statuses} onSelect={onSelect} />);
    fireEvent.click(tile('Waiting for Payment'));
    expect(onSelect).toHaveBeenCalledWith('WAITING_FOR_PAYMENT');
  });

  it('clears the filter by calling onSelect(null) when the active tile is clicked again', () => {
    const onSelect = vi.fn();
    render(<StatusPipeline statuses={statuses} activeKey="PURCHASED" onSelect={onSelect} />);
    expect(tile('Purchased').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tile('Purchased'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('marks only the active tile as pressed', () => {
    render(<StatusPipeline statuses={statuses} activeKey="INBOUND" onSelect={() => {}} />);
    expect(tile('Inbound').getAttribute('aria-pressed')).toBe('true');
    expect(tile('Purchased').getAttribute('aria-pressed')).toBe('false');
  });

  it('is a read-only summary when no onSelect is given', () => {
    render(<StatusPipeline statuses={statuses} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(buttons[0].getAttribute('aria-pressed')).toBeNull();
  });

  it('renders nothing for an empty status list', () => {
    const { container } = render(<StatusPipeline statuses={[]} onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
