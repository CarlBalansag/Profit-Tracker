import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfitCalendar from './ProfitCalendar';

const items15 = [
  { id: 'a', product: 'Jordan 4 Bred', platform: 'StockX', units: 1, revenue: 840, cost: 400, profit: 452.05 },
  { id: 'b', product: 'AirPods Pro 2', platform: 'eBay', units: 2, revenue: 400, cost: 300, profit: 100 },
];
const days = [
  { date: '2026-11-15', profit: 552.05, revenue: 1240, cost: 700, sales: 2, units: 3, items: items15 },
  { date: '2026-11-16', profit: -40.5, revenue: 100, cost: 140.5, sales: 1, units: 1,
    items: [{ id: 'c', product: 'PS5 Slim', platform: null, units: 1, revenue: 100, cost: 140.5, profit: -40.5 }] },
];
const dayCells = (container) => container.querySelectorAll('[data-day]');
const cell = (container, key) => container.querySelector(`[data-day="${key}"]`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ProfitCalendar range', () => {
  it('shows exactly the last 7 days for 7 Days', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    const cells = dayCells(container);
    expect(cells).toHaveLength(7);
    expect(cells[0].dataset.day).toBe('2026-11-11');
    expect(cells[6].dataset.day).toBe('2026-11-17');
  });

  it('shows exactly the last 30 days for 30 Days', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="30 Days" />);
    expect(dayCells(container)).toHaveLength(30);
    expect(dayCells(container)[0].dataset.day).toBe('2026-10-19');
  });

  it('shows every day since Jan 1 for YTD', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="YTD" />);
    expect(dayCells(container)).toHaveLength(321);
    expect(dayCells(container)[0].dataset.day).toBe('2026-01-01');
  });

  it('shows only the days with sales for All Time, so a new account has just a few squares', () => {
    const { container } = render(<ProfitCalendar calendar={{ from: '2026-11-15', to: '2026-11-17', days }} dateRange="All Time" />);
    expect(Array.from(dayCells(container)).map((c) => c.dataset.day)).toEqual(['2026-11-15', '2026-11-16']);
    expect(screen.getByText(/Only the days you made sales, since your first on Nov 15, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Nov')).toBeInTheDocument();
  });

  it('groups years of sale days by month, oldest first, with each month\'s total and the year', () => {
    const history = [
      { date: '2024-03-02', profit: 12, sales: 1, units: 1, revenue: 50, cost: 38, items: [] },
      { date: '2024-03-20', profit: -2, sales: 1, units: 1, revenue: 10, cost: 12, items: [] },
      { date: '2025-07-04', profit: 0, sales: 0, units: 0, revenue: 0, cost: 0, items: [] },
      ...days,
    ];
    const { container } = render(<ProfitCalendar calendar={{ from: '2024-03-02', to: '2026-11-17', days: history }} dateRange="All Time" />);
    expect(dayCells(container)).toHaveLength(4); // the no-sales day is left out
    expect(screen.getByText('Mar 2024')).toBeInTheDocument();
    expect(screen.getByText('+$10.00')).toBeInTheDocument();
    expect(screen.getByText('Nov 2026')).toBeInTheDocument();
    expect(screen.queryByText('Jul 2025')).toBeNull();
  });

  it('says so when there are no sales at all', () => {
    render(<ProfitCalendar calendar={{ from: '2026-11-17', to: '2026-11-17', days: [] }} dateRange="All Time" />);
    expect(screen.getByText('No sales yet.')).toBeInTheDocument();
  });
});

describe('ProfitCalendar details', () => {
  it('shows a day\'s totals on hover', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    fireEvent.mouseEnter(cell(container, '2026-11-15'));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Sun, Nov 15, 2026');
    expect(tip).toHaveTextContent('+$552.05 profit');
    expect(tip).toHaveTextContent('2 sales · 3 units');
    expect(tip).toHaveTextContent('Revenue $1,240.00 · Cost $700.00');
  });

  it('opens what sold on a day when it is clicked, and closes again', async () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    fireEvent.click(cell(container, '2026-11-15'));
    const panel = screen.getByRole('region', { name: /Sales on Sun, Nov 15, 2026/ });
    expect(within(panel).getByText('Jordan 4 Bred')).toBeInTheDocument();
    expect(within(panel).getByText('StockX')).toBeInTheDocument();
    expect(within(panel).getByText('+$452.05')).toBeInTheDocument();
    expect(within(panel).getByText('eBay · 2 units')).toBeInTheDocument();
    expect(cell(container, '2026-11-15')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close day details' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('shows a losing day\'s sale as a loss, and opens with the keyboard', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    fireEvent.keyDown(cell(container, '2026-11-16'), { key: 'Enter' });
    const panel = screen.getByRole('region');
    expect(within(panel).getByText('loss')).toBeInTheDocument();
    expect(within(panel).getAllByText(/−\$40\.50/).length).toBeGreaterThan(0);
    expect(within(panel).getByText('PS5 Slim')).toBeInTheDocument();
    expect(within(panel).getByText('Direct')).toBeInTheDocument();
  });

  it('says so when a day without sales is clicked', () => {
    const { container } = render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    fireEvent.click(cell(container, '2026-11-12'));
    expect(screen.getByText('No sales on this day.')).toBeInTheDocument();
  });

  it('closes the panel when the date filter changes', async () => {
    const { container, rerender } = render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    fireEvent.click(cell(container, '2026-11-15'));
    rerender(<ProfitCalendar calendar={{ days }} dateRange="30 Days" />);
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('sums the range and names the best and worst days', () => {
    render(<ProfitCalendar calendar={{ days }} dateRange="7 Days" />);
    expect(screen.getByText(/over 2 days with sales/)).toBeInTheDocument();
    expect(screen.getByText(/Best day Nov 15/)).toBeInTheDocument();
    expect(screen.getByText(/Worst day Nov 16/)).toBeInTheDocument();
  });

  it('still draws from an older saved copy that is a bare list of days', () => {
    const { container } = render(<ProfitCalendar calendar={[{ date: '2026-11-15', profit: 10, sales: 1 }]} dateRange="7 Days" />);
    expect(dayCells(container)).toHaveLength(7);
    fireEvent.mouseEnter(cell(container, '2026-11-15'));
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('undefined');
    fireEvent.click(cell(container, '2026-11-15'));
    expect(screen.getByText('Refresh the page to see the sales for this day.')).toBeInTheDocument();
  });
});
