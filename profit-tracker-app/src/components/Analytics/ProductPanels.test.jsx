import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfitShare, PriceBands, StoreRoutes } from './ProductPanels';

afterEach(cleanup);

const store = (name, profit) => ({ id: name, name, profit, unitsSold: 1 });

describe('ProfitShare', () => {
  it('splits profit by store, folds the rest into Other, and lists stores that lost money', () => {
    render(<ProfitShare stores={[
      store('Nike', 480), store('Amazon', 270), store('Target', 150), store('Walmart', 60), store('Costco', 40), store('Best Buy', -40),
    ]} />);
    expect(screen.getByRole('img', { name: 'Nike 48%, Amazon 27%, Target 15%, Walmart 6%, Other (1) 4%' })).toBeInTheDocument();
    expect(screen.getByText('Other (1)')).toBeInTheDocument();
    expect(screen.getByText(/Lost money:/)).toHaveTextContent('Best Buy −$40.00');
  });

  it('says so when nothing made a profit', () => {
    render(<ProfitShare stores={[store('Best Buy', -40)]} />);
    expect(screen.getByText('No profit from sales in this period')).toBeInTheDocument();
  });
});

describe('PriceBands', () => {
  const band = (key, label, over = {}) => ({ key, label, revenue: 0, cost: 0, profit: 0, unitsSold: 0, salesCount: 0, margin: null, roi: null, ...over });
  it('shows margin, units and profit per range, and names the best one', () => {
    render(<PriceBands bands={[
      band('under50', 'Under $50', { unitsSold: 62, profit: 210, margin: 7.1, roi: 8 }),
      band('50to150', '$50–150', { unitsSold: 41, profit: 640, margin: 12.4, roi: 14 }),
      band('150to300', '$150–300', { unitsSold: 27, profit: 990, margin: 18, roi: 22.5 }),
      band('over300', '$300+'),
    ]} />);
    expect(screen.getByText('18.0%')).toBeInTheDocument();
    expect(screen.getByText('Nothing sold')).toBeInTheDocument();
    expect(screen.getByText(/Best margin:/)).toHaveTextContent('Best margin: $150–300 items, 22.5% ROI.');
  });
});

describe('StoreRoutes', () => {
  const route = (st, ch, ppu, units) => ({ store: st, channel: ch, channelType: 'Marketplace', profitPerUnit: ppu, unitsSold: units, profit: ppu * units, salesCount: units });
  it('shows profit per unit for each store and place sold, with a dash where nothing went', () => {
    render(<StoreRoutes routes={[
      route('Nike', 'StockX', 38, 10), route('Nike', 'eBay', 22, 4), route('Amazon', 'eBay', 12, 6),
    ]} />);
    expect(screen.getByRole('columnheader', { name: 'StockX' })).toBeInTheDocument();
    // The wide grid and the phone list are both in the page; CSS shows one.
    const [gridCell, chip] = screen.getAllByTitle('Nike → StockX: $38.00 per unit · 10 units · $380.00 total');
    expect(gridCell).toHaveAttribute('role', 'button');
    expect(gridCell).toHaveTextContent('+$38');
    expect(chip).toHaveTextContent('StockX +$38 · 10u');
    expect(screen.getAllByText('—')).toHaveLength(1); // Amazon → StockX, grid only
    // Each store's best route is outlined in both, and only when it has a choice.
    expect(gridCell.style.outline).toContain('solid');
    expect(screen.getAllByTitle(/^Amazon → eBay/)[0].style.outline).toBe('none');
  });

  it('opens a route below the grid with the math and the sales behind it, and closes again', async () => {
    const withSales = {
      ...route('Best Buy', 'Windy City', 28, 12),
      profit: 336, revenue: 3060, cost: 2760, cashback: 36,
      items: [
        { id: 's1', product: 'iPad Air 11"', date: '2026-10-02', units: 10, revenue: 2550, cost: 2300, cashback: 30, profit: 280 },
        { id: 's2', product: 'Switch OLED', date: '2026-09-15', units: 2, revenue: 510, cost: 460, cashback: 6, profit: 56 },
      ],
    };
    render(<StoreRoutes routes={[withSales]} />);
    const [square] = screen.getAllByTitle(/^Best Buy → Windy City/);
    fireEvent.click(square);
    const panel = screen.getByRole('region', { name: 'Best Buy to Windy City' });
    expect(panel).toHaveTextContent('$336.00 profit ÷ 12 units = +$28.00 per unit');
    expect(panel).toHaveTextContent('Profit = $3,060.00 paid to you (after fees) − $2,760.00 item cost + $36.00 card cashback');
    expect(panel).toHaveTextContent('Units are the items bought at Best Buy that sold on Windy City this period, less any returned.');
    expect(within(panel).getByText('iPad Air 11"')).toBeInTheDocument();
    expect(within(panel).getByText('+$56.00')).toBeInTheDocument();
    expect(square).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close route details' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('opens a route with the keyboard', () => {
    render(<StoreRoutes routes={[route('Nike', 'StockX', 38, 10)]} />);
    fireEvent.keyDown(screen.getAllByTitle(/^Nike → StockX/)[0], { key: 'Enter' });
    expect(screen.getByRole('region', { name: 'Nike to StockX' })).toBeInTheDocument();
  });

  it('says so when nothing sold', () => {
    render(<StoreRoutes routes={[]} />);
    expect(screen.getByText('No sold items in this period')).toBeInTheDocument();
  });
});
