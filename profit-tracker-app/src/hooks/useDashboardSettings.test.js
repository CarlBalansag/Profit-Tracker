import { describe, expect, it } from 'vitest';
import { DEFAULT_DASHBOARD_SETTINGS } from '../data/dashboardRegistry';
import { mergeDashboardSettings } from './useDashboardSettings';

describe('mergeDashboardSettings', () => {
  it('drops retired dashboard options without resetting supported preferences', () => {
    const stored = {
      version: 6,
      defaultDateFilter: 'YTD',
      dashboardSections: DEFAULT_DASHBOARD_SETTINGS.dashboardSections,
      statCards: [
        { id: 'roi', visible: true, order: 0 },
        { id: 'totalCost', visible: false, order: 1 },
      ],
      pipelineCards: [
        { id: 'PAID', visible: false, order: 0 },
        { id: 'SHIPPED_IN', visible: false, order: 1 },
        { id: 'SHIPPED_OUT', visible: true, order: 2 },
        { id: 'COMPLETED', visible: true, order: 3 },
        { id: 'RETURNED', visible: true, order: 4 },
      ],
      chartSeries: DEFAULT_DASHBOARD_SETTINGS.chartSeries,
      recentSalesColumns: DEFAULT_DASHBOARD_SETTINGS.recentSalesColumns,
    };

    const merged = mergeDashboardSettings(stored);

    expect(merged.defaultDateFilter).toBe('YTD');
    expect(merged.pipelineCards.some(card => card.id === 'COMPLETED')).toBe(false);
    expect(merged.pipelineCards.some(card => card.id === 'SHIPPED_IN')).toBe(false);
    expect(merged.pipelineCards.some(card => card.id === 'SHIPPED_OUT')).toBe(false);
    expect(merged.pipelineCards.find(card => card.id === 'PAID')?.visible).toBe(false);
    expect(merged.pipelineCards.find(card => card.id === 'SHIPPED')?.visible).toBe(false);
    expect(merged.pipelineCards.find(card => card.id === 'SHIPPED')?.order).toBe(1);
    expect(merged.pipelineCards.find(card => card.id === 'IN_TRANSIT_OUT')?.visible).toBe(true);
    expect(merged.pipelineCards.find(card => card.id === 'IN_TRANSIT_OUT')?.order).toBe(2);
    expect(merged.pipelineCards.find(card => card.id === 'RETURNED')?.visible).toBe(true);
    expect(merged.pipelineCards.find(card => card.id === 'PENDING_PAYMENT')?.visible).toBe(true);
    expect(merged.statCards.find(card => card.id === 'roi')?.visible).toBe(true);
    expect(merged.statCards.find(card => card.id === 'totalCost')?.visible).toBe(false);
    expect(merged.statCards).toHaveLength(DEFAULT_DASHBOARD_SETTINGS.statCards.length);
    expect(merged.pipelineCards).toHaveLength(DEFAULT_DASHBOARD_SETTINGS.pipelineCards.length);
  });

  it('v7 puts Net Profit on the chart once and leaves the KPI choices of v6 settings alone', () => {
    const stored = {
      version: 6,
      statCards: [{ id: 'roi', visible: true, order: 0 }, { id: 'totalCost', visible: false, order: 1 }],
      chartSeries: [
        { id: 'totalRevenue', visible: true, order: 0 },
        { id: 'grossProfit', visible: true, order: 1 },
        { id: 'netProfit', visible: false, order: 2 },
      ],
    };
    const merged = mergeDashboardSettings(stored);
    expect(merged.version).toBe(7);
    expect(merged.chartSeries.find(s => s.id === 'netProfit').visible).toBe(true);
    expect(merged.chartSeries.find(s => s.id === 'grossProfit').visible).toBe(false);
    // The v6 KPI reset does not run again.
    expect(merged.statCards.find(c => c.id === 'roi').visible).toBe(true);
    expect(merged.statCards.find(c => c.id === 'totalCost').visible).toBe(false);

    // After the upgrade, a later choice to bring Gross Profit back is kept.
    const again = mergeDashboardSettings({ ...merged, chartSeries: merged.chartSeries.map(s => (s.id === 'grossProfit' ? { ...s, visible: true } : s)) });
    expect(again.chartSeries.find(s => s.id === 'grossProfit').visible).toBe(true);
  });
});
