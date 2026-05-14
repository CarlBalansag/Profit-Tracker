import React from 'react';

// Shimmering skeleton block
function Sk({ className = '', style }) {
  return (
    <div
      className={`rounded-lg relative overflow-hidden ${className}`}
      style={{
        backgroundColor: 'rgba(255,255,255,0.07)',
        backgroundImage: 'linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.15) 50%, transparent 75%)',
        backgroundSize: '400% 100%',
        animation: 'sk-shimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

// ─── Full-page loader layouts per page type ────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-5 max-w-full animate-in fade-in duration-300">
      <Sk className="h-8 w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array(4).fill(0).map((_, i) => <Sk key={i} className="h-28" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Sk className="h-64 lg:col-span-2" />
        <Sk className="h-64" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Sk className="h-48" />
        <Sk className="h-48" />
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 8 }) {
  return (
    <div className="p-6 space-y-4 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <Sk className="h-8 w-40" />
        <div className="flex gap-2">
          <Sk className="h-9 w-28" />
          <Sk className="h-9 w-28" />
        </div>
      </div>
      <div className="flex gap-3">
        <Sk className="h-9 flex-1 max-w-sm" />
        <Sk className="h-9 w-24" />
        <Sk className="h-9 w-24" />
      </div>
      <div className="rounded-xl overflow-hidden border border-white/[0.06]">
        <div className="px-4 py-3 bg-white/[0.02]">
          <div className="flex gap-4">
            {[120, 80, 80, 70, 70, 70, 70].map((w, i) => (
              <Sk key={i} className="h-3" style={{ width: w }} />
            ))}
          </div>
        </div>
        {Array(rows).fill(0).map((_, i) => (
          <div key={i} className="px-4 py-3.5 border-t border-white/[0.04] flex gap-4 items-center">
            {[120, 80, 80, 70, 70, 70, 70].map((w, j) => (
              <Sk key={j} className="h-3" style={{ width: w, opacity: 1 - i * 0.08 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CardGridSkeleton({ cards = 6 }) {
  return (
    <div className="p-6 space-y-5 animate-in fade-in duration-300">
      <Sk className="h-8 w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array(cards).fill(0).map((_, i) => <Sk key={i} className="h-32" />)}
      </div>
    </div>
  );
}

function TaxExemptSkeleton() {
  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Sk className="h-8 w-36" />
          <Sk className="h-4 w-52" />
        </div>
        <div className="flex gap-2">
          <Sk className="h-9 w-28" />
          <Sk className="h-9 w-32" />
        </div>
      </div>
      {/* Top cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array(4).fill(0).map((_, i) => <Sk key={i} className="h-24" />)}
      </div>
      {/* Second row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array(4).fill(0).map((_, i) => <Sk key={i} className="h-16" />)}
      </div>
      {/* Tabs + search */}
      <div className="flex items-center justify-between">
        <Sk className="h-10 w-48" />
        <Sk className="h-9 w-52" />
      </div>
      {/* Table */}
      <div className="rounded-xl overflow-hidden border border-white/[0.06]">
        {Array(6).fill(0).map((_, i) => (
          <div key={i} className="px-4 py-3.5 border-b border-white/[0.04] flex gap-4">
            {[140, 90, 90, 80, 70, 70].map((w, j) => (
              <Sk key={j} className="h-3" style={{ width: w, opacity: 1 - i * 0.1 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function GenericSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-in fade-in duration-300">
      <Sk className="h-8 w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array(4).fill(0).map((_, i) => <Sk key={i} className="h-24" />)}
      </div>
      <Sk className="h-64" />
      <Sk className="h-48" />
    </div>
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export function PageLoader({ variant = 'generic' }) {
  const map = {
    dashboard:  <DashboardSkeleton />,
    table:      <TableSkeleton />,
    cards:      <CardGridSkeleton />,
    taxexempt:  <TaxExemptSkeleton />,
    generic:    <GenericSkeleton />,
  };
  return map[variant] || map.generic;
}

// Inject shimmer keyframe once
if (typeof document !== 'undefined' && !document.getElementById('sk-shimmer-style')) {
  const style = document.createElement('style');
  style.id = 'sk-shimmer-style';
  style.textContent = `
    @keyframes sk-shimmer {
      0%   { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }
  `;
  document.head.appendChild(style);
}
