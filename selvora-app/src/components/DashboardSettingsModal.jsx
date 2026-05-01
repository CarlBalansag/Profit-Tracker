import React, { useEffect, useRef, useState } from 'react';
import { X, Eye, EyeOff, ChevronUp, ChevronDown, Info } from 'lucide-react';
import {
  STAT_CARD_REGISTRY,
  PIPELINE_CARD_REGISTRY,
  CHART_SERIES_REGISTRY,
  DASHBOARD_SECTION_REGISTRY,
  RECENT_SALES_COLUMN_REGISTRY,
  DEFAULT_DASHBOARD_SETTINGS,
} from '../data/dashboardRegistry';

const DATE_OPTIONS = ['7 Days', '30 Days', 'YTD', 'All Time'];

function getMetricMeaning(label) {
  const meanings = {
    'Total Cost': 'Total Cost is the full amount spent to buy inventory, including item cost, tax, and inbound shipping.',
    'Sale Revenue': 'Sale Revenue is the money received from sold items after marketplace or platform fees.',
    Cashback: 'Cashback is money earned back from the payment card or payment method used for sold inventory.',
    'Net Profit': 'Net Profit is what remains after sold-item cost is covered, with cashback added back in.',
    'Gross Profit': 'Gross Profit is the difference between sale revenue and the cost basis of the sold item.',
    'Avg ROI': 'Avg ROI shows how much return you earned compared with the cost basis of sold items.',
    'Commission Fees': 'Commission Fees are marketplace or platform fees taken out of sales.',
    'Net Margin': 'Net Margin shows what percentage of sale revenue remains as net profit.',
    'Avg Sale Price': 'Avg Sale Price is the average revenue received per sold item.',
    'Avg Cost/Unit': 'Avg Cost/Unit is the average cost basis for each sold item.',
    'Total Tax Paid': 'Total Tax Paid is the purchase sales tax paid across inventory.',
    'Inventory Value': 'Inventory Value is the cost of unsold stock still on hand.',
    'Sales Velocity': 'Sales Velocity shows how quickly items are selling in the selected time range.',
    Tax: 'Tax is the purchase sales tax paid on inventory.',
    'Sold Cost Basis': 'Sold Cost Basis is the item cost, allocated tax, and allocated inbound shipping for items that have sold.',
  };

  return meanings[label] || `${label} explains what this metric means in the selected dashboard view.`;
}

function FormulaPopup({ formula, label, onClose }) {
  const ref = useRef(null);
  const calculation = formula.join(' ');

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-8 top-1/2 z-10 w-64 -translate-y-1/2 rounded-xl border border-white/10 bg-[#1c1f28] p-4 shadow-2xl"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">{label}</p>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Calculation</p>
          <p className="mt-1 text-xs font-semibold leading-relaxed text-white">{calculation}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">What It Means</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-300">{getMetricMeaning(label)}</p>
        </div>
      </div>
      <ul className="hidden" aria-hidden="true">
        {formula.map((line, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-px text-[10px] text-purple-400">›</span>
            <span className="text-[11px] leading-relaxed text-gray-300">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardRow({ item, def, onToggle, onMoveUp, onMoveDown, isFirst, isLast }) {
  const Icon = def.icon;
  const [showInfo, setShowInfo] = useState(false);
  const hasFormula = Array.isArray(def.formula) && def.formula.length > 0;
  const iconStyle = typeof def.color === 'string' && def.color.startsWith('#') ? { color: def.color } : undefined;

  return (
    <div className={`relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
      item.visible
        ? 'border-white/[0.08] bg-white/[0.03]'
        : 'border-white/[0.03] bg-transparent'
    } ${!item.visible && !showInfo ? 'opacity-50' : 'opacity-100'} ${showInfo ? 'z-50' : 'z-0'}`}>
      <div className="flex flex-col gap-0.5">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className="text-gray-500 transition-colors hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45"
          type="button"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className="text-gray-500 transition-colors hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45"
          type="button"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-white/[0.05]">
        <Icon className="h-3.5 w-3.5 text-gray-400" style={iconStyle} />
      </div>

      <span className={`min-w-0 flex-1 truncate text-sm ${item.visible ? 'text-gray-300' : 'text-gray-400'}`}>{def.label}</span>

      {hasFormula && (
        <button
          onClick={() => setShowInfo(v => !v)}
          className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
            showInfo ? 'bg-purple-500/10 text-purple-400' : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
          }`}
          type="button"
        >
          <Info className="h-3 w-3" />
        </button>
      )}

      <button
        onClick={onToggle}
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
          item.visible
            ? 'text-purple-400 hover:bg-purple-500/10'
            : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
        }`}
        type="button"
      >
        {item.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>

      {showInfo && hasFormula && (
        <FormulaPopup formula={def.formula} label={def.label} onClose={() => setShowInfo(false)} />
      )}
    </div>
  );
}

function SectionPanel({
  title,
  meta,
  collapsed,
  onToggle,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  children,
  visible,
  onToggleVisible,
}) {
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className={`flex items-center gap-3 ${collapsed ? '' : 'mb-3'}`}>
        <div className="flex flex-col gap-0.5">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="text-gray-500 transition-colors hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            title="Move section up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="text-gray-500 transition-colors hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            title="Move section down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
        >
          <p className={`truncate text-[10px] font-bold uppercase tracking-widest ${visible === false ? 'text-gray-600' : 'text-gray-500'}`}>{title}</p>
          <span className="flex shrink-0 items-center gap-2">
            {meta && <span className="text-[10px] text-gray-600">{meta}</span>}
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5 text-gray-600" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 text-gray-500" />
            )}
          </span>
        </button>
        {onToggleVisible !== undefined && (
          <button
            type="button"
            onClick={onToggleVisible}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
              visible !== false
                ? 'text-purple-400 hover:bg-purple-500/10'
                : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
            }`}
            title={visible !== false ? 'Hide on dashboard' : 'Show on dashboard'}
          >
            {visible !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}

function InfoPreviewCard({ variant, title, children }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#151820] p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Style {variant}</p>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] text-gray-500">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function InfoPopoverPreviews() {
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Info Popover Preview</p>
        <p className="mt-1 text-[11px] text-gray-600">Visual options for the small explanation popups on dashboard metrics.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <InfoPreviewCard variant="1" title="Formula Card">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Total Cost</p>
          <div className="mt-3 rounded-lg bg-black/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Formula</p>
            <p className="mt-1 text-sm font-semibold text-white">Item Cost + Tax + Shipping</p>
          </div>
          <div className="mt-3 space-y-1.5 text-xs text-gray-400">
            <p><span className="text-gray-300">Item Cost</span> = Unit Price x Quantity</p>
            <p><span className="text-gray-300">Tax</span> = Purchase sales tax</p>
            <p><span className="text-gray-300">Shipping</span> = Inbound shipping cost</p>
          </div>
        </InfoPreviewCard>

        <InfoPreviewCard variant="2" title="Plain English">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Total Cost</p>
          <p className="mt-3 text-sm font-medium text-white">The full amount spent to buy this inventory.</p>
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Includes</p>
            <div className="flex flex-wrap gap-2">
              {['Item price', 'Sales tax', 'Inbound shipping'].map(item => (
                <span key={item} className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs text-gray-300">{item}</span>
              ))}
            </div>
          </div>
        </InfoPreviewCard>

        <InfoPreviewCard variant="3" title="Metric Definition">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Total Cost</p>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Definition</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-300">Total purchase spend for inventory in the selected date range.</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Calculation</p>
              <p className="mt-1 text-xs font-semibold text-white">(Unit Price x Qty) + Tax + Shipping</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Used For</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-300">Tracking how much cash went into inventory.</p>
            </div>
          </div>
        </InfoPreviewCard>

        <InfoPreviewCard variant="4" title="Compact Breakdown">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Total Cost</p>
          <div className="mt-3 space-y-2">
            {['Item cost', '+ Tax', '+ Shipping'].map((line, index) => (
              <div key={line} className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${index === 0 ? 'bg-blue-400' : 'bg-gray-500'}`} />
                <span className={`text-sm ${index === 0 ? 'font-semibold text-white' : 'text-gray-300'}`}>{line}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-white/[0.06] pt-3 text-xs text-gray-500">Full purchase cost of inventory.</p>
        </InfoPreviewCard>

        <InfoPreviewCard variant="5" title="Example-Based">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Total Cost</p>
          <p className="mt-3 text-xs text-gray-500">Formula</p>
          <p className="mt-1 text-sm font-semibold text-white">Item Cost + Tax + Shipping</p>
          <div className="mt-4 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Example</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-300">$100 item + $8 tax + $5 shipping = <span className="font-semibold text-emerald-300">$113 total cost</span></p>
          </div>
        </InfoPreviewCard>
      </div>
    </section>
  );
}

function reorder(list, index, dir) {
  const next = [...list];
  const target = index + dir;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((item, i) => ({ ...item, order: i }));
}

export default function DashboardSettingsModal({ settings, onClose, onSave }) {
  const [local, setLocal] = useState(() => ({
    defaultDateFilter: settings.defaultDateFilter,
    dashboardSections: [
      ...((settings.dashboardSections?.length ? settings.dashboardSections : DEFAULT_DASHBOARD_SETTINGS.dashboardSections) || []),
    ].sort((a, b) => a.order - b.order),
    statCards: [...settings.statCards].sort((a, b) => a.order - b.order),
    pipelineCards: [...settings.pipelineCards].sort((a, b) => a.order - b.order),
    chartSeries: [...(settings.chartSeries || [])].sort((a, b) => a.order - b.order),
    recentSalesColumns: [...(settings.recentSalesColumns || DEFAULT_DASHBOARD_SETTINGS.recentSalesColumns)].sort((a, b) => a.order - b.order),
  }));

  const visibleStatCount = local.statCards.filter(c => c.visible).length;
  const visibleChartCount = local.chartSeries.filter(c => c.visible).length;
  const visibleRecentSalesColumnCount = local.recentSalesColumns.filter(c => c.visible).length;
  const [collapsedSections, setCollapsedSections] = useState({
    summaryCards: false,
    pipeline: false,
    graph: false,
    paymentMethods: false,
    recentSales: false,
    future: false,
  });

  function toggleSection(section) {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }

  function toggleSectionVisible(sectionId) {
    setLocal(prev => ({
      ...prev,
      dashboardSections: prev.dashboardSections.map(s =>
        s.id === sectionId ? { ...s, visible: s.visible === false ? true : false } : s
      ),
    }));
  }

  function toggleListItem(listName, id) {
    setLocal(prev => ({
      ...prev,
      [listName]: prev[listName].map(item => item.id === id ? { ...item, visible: !item.visible } : item),
    }));
  }

  function moveListItem(listName, index, dir) {
    setLocal(prev => ({ ...prev, [listName]: reorder(prev[listName], index, dir) }));
  }

  function moveSection(index, dir) {
    setLocal(prev => ({ ...prev, dashboardSections: reorder(prev.dashboardSections, index, dir) }));
  }

  function renderRows(items, registry, listName) {
    return items.map((item, i) => {
      const def = registry[item.id];
      if (!def) return null;
      return (
        <CardRow
          key={item.id}
          item={item}
          def={def}
          onToggle={() => toggleListItem(listName, item.id)}
          onMoveUp={() => moveListItem(listName, i, -1)}
          onMoveDown={() => moveListItem(listName, i, 1)}
          isFirst={i === 0}
          isLast={i === items.length - 1}
        />
      );
    });
  }

  function renderSection(section, index) {
    const sectionCount = local.dashboardSections.length;

    if (section.id === 'statCards') {
      return (
        <SectionPanel
          key={section.id}
          title={DASHBOARD_SECTION_REGISTRY.statCards.label}
          meta={`${visibleStatCount}/5 visible`}
          collapsed={collapsedSections.summaryCards}
          onToggle={() => toggleSection('summaryCards')}
          onMoveUp={() => moveSection(index, -1)}
          onMoveDown={() => moveSection(index, 1)}
          isFirst={index === 0}
          isLast={index === sectionCount - 1}
        >
          {visibleStatCount > 5 && (
            <p className="mb-3 text-[11px] text-amber-400">Max 5 shown on dashboard. First 5 in order will display.</p>
          )}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {renderRows(local.statCards, STAT_CARD_REGISTRY, 'statCards')}
          </div>
        </SectionPanel>
      );
    }

    if (section.id === 'pipeline') {
      return (
        <SectionPanel
          key={section.id}
          title={DASHBOARD_SECTION_REGISTRY.pipeline.label}
          meta="Toggle and reorder"
          collapsed={collapsedSections.pipeline}
          onToggle={() => toggleSection('pipeline')}
          onMoveUp={() => moveSection(index, -1)}
          onMoveDown={() => moveSection(index, 1)}
          isFirst={index === 0}
          isLast={index === sectionCount - 1}
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {renderRows(local.pipelineCards, PIPELINE_CARD_REGISTRY, 'pipelineCards')}
          </div>
        </SectionPanel>
      );
    }

    if (section.id === 'trendChart') {
      return (
        <SectionPanel
          key={section.id}
          title={DASHBOARD_SECTION_REGISTRY.trendChart.label}
          meta={`${visibleChartCount} active`}
          collapsed={collapsedSections.graph}
          onToggle={() => toggleSection('graph')}
          onMoveUp={() => moveSection(index, -1)}
          onMoveDown={() => moveSection(index, 1)}
          isFirst={index === 0}
          isLast={index === sectionCount - 1}
        >
          <p className="mb-3 text-[11px] text-gray-600">Choose which lines appear in the Profit & Cost Trend chart.</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {renderRows(local.chartSeries, CHART_SERIES_REGISTRY, 'chartSeries')}
          </div>
        </SectionPanel>
      );
    }


    if (section.id === 'paymentMethods') return null;

    if (section.id === 'recentSales') {
      return (
        <SectionPanel
          key={section.id}
          title={DASHBOARD_SECTION_REGISTRY.recentSales.label}
          meta={`${visibleRecentSalesColumnCount}/7 visible`}
          collapsed={collapsedSections.recentSales}
          onToggle={() => toggleSection('recentSales')}
          onMoveUp={() => moveSection(index, -1)}
          onMoveDown={() => moveSection(index, 1)}
          isFirst={index === 0}
          isLast={index === sectionCount - 1}
        >
          <p className="mb-3 text-[11px] text-gray-600">Choose which columns appear in the Recent Sales table.</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {renderRows(local.recentSalesColumns, RECENT_SALES_COLUMN_REGISTRY, 'recentSalesColumns')}
          </div>
        </SectionPanel>
      );
    }

    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex h-[80vh] w-[min(1180px,80vw)] min-w-[min(94vw,720px)] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0b] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Dashboard Settings</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">Customize dashboard layout, cards, and chart visibility.</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/10 hover:text-white"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 theme-scrollbar">
          <div className="space-y-5">
            <div className="flex flex-wrap gap-3">
              <div className="w-full max-w-xs rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">Default Time Frame</p>
                <select
                  value={local.defaultDateFilter}
                  onChange={e => setLocal(prev => ({ ...prev, defaultDateFilter: e.target.value }))}
                  className="w-full appearance-none rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-gray-300 transition-colors focus:border-purple-500/50 focus:outline-none"
                >
                  {DATE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>

              {/* Payment Methods — compact inline toggle */}
              {(() => {
                const pmSection = local.dashboardSections.find(s => s.id === 'paymentMethods');
                const isVisible = pmSection ? pmSection.visible !== false : true;
                return (
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4 self-stretch min-w-[200px]">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Payment Methods</p>
                      <p className="mt-0.5 text-[11px] text-gray-600">{isVisible ? 'Visible on dashboard' : 'Hidden from dashboard'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleSectionVisible('paymentMethods')}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                        isVisible
                          ? 'text-purple-400 hover:bg-purple-500/10'
                          : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
                      }`}
                      title={isVisible ? 'Hide Payment Methods' : 'Show Payment Methods'}
                    >
                      {isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                );
              })()}
            </div>

            {local.dashboardSections.map((section, index) => renderSection(section, index))}

            <SectionPanel
              title="Future Dashboard Areas"
              meta="Reserved"
              collapsed={collapsedSections.future}
              onToggle={() => toggleSection('future')}
              onMoveUp={() => {}}
              onMoveDown={() => {}}
              isFirst
              isLast
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.015] p-4">
                  <p className="text-sm font-medium text-gray-300">Right Column</p>
                  <p className="mt-1 text-xs text-gray-600">Space reserved for Top Cards, inventory alerts, and quick insights.</p>
                </div>
                <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.015] p-4">
                  <p className="text-sm font-medium text-gray-300">Bottom Tables</p>
                  <p className="mt-1 text-xs text-gray-600">Space reserved for recent sales, inventory on hand, and custom table presets.</p>
                </div>
              </div>
            </SectionPanel>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-white/[0.06] px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] px-5 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-white/[0.05] hover:text-white"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(local)}
            className="rounded-xl bg-purple-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-500"
            type="button"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
