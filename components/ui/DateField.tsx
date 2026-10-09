'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

/** The nearest ancestor that actually scrolls: this app scrolls <main> and its
 *  sheets, never the document. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
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
  defaultOpen = false,
  onClose,
  children,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
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
  /** Opens on mount: a sheet cell that is already being edited. */
  defaultOpen?: boolean;
  /** Called whenever the panel closes, picked or not. */
  onClose?: () => void;
  /** Replaces the label and mark inside the trigger; `className` then styles it alone. */
  children?: ReactNode;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
}) {
  const picked = parse(value);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Set when a click outside dismissed the panel, so the same gesture does not
   *  also reach whatever is behind it — tapping beside the calendar inside the
   *  New Daily dialog would otherwise close the dialog too, throwing away the
   *  date the user just came to pick. */
  const swallowClick = useRef(false);
  const spacer = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  /** The month on show, and the day the keyboard is on. */
  const [view, setView] = useState({ y: picked?.y ?? 2000, m: picked?.m ?? 0 });
  const [active, setActive] = useState('');
  /** Days, or one level up: tap the title for months, tap again for years,
   *  so a far date is two taps away instead of a dozen arrows. */
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
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
      spacer.current?.remove();
      spacer.current = null;
      onClose?.();
    }, 140);
  }

  function openPanel() {
    const start = parse(value) ?? parse(todayIso())!;
    setView({ y: start.y, m: start.m });
    setActive(iso(start.y, start.m, start.d));
    setMode('days');
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
    let r = el.getBoundingClientRect();
    const h = panelRef.current?.offsetHeight ?? 0;
    // No room underneath: scroll the field up rather than flip the panel over
    // whatever sits above it, so the calendar always hangs off its own field.
    const short = r.bottom + GAP_PX + h - (window.innerHeight - EDGE_PX);
    // A field near the end of its sheet has nothing left to scroll, so a spacer
    // lends the room while the panel is open (the keyboard trick iOS plays).
    const sp = fresh && short > 0 ? scrollParent(el) : null;
    // ...but never so far that the field itself slides out of its sheet.
    if (sp && r.top - short >= sp.getBoundingClientRect().top) {
      const room = sp.scrollHeight - sp.clientHeight - sp.scrollTop;
      if (room < short) {
        const pad = document.createElement('div');
        pad.style.cssText = `flex:none;height:${short - room}px`;
        pad.setAttribute('aria-hidden', 'true');
        sp.appendChild(pad);
        spacer.current = pad;
      }
      sp.scrollTop += short;
      r = el.getBoundingClientRect();
    }
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
  useEffect(() => {
    if (defaultOpen) openPanel();
    return () => spacer.current?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!open || !place || !active || mode !== 'days') return;
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${active}"]`)?.focus();
  }, [open, place, active, mode]);

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
    // Kept inside the panel: the planner listens on the window, where Enter
    // adds a row and the arrows move the selection.
    e.stopPropagation();
    const run = mode === 'days' ? keys[e.key] : undefined;
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

  /** The arrows step one month, one year, or one page of years. */
  const step = (dir: number) => shiftMonth(dir * (mode === 'days' ? 1 : mode === 'months' ? 12 : 144));
  const decade = Math.floor(view.y / 12) * 12;
  const thisYear = today ? Number(today.slice(0, 4)) : null;
  const thisMonth = today ? Number(today.slice(5, 7)) - 1 : null;
  const tile = (on: boolean, now: boolean) =>
    `rounded-xl text-sm tabular-nums transition-[color,background-color,transform] duration-150 ease-ios focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.95] ${
      on
        ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
        : now
          ? 'font-semibold text-primary ring-1 ring-inset ring-primary/30 hover:bg-primary/10'
          : 'text-foreground/80 hover:bg-muted'
    }`;

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
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        className={children ? className : `flex items-center gap-2 text-left ${className}`}
      >
        {children ?? (<>
        <span className={`min-w-0 flex-1 truncate tabular-nums ${picked ? '' : 'text-muted-foreground'}`}>{label}</span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden
          className={`h-[18px] w-[18px] shrink-0 transition-colors duration-200 ${
            open ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <rect x="2.75" y="4.75" width="14.5" height="12.5" rx="3.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2.75 8.75h14.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6.75 2.75v3.5M13.25 2.75v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="12.75" r="1.4" fill="currentColor" />
        </svg>
        </>)}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Choose a date"
            onKeyDown={onPanelKey}
            className={`scrollbar-none pointer-events-auto fixed z-[70] overflow-y-auto rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-black/5 ${
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
                onClick={() => step(-1)}
                aria-label="Previous"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-[0.94]"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              {mode === 'years' ? (
                <span className="px-2 text-sm font-semibold tabular-nums text-foreground">
                  {decade} – {decade + 11}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setMode(mode === 'days' ? 'months' : 'years')}
                  aria-label={mode === 'days' ? 'Choose month and year' : 'Choose year'}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold tabular-nums text-foreground transition-colors duration-150 hover:bg-muted active:scale-[0.97]"
                >
                  {mode === 'days' ? `${MONTHS[view.m]} ${view.y}` : view.y}
                  <svg className="h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-[0.94]"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* The day grid stays laid out under the month and year grids, so
                the panel keeps one height whichever level is on show. */}
            <div className="relative">
            {mode !== 'days' && (
              <div className="animate-fade-in-up absolute inset-0 z-10 grid grid-cols-3 gap-1.5 bg-popover pt-2">
                {mode === 'months'
                  ? SHORT_MONTHS.map((name, mi) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => { setView({ y: view.y, m: mi }); setMode('days'); }}
                        className={tile(picked?.y === view.y && picked.m === mi, thisYear === view.y && thisMonth === mi)}
                      >
                        {name}
                      </button>
                    ))
                  : Array.from({ length: 12 }, (_, i) => decade + i).map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => { setView({ y, m: view.m }); setMode('months'); }}
                        className={tile(picked?.y === y, thisYear === y)}
                      >
                        {y}
                      </button>
                    ))}
              </div>
            )}
            <div aria-hidden={mode !== 'days' || undefined} className={mode !== 'days' ? 'invisible' : undefined}>
            <div className="mt-2 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
                    className={`h-9 rounded-lg text-sm tabular-nums transition-[color,background-color,box-shadow,transform] duration-150 ease-ios focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.92] ${
                      isPicked
                        ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                        : isToday
                          ? 'font-semibold text-primary ring-1 ring-inset ring-primary/30 hover:bg-primary/10'
                          : 'text-foreground/80 hover:bg-muted'
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            </div>
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() => {
                  const t = parse(todayIso())!;
                  pick(t.y, t.m, t.d);
                }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary/10"
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
                  className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
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
