import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from './useApi';
import { DEFAULT_DASHBOARD_SETTINGS, PIPELINE_CARD_ID_ALIASES } from '../data/dashboardRegistry';

const STORAGE_KEY_PREFIX = 'dashboard_settings';
const SETTINGS_VERSION = 6;
const DEFAULT_GLASS_SETTINGS = {
  metricPanelCount: 1,
  metricPanels: [
    ['items', 'margin', 'avgCost', 'roi'],
  ],
  layoutOrder: ['statCards', 'radarGraph', 'trendChart', 'paymentMethods', 'metric-0', 'recentSales'],
};

function getStorageKey(uiStyle = 'neon-dark') {
  return `${STORAGE_KEY_PREFIX}:${uiStyle || 'neon-dark'}`;
}

const DEFAULT_STAT_CARD_ORDER = {
  totalCost: 0,
  grossProfit: 1,
  profit: 2,
  totalRevenue: 3,
  totalCashback: 4,
  roi: 5,
};

export function mergeDashboardSettings(stored, defaults = DEFAULT_DASHBOARD_SETTINGS) {
  // Keep supported saved items in their chosen order, drop retired ids, and
  // append any newly introduced options from the current defaults.
  const mergeList = (storedList, defaultList) => {
    const defaultIds = new Set(defaultList.map(i => i.id));
    const retained = storedList.filter(item => defaultIds.has(item.id));
    const storedIds = new Set(retained.map(i => i.id));
    const missing = defaultList
      .filter(d => !storedIds.has(d.id))
      .map((d, i) => ({ ...d, order: retained.length + i }));
    return [...retained, ...missing];
  };

  const migratePipelineIds = (items) => {
    const seen = new Set();
    return items
      .map(item => ({ ...item, id: PIPELINE_CARD_ID_ALIASES[item.id] || item.id }))
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
  };

  const merged = {
    version: stored.version ?? 1,
    defaultDateFilter: stored.defaultDateFilter ?? defaults.defaultDateFilter,
    dashboardSections: mergeList(stored.dashboardSections ?? [], defaults.dashboardSections),
    statCards: mergeList(stored.statCards ?? [], defaults.statCards),
    pipelineCards: mergeList(migratePipelineIds(stored.pipelineCards ?? []), defaults.pipelineCards),
    chartSeries: mergeList(stored.chartSeries ?? [], defaults.chartSeries),
    recentSalesColumns: mergeList(stored.recentSalesColumns ?? [], defaults.recentSalesColumns),
    glass: {
      ...DEFAULT_GLASS_SETTINGS,
      ...(stored.glass || {}),
      metricPanelCount: stored.glass?.metricPanelCount || stored.glass?.pipelinePanelCount || DEFAULT_GLASS_SETTINGS.metricPanelCount,
    },
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

export function useDashboardSettings(uiStyle = 'neon-dark') {
  const storageKey = getStorageKey(uiStyle);
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
        || (uiStyle === 'neon-dark' ? localStorage.getItem(STORAGE_KEY_PREFIX) : null);
      if (!raw) return { ...DEFAULT_DASHBOARD_SETTINGS, version: SETTINGS_VERSION };
      return mergeDashboardSettings(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_DASHBOARD_SETTINGS, version: SETTINGS_VERSION };
    }
  });

  useEffect(() => {
    let cancelled = false;

    const fallbackSettings = () => {
      try {
        const raw = localStorage.getItem(storageKey)
          || (uiStyle === 'neon-dark' ? localStorage.getItem(STORAGE_KEY_PREFIX) : null);
        return raw
          ? mergeDashboardSettings(JSON.parse(raw))
          : { ...DEFAULT_DASHBOARD_SETTINGS, version: SETTINGS_VERSION };
      } catch {
        return { ...DEFAULT_DASHBOARD_SETTINGS, version: SETTINGS_VERSION };
      }
    };

    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) setSettings(fallbackSettings());
    }, 0);

    apiFetch(`/api/preferences/dashboard-settings/${encodeURIComponent(uiStyle)}`, {
      credentials: 'include',
    })
      .then(res => (res.ok ? res.json() : null))
      .then(payload => {
        if (cancelled || !payload?.settings) return;
        const merged = mergeDashboardSettings(payload.settings);
        setSettings(merged);
        localStorage.setItem(storageKey, JSON.stringify(merged));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [storageKey, uiStyle]);

  const saveSettings = useCallback((newSettings) => {
    const versionedSettings = {
      ...mergeDashboardSettings({ ...newSettings, version: SETTINGS_VERSION }),
      version: SETTINGS_VERSION,
    };
    setSettings(versionedSettings);
    localStorage.setItem(storageKey, JSON.stringify(versionedSettings));
    apiFetch(`/api/preferences/dashboard-settings/${encodeURIComponent(uiStyle)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ settings: versionedSettings }),
    }).catch(() => {});
  }, [storageKey, uiStyle]);

  return { settings, saveSettings };
}
