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
import { useModalKeyboard } from '../hooks/useModalKeyboard';

// ─── Color maps ───────────────────────────────────────────────────────────────
const TYPE_COLOR = {
  purchase:    '#2563eb',
  sale:        '#16a34a',
  payout:      '#059669',
  manual:      '#7c3aed',
  credit_due:  '#dc2626',
};

const NAMED_COLOR = {
  purple: '#7c3aed',
  blue:   '#2563eb',
  green:  '#16a34a',
  amber:  '#d97706',
  red:    '#dc2626',
};

function eventBgColor(ev) {
  if (ev.color && NAMED_COLOR[ev.color]) return NAMED_COLOR[ev.color];
  return TYPE_COLOR[ev.type] ?? '#7c3aed';
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
          fontWeight: isToday ? 700 : 500,
          color: isToday ? '#ffffff' : 'var(--dp-text-secondary)',
          backgroundColor: isToday ? 'var(--dp-accent)' : 'transparent',
          borderRadius: '50%',
          width: isToday ? '20px' : 'auto',
          height: isToday ? '20px' : 'auto',
          lineHeight: isToday ? '20px' : 'normal',
          textAlign: 'center',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: isToday ? '0 2px 6px rgba(124, 58, 237, 0.35)' : 'none',
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

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function SubscribePanel({ onClose }) {
  const { data, isLoading } = useCalendarToken();
  const [copied, setCopied] = useState(false);
  const modalRef = useModalKeyboard(true, onClose);

  const handleCopy = () => {
    if (!data?.feedUrl) return;
    navigator.clipboard.writeText(data.feedUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={onClose} />
      <div ref={modalRef} className="relative z-10 w-full max-w-lg bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-2xl dp-elevated p-6 space-y-4 text-[var(--dp-text-primary)]">
        <h2 className="text-base font-semibold text-[var(--dp-text-primary)] flex items-center gap-2">
          <Link2 size={16} className="text-[var(--dp-accent)]" />
          Subscribe to Calendar
        </h2>
        <p className="text-sm text-[var(--dp-text-secondary)]">
          Add your Profit Tracker calendar to Google Calendar, Apple Calendar, or Outlook.
          It updates automatically whenever you record sales, purchases, payouts, or calendar events.
        </p>

        {isLoading ? (
          <div className="h-10 bg-[var(--dp-hover-bg)] rounded-lg animate-pulse" />
        ) : (
          <div className="flex items-center gap-2 bg-[var(--dp-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2">
            <span className="flex-1 text-xs text-[var(--dp-text-primary)] truncate font-mono">{data?.feedUrl}</span>
            <button
              onClick={handleCopy}
              className="flex-shrink-0 flex items-center gap-1 text-xs text-[var(--dp-accent)] hover:text-[var(--dp-text-primary)] transition-colors px-2 py-1 rounded hover:bg-[var(--dp-accent-bg)]"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        <div className="space-y-2 text-xs text-[var(--dp-text-muted)]">
          <p className="font-medium text-[var(--dp-text-secondary)]">How to subscribe:</p>
          <p><span className="text-[var(--dp-text-primary)] font-medium">Google Calendar:</span> Other calendars → + → From URL → paste the link above</p>
          <p><span className="text-[var(--dp-text-primary)] font-medium">Apple Calendar:</span> File → New Calendar Subscription → paste the link above</p>
          <p><span className="text-[var(--dp-text-primary)] font-medium">Outlook:</span> Add calendar → Subscribe from web → paste the link above</p>
        </div>

        <p className="text-[10px] text-[var(--dp-text-muted)]">
          Keep this link private — anyone with it can view your calendar events. If you subscribed before this update, replace the old link with this one.
        </p>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] rounded-lg transition-colors border border-[color:var(--dp-border)]"
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

  const handleMoreLinkClick = (info) => {
    const date = toDateStr(info.date);
    const eventsOnDay = [...autoEvents, ...manualEvents].filter(e => e.date === date);
    setPopover({ date, events: eventsOnDay });
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
          <h1 className="text-xl font-semibold text-[var(--dp-text-primary)] flex items-center gap-2">
            <CalendarDays size={20} className="text-[var(--dp-accent)]" />
            Reselling Calendar
          </h1>
          <p className="text-xs text-[var(--dp-text-muted)] mt-0.5">Track purchases, sales, payouts and custom events</p>
        </div>
        <button
          onClick={() => setShowSubscribe(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] bg-[var(--dp-card-bg)] rounded-lg transition-colors shadow-xs"
        >
          <Link2 size={13} />
          Subscribe to Calendar
        </button>
      </div>

      {/* ── Calendar card ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-2xl dp-elevated overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--dp-border)] gap-2 flex-wrap">
          {/* Nav */}
          <div className="flex items-center gap-1">
            <button onClick={goPrev} className="p-1.5 rounded-lg text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors"><ChevronLeft size={16} /></button>
            <button onClick={goToday} className="px-2.5 py-1 text-xs font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] rounded-lg transition-colors border border-[color:var(--dp-border)]">Today</button>
            <button onClick={goNext} className="p-1.5 rounded-lg text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors"><ChevronRight size={16} /></button>
            <span className="text-sm font-semibold text-[var(--dp-text-primary)] ml-1">{monthLabel}</span>
          </div>

          {/* View toggle */}
          <div className="flex items-center bg-[var(--dp-bg)] border border-[color:var(--dp-border)] rounded-lg p-0.5">
            {[['dayGridMonth', 'Month'], ['timeGridWeek', 'Week']].map(([v, label]) => (
              <button
                key={v}
                onClick={() => changeView(v)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${view === v ? 'bg-[var(--dp-accent)] text-[#ffffff] shadow-xs' : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Legend + Calendar */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Legend */}
          <div className="hidden lg:flex flex-col gap-3 px-4 py-4 border-r border-[color:var(--dp-border)] min-w-[140px] w-36 bg-[var(--dp-card-bg)]">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-[var(--dp-text-label)]">Legend</p>
            {[
              { color: '#2563eb', label: 'Purchase',  icon: ShoppingBag },
              { color: '#16a34a', label: 'Sale',       icon: DollarSign },
              { color: '#059669', label: 'Payout',     icon: Banknote },
              { color: '#7c3aed', label: 'Manual',     icon: CalendarDays },
              { color: '#dc2626', label: 'CC Due',     icon: CreditCard },
            ].map(({ color, label, icon: Icon }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs text-[var(--dp-text-secondary)]">{label}</span>
              </div>
            ))}

            <div className="mt-auto pt-4 border-t border-[color:var(--dp-border)]">
              <button
                onClick={() => setModal({ open: true, event: null, defaultDate: null })}
                className="w-full text-xs font-medium text-[var(--dp-accent)] hover:bg-[var(--dp-accent-bg)] rounded-lg py-1.5 px-2 transition-colors text-left"
              >
                + Add event
              </button>
            </div>
          </div>

          {/* FullCalendar */}
          <div className="flex-1 min-w-0 overflow-auto p-2 calendar-wrapper bg-[var(--dp-card-bg)]">
            <style>{`
              .calendar-wrapper a { color: inherit; text-decoration: none; }
              .calendar-wrapper [class*="fc-"] { font-size: 11px; color: var(--dp-text-secondary); }
              .calendar-wrapper [role="columnheader"] { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dp-text-label) !important; padding: 8px 0 !important; background: var(--dp-bg) !important; border-color: var(--dp-border) !important; }
              .calendar-wrapper [role="gridcell"] { border: 1px solid var(--dp-border) !important; min-height: 100px !important; vertical-align: top !important; background-color: var(--dp-card-bg) !important; }
              .calendar-wrapper [role="gridcell"][aria-current="date"] { background-color: var(--dp-accent-bg) !important; box-shadow: inset 0 0 0 1px var(--dp-accent) !important; }
              .calendar-wrapper [class*="moreLinkText"], .calendar-wrapper [class*="moreLink"] { color: var(--dp-text-muted) !important; font-size: 10px !important; }
              .calendar-wrapper .fc-theme-standard td, .calendar-wrapper .fc-theme-standard th { border-color: var(--dp-border) !important; }
              .calendar-wrapper .fc-scrollgrid { border-color: var(--dp-border) !important; }
              .calendar-wrapper .fc-daygrid-day-frame { background-color: var(--dp-card-bg); }
              .calendar-wrapper .fc-day-other { background-color: var(--dp-bg) !important; opacity: 0.6; }
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
              moreLinkClick={handleMoreLinkClick}
              nowIndicator
            />
          </div>
        </div>
      </div>

      {/* ── Mobile Add button ─────────────────────────────────────────────── */}
      <div className="lg:hidden flex justify-end">
        <button
          onClick={() => setModal({ open: true, event: null, defaultDate: null })}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-[#ffffff] rounded-xl transition-colors shadow-xs"
          style={{ backgroundColor: 'var(--dp-accent)' }}
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
