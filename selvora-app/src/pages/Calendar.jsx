import { useRef, useState, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import '@fullcalendar/react/skeleton.css';
import {
  ChevronLeft, ChevronRight, CalendarDays,
  ShoppingBag, DollarSign, Banknote, Link2, Copy, Check, CreditCard,
} from 'lucide-react';
import { useCalendarEvents, useCalendarAutoEvents, useCalendarToken } from '../hooks/useApi';
import CalendarEventModal from '../components/Calendar/CalendarEventModal';
import CalendarEventPopover from '../components/Calendar/CalendarEventPopover';

// ─── Color maps ───────────────────────────────────────────────────────────────
const TYPE_COLOR = {
  purchase:    '#3b82f6',
  sale:        '#22c55e',
  payout:      '#10b981',
  manual:      '#a855f7',
  credit_due:  '#ef4444',
};

const NAMED_COLOR = {
  purple: '#a855f7',
  blue:   '#3b82f6',
  green:  '#22c55e',
  amber:  '#f59e0b',
  red:    '#ef4444',
};

function eventBgColor(ev) {
  if (ev.color && NAMED_COLOR[ev.color]) return NAMED_COLOR[ev.color];
  return TYPE_COLOR[ev.type] ?? '#a855f7';
}

// ─── Custom event pill — dot + colored text, no background fill ───────────────
function EventPill({ eventInfo }) {
  const ev = eventInfo.event.extendedProps.raw;
  const color = eventBgColor(ev);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '1px 4px',
        width: '100%',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
      title={eventInfo.event.title}
    >
      <span style={{
        flexShrink: 0,
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: color,
      }} />
      <span style={{
        color: color,
        fontSize: '10px',
        fontWeight: 600,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {eventInfo.event.title}
      </span>
    </div>
  );
}

// ─── Custom day cell — adds divider line + highlights today ───────────────────
function DayCellContent({ dayNumberText, isToday }) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '2px 4px 3px',
      }}>
        <span style={{
          fontSize: '11px',
          fontWeight: isToday ? 700 : 400,
          color: isToday ? '#1a1a1a' : '#9ca3af',
          backgroundColor: isToday ? '#eab308' : 'transparent',
          borderRadius: '50%',
          width: isToday ? '20px' : 'auto',
          height: isToday ? '20px' : 'auto',
          lineHeight: isToday ? '20px' : 'normal',
          textAlign: 'center',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: isToday ? '0 0 8px rgba(234,179,8,0.6)' : 'none',
        }}>
          {dayNumberText}
        </span>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toMonthStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function SubscribePanel({ onClose }) {
  const { data, isLoading } = useCalendarToken();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!data?.feedUrl) return;
    navigator.clipboard.writeText(data.feedUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-[#15171d] border border-white/[0.08] rounded-2xl shadow-2xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
          <Link2 size={16} className="text-[var(--accent)]" />
          Subscribe to Calendar
        </h2>
        <p className="text-sm text-gray-400">
          Add your Selvora calendar to Google Calendar, Apple Calendar, or Outlook.
          It updates automatically whenever you record sales, purchases, or payouts.
        </p>

        {isLoading ? (
          <div className="h-10 bg-white/[0.04] rounded-lg animate-pulse" />
        ) : (
          <div className="flex items-center gap-2 bg-[#1e2028] border border-white/[0.08] rounded-lg px-3 py-2">
            <span className="flex-1 text-xs text-gray-300 truncate font-mono">{data?.feedUrl}</span>
            <button
              onClick={handleCopy}
              className="flex-shrink-0 flex items-center gap-1 text-xs text-[var(--accent)] hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/[0.06]"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        <div className="space-y-2 text-xs text-gray-500">
          <p className="font-medium text-gray-400">How to subscribe:</p>
          <p><span className="text-gray-300">Google Calendar:</span> Other calendars → + → From URL → paste the link above</p>
          <p><span className="text-gray-300">Apple Calendar:</span> File → New Calendar Subscription → paste the link above</p>
          <p><span className="text-gray-300">Outlook:</span> Add calendar → Subscribe from web → paste the link above</p>
        </div>

        <p className="text-[10px] text-gray-600">
          Keep this link private — anyone with it can view your calendar events.
        </p>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-white/[0.05] rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Calendar Page ───────────────────────────────────────────────────────
export default function Calendar() {
  const calendarRef = useRef(null);
  const [currentMonth, setCurrentMonth] = useState(() => toMonthStr(new Date()));
  const [view, setView] = useState('dayGridMonth');
  const [popover, setPopover] = useState(null); // { date, events }
  const [modal, setModal] = useState({ open: false, event: null, defaultDate: null });
  const [showSubscribe, setShowSubscribe] = useState(false);

  const { data: manualEvents = [] } = useCalendarEvents(currentMonth);
  const { data: autoEvents = [] } = useCalendarAutoEvents(currentMonth);

  // Merge and shape events for FullCalendar
  const fcEvents = useMemo(() => {
    return [...autoEvents, ...manualEvents].map(ev => ({
      id: ev.id,
      title: ev.title,
      start: ev.date,
      end: ev.end_date || undefined,
      backgroundColor: eventBgColor(ev),
      borderColor: 'transparent',
      textColor: '#ffffff',
      extendedProps: { type: ev.type, notes: ev.notes, raw: ev },
    }));
  }, [autoEvents, manualEvents]);

  const handleDatesSet = (info) => {
    setCurrentMonth(toMonthStr(info.view.currentStart));
  };

  const handleEventClick = (info) => {
    const raw = info.event.extendedProps.raw;
    const date = raw.date;
    // Collect all events on the same date
    const eventsOnDay = [...autoEvents, ...manualEvents].filter(e => e.date === date);
    setPopover({ date, events: eventsOnDay });
  };

  const handleDateClick = (info) => {
    setModal({ open: true, event: null, defaultDate: info.dateStr });
  };

  const changeView = (newView) => {
    setView(newView);
    calendarRef.current?.getApi().changeView(newView);
  };

  const goNext = () => calendarRef.current?.getApi().next();
  const goPrev = () => calendarRef.current?.getApi().prev();
  const goToday = () => calendarRef.current?.getApi().today();

  // Title label for header
  const monthLabel = new Date(currentMonth + '-15').toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });

  return (
    <div className="flex flex-col h-full min-h-0 p-4 md:p-6 gap-4">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <CalendarDays size={20} className="text-[var(--accent)]" />
            Reselling Calendar
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Track purchases, sales, payouts and custom events</p>
        </div>
        <button
          onClick={() => setShowSubscribe(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/[0.05] rounded-lg transition-colors"
        >
          <Link2 size={13} />
          Subscribe to Calendar
        </button>
      </div>

      {/* ── Calendar card ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-card,#15171d)] border border-white/[0.06] rounded-2xl overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] gap-2 flex-wrap">
          {/* Nav */}
          <div className="flex items-center gap-1">
            <button onClick={goPrev} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/[0.06] transition-colors"><ChevronLeft size={16} /></button>
            <button onClick={goToday} className="px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-white/[0.06] rounded-lg transition-colors">Today</button>
            <button onClick={goNext} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/[0.06] transition-colors"><ChevronRight size={16} /></button>
            <span className="text-sm font-medium text-gray-200 ml-1">{monthLabel}</span>
          </div>

          {/* View toggle */}
          <div className="flex items-center bg-white/[0.04] border border-white/[0.06] rounded-lg p-0.5">
            {[['dayGridMonth', 'Month'], ['timeGridWeek', 'Week']].map(([v, label]) => (
              <button
                key={v}
                onClick={() => changeView(v)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${view === v ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Legend + Calendar */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Legend */}
          <div className="hidden lg:flex flex-col gap-3 px-4 py-4 border-r border-white/[0.06] min-w-[140px] w-36">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-600">Legend</p>
            {[
              { color: '#3b82f6', label: 'Purchase',  icon: ShoppingBag },
              { color: '#22c55e', label: 'Sale',       icon: DollarSign },
              { color: '#10b981', label: 'Payout',     icon: Banknote },
              { color: '#a855f7', label: 'Manual',     icon: CalendarDays },
              { color: '#ef4444', label: 'CC Due',     icon: CreditCard },
            ].map(({ color, label, icon: Icon }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs text-gray-400">{label}</span>
              </div>
            ))}

            <div className="mt-auto pt-4 border-t border-white/[0.06]">
              <button
                onClick={() => setModal({ open: true, event: null, defaultDate: null })}
                className="w-full text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-bg)] rounded-lg py-1.5 px-2 transition-colors text-left"
              >
                + Add event
              </button>
            </div>
          </div>

          {/* FullCalendar */}
          <div className="flex-1 min-w-0 overflow-auto p-2 calendar-wrapper">
            <style>{`
              .calendar-wrapper a { color: inherit; text-decoration: none; }
              .calendar-wrapper [class*="fc-"] { font-size: 11px; color: #9ca3af; }
              .calendar-wrapper [role="columnheader"] { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #6b7280 !important; padding: 8px 0 !important; }
              .calendar-wrapper [role="gridcell"] { border: 1px solid rgba(255,255,255,0.08) !important; min-height: 100px !important; vertical-align: top !important; }
              .calendar-wrapper [role="gridcell"][aria-current="date"] { background-color: rgba(234,179,8,0.07) !important; box-shadow: inset 0 0 0 1px rgba(234,179,8,0.35) !important; }
              .calendar-wrapper [class*="moreLinkText"], .calendar-wrapper [class*="moreLink"] { color: #6b7280 !important; font-size: 10px !important; }
            `}</style>
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              headerToolbar={false}
              events={fcEvents}
              eventClick={handleEventClick}
              dateClick={handleDateClick}
              datesSet={handleDatesSet}
              eventContent={(eventInfo) => <EventPill eventInfo={eventInfo} />}
              dayCellTopContent={(args) => (
                <DayCellContent
                  dayNumberText={args.dayNumberText}
                  isToday={args.isToday}
                />
              )}
              height="auto"
              showNonCurrentDates={false}
              fixedWeekCount={false}
              dayMaxEvents={4}
              moreLinkClick="popover"
              nowIndicator
            />
          </div>
        </div>
      </div>

      {/* ── Mobile Add button ─────────────────────────────────────────────── */}
      <div className="lg:hidden flex justify-end">
        <button
          onClick={() => setModal({ open: true, event: null, defaultDate: null })}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          + Add Event
        </button>
      </div>

      {/* ── Modals / Popovers ─────────────────────────────────────────────── */}
      {popover && (
        <CalendarEventPopover
          date={popover.date}
          events={popover.events}
          onClose={() => setPopover(null)}
          onAddEvent={(date) => { setPopover(null); setModal({ open: true, event: null, defaultDate: date }); }}
          onEditEvent={(ev) => { setPopover(null); setModal({ open: true, event: ev.raw ?? ev, defaultDate: null }); }}
        />
      )}

      <CalendarEventModal
        open={modal.open}
        event={modal.event}
        defaultDate={modal.defaultDate}
        onClose={() => setModal({ open: false, event: null, defaultDate: null })}
      />

      {showSubscribe && <SubscribePanel onClose={() => setShowSubscribe(false)} />}
    </div>
  );
}
