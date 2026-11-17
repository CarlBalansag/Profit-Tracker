import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfitCalendar from './ProfitCalendar';

const days = [
  { date: '2026-11-15', profit: 552.05, revenue: 1240, cost: 700, sales: 3, units: 4 },
  { date: '2026-11-16', profit: -40.5, revenue: 100, cost: 140.5, sales: 1, units: 1 },
];
const dayCells = (container) => container.querySelectorAll('[data-day]');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ProfitCalendar', () => {
  it('shows exactly the last 7 days for 7 Days', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    const cells = dayCells(container);
    expect(cells).toHaveLength(7);
    expect(cells[0].dataset.day).toBe('2026-11-11');
    expect(cells[6].dataset.day).toBe('2026-11-17');
  });

  it('shows exactly the last 30 days for 30 Days', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="30 Days" />);
    const cells = dayCells(container);
    expect(cells).toHaveLength(30);
    expect(cells[0].dataset.day).toBe('2026-10-19');
  });

  it('shows every day since Jan 1 for YTD, and the last 365 for All Time', () => {
    const ytd = render(<ProfitCalendar calendar={{ days }} dateRange="YTD" />);
    expect(dayCells(ytd.container)).toHaveLength(321);
    expect(dayCells(ytd.container)[0].dataset.day).toBe('2026-01-01');
    cleanup();
    const all = render(<ProfitCalendar calendar={{ days }} dateRange="All Time" />);
    expect(dayCells(all.container)).toHaveLength(365);
  });

  it('shows a day\'s profit, sales, revenue and cost on hover', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    fireEvent.mouseEnter(container.querySelector('[data-day="2026-11-15"]'));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Sun, Nov 15, 2026');
    expect(tip).toHaveTextContent('+$552.05 profit');
    expect(tip).toHaveTextContent('3 sales · 4 units');
    expect(tip).toHaveTextContent('Revenue $1,240.00 · Cost $700.00');
  });

  it('calls a losing day a loss, and an empty day no sales', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    fireEvent.mouseEnter(container.querySelector('[data-day="2026-11-16"]'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('−$40.50 loss');
    fireEvent.mouseEnter(container.querySelector('[data-day="2026-11-12"]'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('No sales');
  });

  it('sums the range and names the best day', () => {
    render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    expect(screen.getByText(/over 2 days with sales/)).toBeInTheDocument();
    expect(screen.getByText(/Best day Nov 15/)).toBeInTheDocument();
  });

  it('still draws from an older saved copy that is a bare list of days', () => {
    const { container } = render(<ProfitCalendar calendar={[{ date: '2026-11-15', profit: 10, sales: 1 }]} dateRange="7 Days" />);
    expect(dayCells(container)).toHaveLength(7);
    fireEvent.mouseEnter(container.querySelector('[data-day="2026-11-15"]'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('1 sale');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('undefined');
  });
});
