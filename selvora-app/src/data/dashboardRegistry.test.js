import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DASHBOARD_SETTINGS,
  PIPELINE_CARD_REGISTRY,
  STAT_CARD_REGISTRY,
} from './dashboardRegistry';
import { INVENTORY_RECEIVING_STATUSES, SALE_STATUS_ORDER } from './statusWorkflow';

const require = createRequire(import.meta.url);
const { pipelineBucketOf } = require('../../../selvora-api/services/statusTransitions.js');

describe('dashboard summary card registry', () => {
  it('keeps every supported summary option and describes each one', () => {
    expect(Object.keys(STAT_CARD_REGISTRY)).toEqual([
      'totalCost',
      'totalCashback',
      'totalTax',
      'inventoryValue',
      'totalRevenue',
      'grossProfit',
      'profit',
      'roi',
      'netMargin',
      'avgSalePrice',
      'avgCostPerUnit',
      'inventoryQty',
      'unitsSold',
    ]);
    expect(Object.values(STAT_CARD_REGISTRY).every(card => Boolean(card.description))).toBe(true);
  });

  it('labels aggregate return as ROI and calculates averages per sold unit', () => {
    const stats = {
      totalRevenue: 500,
      soldCost: 200,
      salesCount: 2,
      unitsSold: 5,
    };

    expect(STAT_CARD_REGISTRY.roi.label).toBe('ROI');
    expect(STAT_CARD_REGISTRY.avgSalePrice.getValue(stats)).toBe('$100.00');
    expect(STAT_CARD_REGISTRY.avgCostPerUnit.getValue(stats)).toBe('$40.00');
    expect(STAT_CARD_REGISTRY.totalRevenue.getSubtext(stats)).toBe('5 units sold');
  });

  it('returns zero averages for empty and omitted sold quantities', () => {
    expect(STAT_CARD_REGISTRY.avgSalePrice.getValue({ totalRevenue: 50, unitsSold: 0 })).toBe('$0.00');
    expect(STAT_CARD_REGISTRY.avgCostPerUnit.getValue({ soldCost: 20 })).toBe('$0.00');
  });
});

describe('dashboard pipeline registry', () => {
  it('offers every bucket emitted by the merged status workflow', () => {
    const emittedBuckets = [
      ...INVENTORY_RECEIVING_STATUSES.map(receiving_status => pipelineBucketOf({ receiving_status }, 'inventory')),
      pipelineBucketOf({ receiving_status: 'ON_HAND', is_listed: true }, 'inventory'),
      ...SALE_STATUS_ORDER.map(workflow_status => pipelineBucketOf({ workflow_status }, 'sale')),
    ];

    expect([...new Set(emittedBuckets)].sort()).toEqual(Object.keys(PIPELINE_CARD_REGISTRY).sort());
  });

  it('removes retired labels while retaining and describing the supported customizable statuses', () => {
    expect(PIPELINE_CARD_REGISTRY.COMPLETED).toBeUndefined();
    expect(PIPELINE_CARD_REGISTRY.SHIPPED_IN).toBeUndefined();
    expect(PIPELINE_CARD_REGISTRY.SHIPPED_OUT).toBeUndefined();
    expect(DEFAULT_DASHBOARD_SETTINGS.pipelineCards.some(card => card.id === 'COMPLETED')).toBe(false);
    expect(Object.values(PIPELINE_CARD_REGISTRY).every(card => Boolean(card.description))).toBe(true);
    expect(PIPELINE_CARD_REGISTRY.SHIPPED.label).toBe('Inbound');
    expect(PIPELINE_CARD_REGISTRY.IN_TRANSIT_OUT.label).toBe('Outbound / In Progress');
    expect(PIPELINE_CARD_REGISTRY.PENDING_PAYMENT.label).toBe('Waiting for Payment');
    expect(PIPELINE_CARD_REGISTRY.PAID).toBeDefined();
    expect(PIPELINE_CARD_REGISTRY.RETURNED).toBeDefined();
    expect(PIPELINE_CARD_REGISTRY.DISPUTED).toBeDefined();
    expect(PIPELINE_CARD_REGISTRY.CANCELLED).toBeDefined();
  });
});
