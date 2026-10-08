'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

type Option = { value: string; label: React.ReactNode; disabled?: boolean; title?: string };

/** The `<option>`s a caller wrote, read back as data for the drawn list. */
function optionsOf(children: React.ReactNode): Option[] {
  const out: Option[] = [];
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement(c)) return;
    const p = c.props as { value?: unknown; children?: React.ReactNode; disabled?: boolean; title?: string };
    if (c.type === React.Fragment) out.push(...optionsOf(p.children));
    else if (c.type === 'option')
      out.push({
        value: String(p.value ?? (typeof p.children === 'string' ? p.children : '')),
        label: p.children,
        disabled: p.disabled,
        title: p.title,
      });
  });
  return out;
}

/**
 * Every dropdown in the app, drawn the way the week picker draws its list.
 *
 * It used to hand the list to the platform, and the platform drew a square grey
 * menu with a blue bar that matched nothing on screen (8 Oct 2026: "pakai
 * template biasa"). The week picker's list was the one people liked: a rounded
 * panel exactly under the field and as wide as it, rows with room, the chosen
 * one marked with a tick (green stays the week picker's: it means the
 * CURRENT week, and nothing else here has one). So this draws that list for every `<select>`.
 *
 * Callers still write a `<select>`'s props and `<option>` children, and still
 * get a real ChangeEvent: a hidden native `<select>` carries `name`, `value`
 * and the form, and a pick sets its value and fires `change` on it, which is
 * what React listens to. Nothing that called this had to change.
 *
 * NOT Radix, and that is the repo's standing rule: some of these sit inside
 * rows that can run to hundreds. A closed one is a button and a hidden select;
 * the list, its listeners and its portal exist only while it is open.
 *
 * The panel is PORTALLED to the body for the reason `WeekSelect` gives: a
 * header's leftover transform is a stacking context no z-index climbs out of.
 * It takes pointer events back explicitly, because a modal that disables
 * them on the body would otherwise leave the list unpressable.
 */
export default function NativeSelect({
  className,
  wrapperClassName,
  children,
  compact = false,
  value,
  defaultValue,
  onChange,
  name,
  required,
  form,
  disabled,
  id,
  ...rest
}: React.ComponentProps<'select'> & {
  /** For a control riding inside a dense strip rather than a form row. */
  compact?: boolean;
  /**
   * Goes on the positioning wrapper, which is what a parent grid or flex row
   * actually lays out. Placement classes on `className` would land on the
   * trigger inside and do nothing.
   */
  wrapperClassName?: string;
}) {
  const options = optionsOf(children);
  const [inner, setInner] = React.useState(() =>
    defaultValue != null ? String(defaultValue) : (optionsOf(children)[0]?.value ?? '')
  );
  const current = value !== undefined ? String(value) : inner;
  const selected = options.find((o) => o.value === current);

  const [open, setOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [anchor, setAnchor] = React.useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
    flip: boolean;
  } | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const selectRef = React.useRef<HTMLSelectElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // WeekSelect's measure: under the trigger and as wide as it, flipped above
  // when there is more room up there. A trigger narrower than a row with its
  // tick (the currency chip) gets a panel just wide enough, still left-aligned.
  const measure = React.useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const width = Math.max(r.width, 84);
    const below = window.innerHeight - r.bottom - gap - 8;
    const above = r.top - gap - 8;
    const flip = below < 200 && above > below;
    setAnchor({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: flip ? undefined : r.bottom + gap,
      bottom: flip ? window.innerHeight - r.top + gap : undefined,
      width,
      maxHeight: Math.max(140, Math.min(288, flip ? above : below)),
      flip,
    });
  }, []);

  function close() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 120);
  }

  function toggle() {
    if (open) return close();
    setActive(options.findIndex((o) => o.value === current));
    measure();
    setOpen(true);
  }

  function pick(v: string) {
    close();
    if (v === current) return;
    setInner(v);
    const el = selectRef.current;
    if (!el) return;
    // The value setter React's own tracker reads, then the event it listens to.
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function move(from: number, step: number) {
    for (let i = from + step; i >= 0 && i < options.length; i += step) {
      if (!options[i].disabled) return setActive(i);
    }
  }

  // While open: follow the page (capture, because `<main>` scrolls and not the
  // document), close on a press anywhere else, and take Escape before a
  // dialog's own capture listener can close the dialog under the list.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, measure]);

  // Opens on the chosen row, in the middle of the list, then follows the keys.
  React.useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const target = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && target) list.scrollTop = target.offsetTop - (list.clientHeight - target.offsetHeight) / 2;
  }, [open]);

  React.useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === 'Tab') close();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(active, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(-1, 1);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(options.length, -1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = options[active];
      if (o && !o.disabled) pick(o.value);
    }
  }

  return (
    <div ref={rootRef} className={cn('relative w-full', wrapperClassName)}>
      <select
        ref={selectRef}
        hidden
        tabIndex={-1}
        aria-hidden
        name={name}
        required={required}
        form={form}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
      >
        {children}
      </select>
      <button
        {...(rest as React.ComponentProps<'button'>)}
        id={id}
        type="button"
        data-slot="select"
        disabled={disabled}
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex w-full min-w-0 items-center rounded-lg border border-input bg-transparent text-left outline-none transition-colors',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30',
          compact
            ? 'h-8 min-h-11 pl-2 pr-7 text-[11px] font-medium sm:min-h-0'
            : 'h-8 min-h-11 py-1 pl-2.5 pr-8 text-base sm:min-h-0 md:text-sm',
          className
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
      </button>
      <svg
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground transition-transform duration-200 ease-ios',
          compact ? 'right-2 size-3' : 'right-2.5 size-4',
          open && !closing && 'rotate-180'
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            // Keeps focus (and a dialog's focus trap) on the trigger.
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              left: anchor.left,
              top: anchor.top,
              bottom: anchor.bottom,
              width: anchor.width,
              zIndex: 70,
              pointerEvents: 'auto',
              transformOrigin: anchor.flip ? 'bottom left' : 'top left',
            }}
            className={cn(
              'overflow-hidden rounded-xl border bg-popover p-1 shadow-xl ring-1 ring-foreground/10',
              closing ? 'animate-dropdown-out' : 'animate-dropdown-in'
            )}
          >
            <div ref={listRef} style={{ maxHeight: anchor.maxHeight }} className="scrollbar-none overflow-y-auto">
              {options.map((o, i) => {
                const isSelected = o.value === current;
                return (
                  <button
                    key={o.value}
                    type="button"
                    tabIndex={-1}
                    role="option"
                    data-idx={i}
                    aria-selected={isSelected}
                    disabled={o.disabled}
                    title={o.title}
                    onClick={() => pick(o.value)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150 disabled:opacity-40 sm:min-h-9',
                      isSelected
                        ? 'bg-muted font-semibold text-foreground'
                        : i === active
                          ? 'bg-muted/60 font-medium text-foreground'
                          : 'font-medium text-foreground'
                    )}
                  >
                    <span className="min-w-0">{o.label}</span>
                    {isSelected && (
                      <svg
                        className="size-4 shrink-0 text-foreground"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                        aria-hidden
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
