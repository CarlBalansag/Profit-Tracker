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

const DEFAULT_UI_PREFERENCES = {
  style: 'neon-dark',
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

  return next;
}

function applyColorTheme(preferences) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = 'copper';
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
