import { useState, useCallback } from 'react';
import { DEFAULT_DASHBOARD_SETTINGS } from '../data/dashboardRegistry';

const STORAGE_KEY = 'dashboard_settings';
const SETTINGS_VERSION = 5;

const DEFAULT_STAT_CARD_ORDER = {
  totalCost: 0,
  grossProfit: 1,
  profit: 2,
  totalRevenue: 3,
  totalCashback: 4,
  roi: 5,
};

function mergeWithDefaults(stored, defaults) {
  // Merge statCards: keep stored order/visibility, append any new ids from defaults
  const mergeList = (storedList, defaultList) => {
    const storedIds = new Set(storedList.map(i => i.id));
    const missing = defaultList
      .filter(d => !storedIds.has(d.id))
      .map((d, i) => ({ ...d, order: storedList.length + i }));
    return [...storedList, ...missing];
  };

  const merged = {
    version: stored.version ?? 1,
    defaultDateFilter: stored.defaultDateFilter ?? defaults.defaultDateFilter,
    dashboardSections: mergeList(stored.dashboardSections ?? [], defaults.dashboardSections),
    statCards: mergeList(stored.statCards ?? [], defaults.statCards),
    pipelineCards: mergeList(stored.pipelineCards ?? [], defaults.pipelineCards),
    chartSeries: mergeList(stored.chartSeries ?? [], defaults.chartSeries),
    recentSalesColumns: mergeList(stored.recentSalesColumns ?? [], defaults.recentSalesColumns),
  };

  if ((stored.version ?? 1) < SETTINGS_VERSION) {
    merged.version = SETTINGS_VERSION;
    merged.statCards = merged.statCards.map(card => {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_STAT_CARD_ORDER, card.id)) {
        return {
          ...card,
          visible: card.id !== 'roi',
          order: DEFAULT_STAT_CARD_ORDER[card.id],
        };
      }
      return card;
    });
  }

  return merged;
}

export function useDashboardSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_DASHBOARD_SETTINGS, version: SETTINGS_VERSION };
      return mergeWithDefaults(JSON.parse(raw), DEFAULT_DASHBOARD_SETTINGS);
    } catch {
      return { ...DEFAULT_DASHBOARD_SETTINGS, version: SETTINGS_VERSION };
    }
  });

  const saveSettings = useCallback((newSettings) => {
    const versionedSettings = {
      ...mergeWithDefaults({ ...newSettings, version: SETTINGS_VERSION }, DEFAULT_DASHBOARD_SETTINGS),
      version: SETTINGS_VERSION,
    };
    setSettings(versionedSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(versionedSettings));
  }, []);

  return { settings, saveSettings };
}
