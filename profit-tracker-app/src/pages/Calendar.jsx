import { useEffect, useRef, useState, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import breezyTheme from '@fullcalendar/react/themes/breezy';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/breezy/theme.css';
import '@fullcalendar/react/themes/breezy/palettes/rose.css';
import {
  CalendarDays,
  ShoppingBag, DollarSign, Banknote, Link2, Copy, Check, CreditCard, Bell,
} from 'lucide-react';
import { useCalendarEvents, useCalendarAutoEvents, useCalendarToken } from '../hooks/useApi';
import CalendarEventModal from '../components/Calendar/CalendarEventModal';
import CalendarEventPopover from '../components/Calendar/CalendarEventPopover';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import LoadError from '../components/UI/LoadError';
import { useMatchMedia } from '../hooks/useMatchMedia';

// ─── Color maps ───────────────────────────────────────────────────────────────
const TYPE_COLOR = {
  purchase:    '#2563eb',
  sale:        '#16a34a',
  payout:      '#059669',
  manual:      'var(--dp-accent)', // theme accent
  credit_due:  '#dc2626',
  reminder:    '#e11d48',
};

const NAMED_COLOR = {
  purple: 'var(--dp-accent)', // stored value kept for old events; shows the theme accent
  blue:   '#2563eb',
  green:  '#16a34a',
  amber:  '#d97706',
  red:    '#dc2626',
};

function eventBgColor(ev) {
  if (ev.color && NAMED_COLOR[ev.color]) return NAMED_COLOR[ev.color];
  return TYPE_COLOR[ev.type] ?? 'var(--dp-accent)';
}

// The app's light/dark mode, so the calendar's Breezy theme follows it.
function useColorScheme() {
  const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [scheme, setScheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return scheme;
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

        <p className="text-[11px] text-[var(--dp-text-muted)]">
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
  const colorScheme = useColorScheme();
  const [currentMonth, setCurrentMonth] = useState(() => toMonthStr(new Date()));
  // Phones: a month cell is ~45px wide, too narrow for event titles, so each
  // event is a coloured dot and tapping a day lists that day's events.
  const isPhone = useMatchMedia('(max-width: 767px)');
  const [popover, setPopover] = useState(null); // { date, events }
  const [modal, setModal] = useState({ open: false, event: null, defaultDate: null });
  const [showSubscribe, setShowSubscribe] = useState(false);

  const { data: manualEvents = [], isLoadingError: manualFailed, refetch: refetchManual } = useCalendarEvents(currentMonth);
  const { data: autoEvents = [], isLoadingError: autoFailed, refetch: refetchAuto } = useCalendarAutoEvents(currentMonth);

  // Merge and shape events for FullCalendar
  const fcEvents = useMemo(() => {
    return [...autoEvents, ...manualEvents].map(ev => ({
      id: ev.id,
      title: ev.title,
      start: ev.date,
      end: ev.end_date || undefined,
      color: eventBgColor(ev),
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
    if (isPhone) {
      // The day's events, with "Add event" in the same panel.
      const eventsOnDay = [...autoEvents, ...manualEvents].filter(e => e.date === info.dateStr);
      setPopover({ date: info.dateStr, events: eventsOnDay });
      return;
    }
    setModal({ open: true, event: null, defaultDate: info.dateStr });
  };

  const handleMoreLinkClick = (info) => {
    const date = toDateStr(info.date);
    const eventsOnDay = [...autoEvents, ...manualEvents].filter(e => e.date === date);
    setPopover({ date, events: eventsOnDay });
  };

  // Title label for header
  const monthEvents = [...autoEvents, ...manualEvents]
    .filter(ev => ev.date?.startsWith(currentMonth))
    .sort((a, b) => a.date.localeCompare(b.date));


  if (manualFailed || autoFailed) {
    return (
      <LoadError
        title="Calendar"
        what="your calendar"
        onRetry={() => {
          if (manualFailed) refetchManual();
          if (autoFailed) refetchAuto();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto lg:overflow-hidden px-4 py-6 sm:px-6 gap-4">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Calendar</h1>
          <p className="text-xs text-[var(--dp-text-muted)] mt-0.5">Track purchases, sales, payouts and custom events</p>
        </div>
        <button
          onClick={() => setShowSubscribe(true)}
          className="page-btn page-btn-secondary"
        >
          <Link2 size={13} />
          Subscribe to Calendar
        </button>
      </div>

      {/* ── Calendar card ─────────────────────────────────────────────────── */}
      <div className="shrink-0 lg:shrink lg:flex-1 flex flex-col lg:min-h-0 bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-2xl dp-elevated overflow-hidden">
        {/* Legend + Calendar */}
        <div className="flex lg:flex-1 lg:min-h-0 lg:overflow-hidden">
          {/* Legend */}
          <div className="hidden lg:flex flex-col gap-3 px-4 py-4 border-r border-[color:var(--dp-border)] min-w-[140px] w-36 bg-[var(--dp-card-bg)]">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--dp-text-label)]">Legend</p>
            {[
              { color: '#2563eb', label: 'Purchase',  icon: ShoppingBag },
              { color: '#16a34a', label: 'Sale',       icon: DollarSign },
              { color: '#059669', label: 'Payout',     icon: Banknote },
              { color: 'var(--dp-accent)', label: 'Manual',     icon: CalendarDays },
              { color: '#dc2626', label: 'CC Due',     icon: CreditCard },
              { color: '#e11d48', label: 'Reminder',   icon: Bell },
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
            <FullCalendar
              ref={calendarRef}
              plugins={[breezyTheme, dayGridPlugin, timeGridPlugin, interactionPlugin]}
              colorScheme={colorScheme}
              initialView="dayGridMonth"
              headerToolbar={{ start: 'prev,next today', center: 'title', end: 'dayGridMonth,timeGridWeek' }}
              events={fcEvents}
              eventClick={handleEventClick}
              dateClick={handleDateClick}
              datesSet={handleDatesSet}
              height="auto"
              fixedWeekCount={false}
              dayMaxEvents={isPhone ? 3 : 4}
              moreLinkClick={handleMoreLinkClick}
              eventDisplay={isPhone ? 'list-item' : 'auto'}
              eventContent={isPhone ? (arg) => (
                <span
                  aria-label={arg.event.title}
                  title={arg.event.title}
                  className="mx-auto block h-2 w-2 rounded-full"
                  style={{ backgroundColor: eventBgColor(arg.event.extendedProps.raw) }}
                />
              ) : undefined}
              nowIndicator
            />
          </div>
        </div>
      </div>

      {/* Phone: month cells only have room for dots, so the events are listed here */}
      {monthEvents.length > 0 && (
        <div className="md:hidden rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] divide-y divide-[color:var(--dp-border)]">
          {monthEvents.map(ev => (
            <button
              key={ev.id}
              type="button"
              onClick={() => setPopover({ date: ev.date, events: [...autoEvents, ...manualEvents].filter(e => e.date === ev.date) })}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: eventBgColor(ev) }} />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--dp-text-primary)]">{ev.title}</span>
              <span className="shrink-0 text-xs text-[var(--dp-text-secondary)]">
                {new Date(`${ev.date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </button>
          ))}
        </div>
      )}

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
