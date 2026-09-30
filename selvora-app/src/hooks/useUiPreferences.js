import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'ui_preferences';

export const UI_STYLE_OPTIONS = [
  {
    id: 'neon-dark',
    name: 'Neon Dark',
    eyebrow: 'Current',
    description: 'The current black dashboard with neon accents and dense analytics panels.',
  },
  {
    id: 'glassmorphism-brown',
    name: 'Glassmorphism Brown',
    eyebrow: 'Next',
    description: 'A warmer glass-style interface with brown tones, soft panels, and layered depth.',
  },
];

export const COLOR_THEME_OPTIONS = [
  {
    id: 'copper',
    name: 'Copper',
    description: 'Warm copper accent with earthy tones',
    vibe: 'Premium, editorial, commerce-oriented',
    swatch: '#cc7a45',
    colors: {
      surface: '#121212',
      border: 'rgba(255, 255, 255, 0.04)',
      accent: '#cc7a45',
      green: '#5aab6e',
      chart: '#7a94b4',
      yellow: '#c4a84e',
    },
  },
  {
    id: 'arctic',
    name: 'Arctic',
    description: 'Cool ice blue, clean and sharp',
    vibe: 'Professional SaaS, Stripe/Linear-like',
    swatch: '#5a9cc2',
    colors: {
      surface: '#111114',
      border: 'rgba(255, 255, 255, 0.04)',
      accent: '#5a9cc2',
      green: '#54a872',
      chart: '#c9a84a',
      yellow: '#c9a84a',
    },
  },
  {
    id: 'jade',
    name: 'Jade',
    description: 'Rich green accent, natural feel',
    vibe: 'Organic, finance-forward, profit-themed',
    swatch: '#4aaa78',
    colors: {
      surface: '#111211',
      border: 'rgba(255, 255, 255, 0.04)',
      accent: '#4aaa78',
      green: '#4aaa78',
      chart: '#6888b8',
      yellow: '#c4a248',
    },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    description: 'Soft violet accent, modern edge',
    vibe: 'Distinctive, design-tool aesthetic',
    swatch: '#8a72c2',
    colors: {
      surface: '#121214',
      border: 'rgba(255, 255, 255, 0.04)',
      accent: '#8a72c2',
      green: '#58a870',
      chart: '#c9a04a',
      yellow: '#c9a04a',
    },
  },
  {
    id: 'signal',
    name: 'Signal',
    description: 'Bold red-orange, direct and energetic',
    vibe: 'Bold, action-oriented, high-contrast',
    swatch: '#c2614a',
    colors: {
      surface: '#131212',
      border: 'rgba(255, 255, 255, 0.04)',
      accent: '#c2614a',
      green: '#55a86a',
      chart: '#5a8cc2',
      yellow: '#c4a44a',
    },
  },
];

const DEFAULT_UI_PREFERENCES = {
  style: 'neon-dark',
  colorTheme: 'copper',
};

function mergePreferences(stored) {
  const next = {
    ...DEFAULT_UI_PREFERENCES,
    ...(stored || {}),
  };

  if (next.style === 'sidebar-dashboard') {
    next.style = 'neon-dark';
  }

  if (!UI_STYLE_OPTIONS.some((option) => option.id === next.style)) {
    next.style = DEFAULT_UI_PREFERENCES.style;
  }

  if (!COLOR_THEME_OPTIONS.some((option) => option.id === next.colorTheme)) {
    next.colorTheme = DEFAULT_UI_PREFERENCES.colorTheme;
  }

  return next;
}

function applyColorTheme(preferences) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = preferences.colorTheme || DEFAULT_UI_PREFERENCES.colorTheme;
  document.documentElement.dataset.uiStyle = preferences.style || DEFAULT_UI_PREFERENCES.style;
}

export function useUiPreferences() {
  const [preferences, setPreferences] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? mergePreferences(JSON.parse(raw)) : DEFAULT_UI_PREFERENCES;
    } catch {
      return DEFAULT_UI_PREFERENCES;
    }
  });

  const savePreferences = useCallback((nextPreferences) => {
    const merged = mergePreferences(nextPreferences);
    applyColorTheme(merged);
    setPreferences(merged);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('ui-preferences-change', { detail: merged }));
  }, []);

  useEffect(() => {
    applyColorTheme(preferences);
  }, [preferences]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY) {
        const next = event.newValue ? mergePreferences(JSON.parse(event.newValue)) : DEFAULT_UI_PREFERENCES;
        applyColorTheme(next);
        setPreferences(next);
      }
    };
    const handlePreferenceChange = (event) => {
      const next = mergePreferences(event.detail);
      applyColorTheme(next);
      setPreferences(next);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('ui-preferences-change', handlePreferenceChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('ui-preferences-change', handlePreferenceChange);
    };
  }, []);

  return { preferences, savePreferences };
}
