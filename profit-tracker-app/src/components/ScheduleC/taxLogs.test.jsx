// The worksheet's own logs: mileage (line 9), equipment (lines 13 and 22) and
// the simplified home office (line 30).
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MileageLog } from './MileageLog';
import { EquipmentList } from './EquipmentList';
import { HomeOffice } from './HomeOffice';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({ apiFetch: mocks.apiFetch }));

const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => structuredClone(body) });
let trips; let assets; let calls;
beforeEach(() => {
  trips = []; assets = []; calls = [];
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockImplementation(async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (options.method) calls.push({ path, method: options.method, body });
    if (path.startsWith('/api/schedule-c/mileage')) {
      if (options.method === 'POST') trips = [{ id: `t${trips.length + 1}`, ...body, parking_tolls: body.parking_tolls }, ...trips];
      if (options.method === 'DELETE') trips = trips.filter((t) => !path.endsWith(t.id));
      return json({ year: 2026, trips });
    }
    if (path.startsWith('/api/schedule-c/assets')) {
      if (options.method === 'POST') assets = [{ id: `a${assets.length + 1}`, ...body, this_year: body.cost }, ...assets];
      return json({ year: 2026, assets });
    }
    if (path.startsWith('/api/schedule-c/years/')) return json({ year: 2026, ...body });
    throw new Error(`Unexpected ${path}`);
  });
});
afterEach(cleanup);

const mileage = { trips: 0, miles: '0.0', mileageAmount: '0.00', parkingTolls: '0.00', total: '0.00', byRate: [], rateMissing: false };
const vehicle = { inService: null, businessMiles: '0.0', commutingMiles: null, otherMiles: null };
const assetSummary = { count: 0, depreciation: '0.00', section179: '0.00', section179Claimed: '0.00', section179Carryover: '0.00', deMinimis: '0.00', line13: '0.00', midQuarter: false };

describe('MileageLog', () => {
  it('checks a trip, adds it, and refreshes the worksheet', async () => {
    const onSaved = vi.fn();
    render(<MileageLog year={2026} mileage={mileage} vehicle={vehicle} onSaved={onSaved} />);
    expect(await screen.findByText('No trips logged for 2026 yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a trip' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-10' } });
    fireEvent.change(screen.getByLabelText('Business miles (round trip)'), { target: { value: '12.55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add trip' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the miles, like 12 or 12.5.');
    fireEvent.change(screen.getByLabelText('Business miles (round trip)'), { target: { value: '12.5' } });
    fireEvent.change(screen.getByLabelText('Where you went'), { target: { value: 'Post office' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add trip' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter why you went');
    fireEvent.change(screen.getByLabelText('Why (business purpose)'), { target: { value: 'Ship orders' } });
    fireEvent.change(screen.getByLabelText('Parking and tolls (optional)'), { target: { value: '3.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add trip' }));
    expect(await screen.findByText(/Post office/)).toBeInTheDocument();
    expect(calls[0]).toEqual({ path: '/api/schedule-c/mileage', method: 'POST', body: { date: '2026-03-10', miles: '12.5', destination: 'Post office', purpose: 'Ship orders', parking_tolls: '3.50' } });
    expect(onSaved).toHaveBeenCalledTimes(1);
    // Delete asks first.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText('No trips logged for 2026 yet.')).toBeInTheDocument();
  });

  it('saves vehicle details for Part IV', async () => {
    render(<MileageLog year={2026} mileage={mileage} vehicle={vehicle} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Commuting miles in 2026'), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save vehicle details' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(calls.at(-1).body).toEqual({ vehicle_in_service: null, vehicle_commuting_miles: '1200', vehicle_other_miles: null });
  });
});

describe('EquipmentList', () => {
  it('explains each method and refuses what the rules don\'t allow', async () => {
    render(<EquipmentList year={2026} assets={assetSummary} onSaved={() => {}} />);
    await screen.findByText('No equipment in use by 2026 yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment' }));
    fireEvent.change(screen.getByLabelText('What it is'), { target: { value: 'Laptop' } });
    fireEvent.change(screen.getByLabelText('What it cost (with tax and shipping)'), { target: { value: '2600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment' }));
    expect(screen.getByRole('alert')).toHaveTextContent('up to $2,500');
    fireEvent.change(screen.getByLabelText('How to deduct it'), { target: { value: 'section_179' } });
    fireEvent.change(screen.getByLabelText('Business use'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment' }));
    expect(screen.getByRole('alert')).toHaveTextContent('more than 50% business use');
    fireEvent.change(screen.getByLabelText('How to deduct it'), { target: { value: 'macrs' } });
    expect(screen.getByLabelText('Spread over')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ name: 'Laptop', cost: '2600', business_percent: 40, method: 'macrs', recovery_years: 5, disposed_date: null });
    expect(await screen.findByText('Laptop')).toBeInTheDocument();
  });
});

describe('HomeOffice', () => {
  it('previews the deduction, caps it at 300 square feet, and saves', async () => {
    const onSaved = vi.fn();
    render(<HomeOffice year={2026} homeOffice={{ claimed: false, total: '0.00' }} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Square feet used for the business'), { target: { value: '400' } });
    expect(screen.getByText(/\$1,500\.00 before the limit \(only 300 square feet count\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Whole home, square feet (optional)'), { target: { value: '350' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save home office' }));
    expect(screen.getByRole('alert')).toHaveTextContent('bigger than the whole home');
    fireEvent.change(screen.getByLabelText('Square feet used for the business'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Months used in 2026'), { target: { value: '6' } });
    expect(screen.getByText(/\$375\.00 before the limit/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save home office' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[0].body).toEqual({ home_office_sq_ft: 150, home_office_months: 6, home_total_sq_ft: 350 });
  });

  it('explains the profit limit and can be removed', async () => {
    render(<HomeOffice year={2026} homeOffice={{ claimed: true, squareFeet: 300, months: 12, homeSquareFeet: null, beforeLimit: '1500.00', total: '400.00', limited: true }} onSaved={() => {}} />);
    expect(screen.getByText(/Only \$400\.00 of \$1,500\.00 counts/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    await waitFor(() => expect(calls[0].body).toEqual({ home_office_sq_ft: null, home_office_months: null }));
  });
});
