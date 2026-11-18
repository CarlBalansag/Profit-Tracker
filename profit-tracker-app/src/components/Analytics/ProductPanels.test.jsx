import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
    expect(screen.getByTitle('Nike → StockX: $38.00 per unit · 10 units · $380.00 total')).toHaveTextContent('+$38');
    expect(screen.getAllByText('—')).toHaveLength(1); // Amazon → StockX
  });

  it('says so when nothing sold', () => {
    render(<StoreRoutes routes={[]} />);
    expect(screen.getByText('No sold items in this period')).toBeInTheDocument();
  });
});
