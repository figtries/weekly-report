'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ---------------------------------------------------------------------------
 * A date field that is entirely ours.
 *
 * <input type="date"> draws its own calendar button, and that button is not a
 * DOM node we can reach: Chrome renders it inside the input's shadow tree, so
 * it ignores where we ask it to sit (it parks itself right behind the digits,
 * mid-field, and no amount of flex or auto margins moves it), it looks like
 * Chrome rather than like this app, and iOS Safari does not draw it at all —
 * the same field silently loses its only affordance on the phones this app is
 * mostly used on. None of that is fixable from CSS, so the native control is
 * gone and this replaces it: our own trigger with our own calendar mark, and
 * our own panel underneath, identical on a desktop and on an iPhone.
 *
 * The value stays a plain YYYY-MM-DD string, so callers are unchanged.
 * ------------------------------------------------------------------------- */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
/** Monday-first, matching how the reports themselves count a week. */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Breathing room under the trigger, and against the screen edge. */
const GAP_PX = 8;
const EDGE_PX = 12;
const MIN_W_PX = 296;
const MAX_W_PX = 340;

/** All arithmetic is on UTC parts: a local-midnight Date east of GMT rolls back
 *  a day the moment it is formatted, which is how date pickers end up one day
 *  off for exactly the users in Asia. */
function parse(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return { y: Number(y), m: Number(m) - 1, d: Number(d) };
}

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysIn(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Weekday of the 1st, shifted so Monday is column 0. */
function leadingBlanks(y: number, m: number) {
  return (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
}

function todayIso() {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth(), now.getDate());
}

export default function DateField({
  id,
  value,
  onChange,
  disabled,
  className = '',
  placeholder = 'Select date',
  clearable = false,
}: {
  id?: string;
  /** YYYY-MM-DD, or '' for empty. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Styles the trigger, so a caller can match the inputs standing next to it. */
  className?: string;
  placeholder?: string;
  clearable?: boolean;
}) {
  const picked = parse(value);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Set when a click outside dismissed the panel, so the same gesture does not
   *  also reach whatever is behind it — tapping beside the calendar inside the
   *  New Daily dialog would otherwise close the dialog too, throwing away the
   *  date the user just came to pick. */
  const swallowClick = useRef(false);

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  /** The month on show, and the day the keyboard is on. */
  const [view, setView] = useState({ y: picked?.y ?? 2000, m: picked?.m ?? 0 });
  const [active, setActive] = useState('');
  const [place, setPlace] = useState<{ left: number; top: number; width: number; above: boolean } | null>(null);

  /** Today per the user's own clock, not UTC — "today" is a local idea. Read
   *  after mount so the server and the first client render agree. */
  const [today, setToday] = useState('');
  useEffect(() => setToday(todayIso()), []);

  function closePanel() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setPlace(null);
    }, 140);
  }

  function openPanel() {
    const start = parse(value) ?? parse(todayIso())!;
    setView({ y: start.y, m: start.m });
    setActive(iso(start.y, start.m, start.d));
    setClosing(false);
    setOpen(true);
  }

  // Fixed and portalled to <body>, not absolute next to the trigger: this field
  // sits inside the New Daily dialog, whose card keeps a transform after its
  // entrance animation, and a transformed ancestor becomes the containing block
  // for fixed children — the panel would be trapped inside the card and clipped.
  const measure = (fresh: boolean) => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = panelRef.current?.offsetHeight ?? 0;
    const width = Math.min(MAX_W_PX, Math.max(MIN_W_PX, r.width), window.innerWidth - EDGE_PX * 2);
    const left = Math.max(EDGE_PX, Math.min(r.left, window.innerWidth - EDGE_PX - width));
    setPlace((prev) => {
      // Below by preference; above only when the bottom of the screen is closer
      // than the panel is tall. Decided once, when the panel opens: re-deciding
      // on every scroll event would make it hop over the field mid-gesture.
      const above =
        prev && !fresh
          ? prev.above
          : r.bottom + GAP_PX + h > window.innerHeight - EDGE_PX && r.top - GAP_PX - h >= EDGE_PX;
      const wanted = above ? r.top - GAP_PX - h : r.bottom + GAP_PX;
      // On a screen too short for either side (a phone held sideways) neither
      // fits — sit as close as possible while staying wholly on screen.
      const top = Math.max(EDGE_PX, Math.min(wanted, window.innerHeight - EDGE_PX - h));
      return { left, width, above, top };
    });
  };

  // Height is only known once the panel has rendered, so the first pass places
  // it with h = 0 and this corrects it before paint.
  useLayoutEffect(() => {
    if (open) measure(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Follow the trigger rather than closing on it: a phone often has to scroll
  // the field into a comfortable spot with the panel already open.
  useEffect(() => {
    if (!open) return;
    const follow = () => measure(false);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      swallowClick.current = true;
      closePanel();
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture, and stopped here: inside the New Daily dialog, Escape would
      // otherwise close the whole dialog out from under the panel.
      e.stopPropagation();
      closePanel();
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The keyboard drives a cursor over the grid, so the panel is as usable
  // without a mouse as the native field it replaces.
  useEffect(() => {
    if (!open || !place || !active) return;
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${active}"]`)?.focus();
  }, [open, place, active]);

  function moveActive(days: number, months = 0) {
    const cur = parse(active);
    if (!cur) return;
    const next = new Date(Date.UTC(cur.y, cur.m + months, cur.d + days));
    const y = next.getUTCFullYear();
    const m = next.getUTCMonth();
    setView({ y, m });
    setActive(iso(y, m, next.getUTCDate()));
  }

  function onPanelKey(e: React.KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => moveActive(-1),
      ArrowRight: () => moveActive(1),
      ArrowUp: () => moveActive(-7),
      ArrowDown: () => moveActive(7),
      PageUp: () => moveActive(0, -1),
      PageDown: () => moveActive(0, 1),
      Home: () => setActive(iso(view.y, view.m, 1)),
      End: () => setActive(iso(view.y, view.m, daysIn(view.y, view.m))),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  }

  function pick(y: number, m: number, d: number) {
    onChange(iso(y, m, d));
    closePanel();
    triggerRef.current?.focus();
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const next = new Date(Date.UTC(v.y, v.m + delta, 1));
      return { y: next.getUTCFullYear(), m: next.getUTCMonth() };
    });
  }

  const label = picked ? `${String(picked.d).padStart(2, '0')} ${SHORT_MONTHS[picked.m]} ${picked.y}` : placeholder;

  // A fixed six-row grid, so the panel does not change height from month to
  // month and jump under the finger halfway through picking.
  const blanks = leadingBlanks(view.y, view.m);
  const count = daysIn(view.y, view.m);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const dayNo = i - blanks + 1;
    return dayNo < 1 || dayNo > count ? null : dayNo;
  });

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? closePanel() : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-2 text-left ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate tabular-nums ${picked ? '' : 'text-gray-400'}`}>{label}</span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden
          className={`h-[18px] w-[18px] shrink-0 transition-colors duration-200 ${
            open ? 'text-blue-600' : 'text-gray-400'
          }`}
        >
          <rect x="2.75" y="4.75" width="14.5" height="12.5" rx="3.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2.75 8.75h14.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6.75 2.75v3.5M13.25 2.75v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="12.75" r="1.4" fill="currentColor" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Choose a date"
            onKeyDown={onPanelKey}
            className={`scrollbar-none fixed z-[70] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5 ${
              closing ? 'animate-dropdown-out' : 'animate-dropdown-in'
            }`}
            // Parked off-screen — NOT visibility:hidden — until it has been
            // measured. A hidden element cannot take focus, and the days below
            // transition, so they kept inheriting the tail of that hidden for
            // 150ms and swallowed the keyboard focus this panel opens with.
            // The layout effect places it before the first paint either way, so
            // nobody ever sees -9999.
            style={{
              left: place?.left ?? -9999,
              top: place?.top ?? -9999,
              width: place?.width ?? MIN_W_PX,
              maxHeight: `calc(100dvh - ${EDGE_PX * 2}px)`,
              transformOrigin: place?.above ? 'bottom left' : 'top left',
            }}
          >
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="rounded-lg p-1.5 text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 active:scale-[0.94]"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-sm font-semibold text-gray-900">
                {MONTHS[view.m]} {view.y}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
                className="rounded-lg p-1.5 text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 active:scale-[0.94]"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <div className="mt-2 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1 text-center text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  {w}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d, i) => {
                if (d === null) return <span key={i} className="h-9" />;
                const cellIso = iso(view.y, view.m, d);
                const isPicked = cellIso === value;
                const isToday = cellIso === today;
                return (
                  <button
                    key={i}
                    type="button"
                    data-iso={cellIso}
                    tabIndex={cellIso === active ? 0 : -1}
                    onClick={() => pick(view.y, view.m, d)}
                    aria-pressed={isPicked}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={`${d} ${MONTHS[view.m]} ${view.y}`}
                    className={`h-9 rounded-lg text-sm tabular-nums transition-[color,background-color,box-shadow,transform] duration-150 ease-ios focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 active:scale-[0.92] ${
                      isPicked
                        ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                        : isToday
                          ? 'font-semibold text-blue-600 ring-1 ring-inset ring-blue-200 hover:bg-blue-50'
                          : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
              <button
                type="button"
                onClick={() => {
                  const t = parse(todayIso())!;
                  pick(t.y, t.m, t.d);
                }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition-colors duration-150 hover:bg-blue-50"
              >
                Today
              </button>
              {clearable && value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    closePanel();
                    triggerRef.current?.focus();
                  }}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
