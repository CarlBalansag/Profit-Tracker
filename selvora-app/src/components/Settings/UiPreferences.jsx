import React from 'react';
import { Check, LayoutDashboard, Layers } from 'lucide-react';
import { COLOR_THEME_OPTIONS, UI_STYLE_OPTIONS, useUiPreferences } from '../../hooks/useUiPreferences';

const STYLE_ICONS = {
  'neon-dark': LayoutDashboard,
  'glassmorphism-brown': Layers,
};

function UiPreview({ styleId }) {
  if (styleId === 'glassmorphism-brown') {
    return (
      <div className="h-24 rounded-lg border border-amber-200/20 bg-[linear-gradient(135deg,rgba(74,43,24,0.74),rgba(24,18,14,0.92))] p-2 shadow-inner">
        <div className="h-3 rounded-full bg-amber-100/20 border border-amber-100/20 mb-2 backdrop-blur" />
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          <div className="h-5 rounded-md bg-amber-200/18 border border-amber-100/20" />
          <div className="h-5 rounded-md bg-stone-100/14 border border-amber-100/15" />
          <div className="h-5 rounded-md bg-orange-300/16 border border-orange-200/20" />
        </div>
        <div className="grid grid-cols-[1.35fr_0.65fr] gap-1.5">
          <div className="h-9 rounded-lg bg-white/10 border border-amber-100/15 backdrop-blur" />
          <div className="h-9 rounded-lg bg-white/10 border border-amber-100/15 backdrop-blur" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-24 rounded-lg border border-white/10 bg-black/40 p-2 flex gap-2">
      <div className="w-8 rounded bg-purple-500/10 border border-purple-400/20" />
      <div className="flex-1 space-y-1.5">
        <div className="grid grid-cols-3 gap-1.5">
          <div className="h-5 rounded bg-blue-500/15 border border-blue-400/10" />
          <div className="h-5 rounded bg-emerald-500/15 border border-emerald-400/10" />
          <div className="h-5 rounded bg-pink-500/15 border border-pink-400/10" />
        </div>
        <div className="h-5 rounded bg-white/[0.04] border border-white/10" />
        <div className="grid grid-cols-[1.4fr_0.6fr] gap-1.5">
          <div className="h-8 rounded bg-white/[0.04] border border-white/10" />
          <div className="h-8 rounded bg-white/[0.04] border border-white/10" />
        </div>
      </div>
    </div>
  );
}

export function UiPreferences() {
  const { preferences, savePreferences } = useUiPreferences();

  const selectStyle = (style) => {
    savePreferences({ ...preferences, style });
  };

  const selectColorTheme = (colorTheme) => {
    savePreferences({ ...preferences, colorTheme });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">UI Preferences</h1>
        <p className="text-sm text-gray-400 mt-1">Choose which dashboard interface style you want to use.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {UI_STYLE_OPTIONS.map((option) => {
          const Icon = STYLE_ICONS[option.id] || LayoutDashboard;
          const isSelected = preferences.style === option.id;

          return (
            <button
              key={option.id}
              onClick={() => selectStyle(option.id)}
              className={`group text-left rounded-xl border p-4 transition-all ${
                isSelected
                  ? 'border-[var(--accent)] bg-[#12121A]'
                  : 'border-white/10 bg-[#12121A] hover:border-white/20 hover:bg-[#16161E]'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                    isSelected
                      ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                      : 'border-white/10 bg-white/[0.04] text-gray-300'
                  }`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-bold">{option.eyebrow}</p>
                    <h2 className="text-sm font-semibold text-white mt-1">{option.name}</h2>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                  isSelected ? 'border-[var(--accent)] bg-transparent text-[var(--accent)]' : 'border-white/15 text-transparent'
                }`}>
                  <Check size={12} strokeWidth={3} />
                </div>
              </div>

              <UiPreview styleId={option.id} />
              <p className="text-xs leading-relaxed text-gray-500 mt-4">{option.description}</p>
            </button>
          );
        })}
      </div>

      {preferences.style === 'neon-dark' && (
        <div className="space-y-4 pt-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Color Theme</h2>
            <p className="text-sm text-gray-400 mt-1">Choose an accent color palette for your dashboard</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            {COLOR_THEME_OPTIONS.map((theme) => {
              const isSelected = preferences.colorTheme === theme.id;
              const swatches = [theme.colors.accent, theme.colors.green, theme.colors.chart, theme.colors.yellow];

              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => selectColorTheme(theme.id)}
                  className="relative text-left rounded-xl p-3 transition-colors"
                  style={{
                    background: theme.colors.surface,
                    border: `${isSelected ? 2 : 1}px solid ${isSelected ? theme.colors.accent : theme.colors.border}`,
                  }}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold" style={{ color: '#ddd8d2' }}>{theme.name}</h3>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'text-white' : 'text-transparent'}`}
                      style={{
                        background: isSelected ? theme.colors.accent : 'transparent',
                        borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                      }}
                    >
                      <Check size={12} strokeWidth={3} />
                    </span>
                  </div>

                  <div className="mb-3 flex gap-1">
                    {swatches.map((color) => (
                      <span
                        key={color}
                        className="h-4 w-6 rounded-[3px]"
                        style={{ background: color }}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-[#12121A] p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-gray-500 font-bold mb-2">Selected UI</p>
        <p className="text-sm text-gray-300">
          {UI_STYLE_OPTIONS.find((option) => option.id === preferences.style)?.name || 'Neon Dark'}
        </p>
      </div>
    </div>
  );
}

export default UiPreferences;
