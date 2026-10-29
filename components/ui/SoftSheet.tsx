'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

/*
 * Every pop-up in the app opens the way Data Overall's activity sheet does
 * (15 Oct 2026, his pick: "persis dengan animasi munculnya yang di data
 * overall"). On a phone the card slides up from below the screen in 0.5s on
 * `--ease-ios` over a fading dark scrim, leaves the same way backwards, and can
 * be flicked down by its handle. From `sm` it stays where it always was, centred,
 * rising and fading on the same curve and time. The motion is the CSS keyframes
 * `.animate-sheet-rise` / `.animate-sheet-fall` (app/globals.css), never
 * framer-motion: a spring over the page stuttered on every device (25 Sep 2026).
 *
 * Measured at CPU 4x (15 Oct 2026), two things this must never bring back:
 * framer's `drag` on the card, whose projection measured the scroll of the whole
 * planner on mount (46 ms before the first frame of Bars), and Radix Dialog,
 * whose aria-hidden on the rest of the page recalculated every style in it on
 * open AND close (45-160 ms, the Gantt PDF and Export Excel).
 */

const WIDTH = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  '2xl': 'sm:max-w-2xl',
} as const;

/**
 * The flick-to-close, from the handle only (the body is its own scroller and a
 * drag anywhere would eat every scroll), in the activity sheet's terms: the card
 * follows at 0.4 of the finger, and past 120 px or 600 px/s it goes. Pointer
 * events and a style write per move, no React state, so a move costs no render.
 */
function useFlick(onDismiss: () => void) {
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; dy: number; lastY: number; lastT: number; v: number } | null>(null);

  const end = (dismissable: boolean) => {
    const d = drag.current;
    const el = cardRef.current;
    drag.current = null;
    if (!d || !el) return;
    if (dismissable && (d.dy > 120 || d.v > 0.6)) {
      onDismiss();
      return;
    }
    el.style.transition = 'transform 0.3s var(--ease-ios)';
    el.style.transform = '';
  };

  const handleProps = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y0: e.clientY, dy: 0, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
      if (cardRef.current) cardRef.current.style.transition = 'none';
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      const el = cardRef.current;
      if (!d || !el) return;
      d.dy = Math.max(0, e.clientY - d.y0);
      d.v = (e.clientY - d.lastY) / Math.max(1, e.timeStamp - d.lastT);
      d.lastY = e.clientY;
      d.lastT = e.timeStamp;
      el.style.transform = d.dy ? `translate3d(0, ${d.dy * 0.4}px, 0)` : '';
    },
    onPointerUp: () => end(true),
    onPointerCancel: () => end(false),
  };

  return { cardRef, handleProps };
}

export default function SoftSheet({
  open,
  onClose,
  onExited,
  label,
  size = 'md',
  className,
  children,
}: {
  open: boolean;
  /** Scrim, Escape and the flick ask for this; the parent sets `open` false. */
  onClose: () => void;
  /** After the exit has played: for a parent that unmounts the sheet. */
  onExited?: () => void;
  label?: string;
  size?: keyof typeof WIDTH;
  /** The scrolling body: padding and layout. */
  className?: string;
  children: React.ReactNode;
}) {
  // Kept on screen after `open` goes false until the exit has played. Opening
  // shows it in the same render, so no frame of nothing comes first.
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const closing = present && !open;

  const onCloseRef = useRef(onClose);
  const onExitedRef = useRef(onExited);
  useEffect(() => {
    onCloseRef.current = onClose;
    onExitedRef.current = onExited;
  });

  const finish = () => {
    setPresent(false);
    onExitedRef.current?.();
  };
  // The timer covers a tab hidden mid-slide, where no animationend arrives.
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => {
      setPresent(false);
      onExitedRef.current?.();
    }, 650);
    return () => window.clearTimeout(t);
  }, [closing]);

  const { cardRef, handleProps } = useFlick(() => onCloseRef.current());

  // Escape closes, the page behind is frozen, focus starts on the card (not a
  // control, whose ring would point at the way out first) and goes back to
  // whatever opened it, without scrolling either way.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = cardRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    card?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      // Only while focus is still the sheet's: an action that moved it on
      // (Add row opens the new row's name) keeps it there.
      const at = document.activeElement;
      if (opener?.isConnected && (at === document.body || card?.contains(at)))
        opener.focus({ preventScroll: true });
    };
  }, [open, cardRef]);

  if (!present || typeof document === 'undefined') return null;

  return createPortal(
    // Closing, it stops taking presses: a tap mid-slide reaches the page.
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6',
        closing && 'pointer-events-none'
      )}
    >
      <div
        className={cn('absolute inset-0 bg-black/40', closing ? 'animate-scrim-out' : 'animate-scrim-in')}
        onClick={() => onCloseRef.current()}
      />
      {/* The slide lives on this wrapper and the flick on the card inside, so
          the two never write the same transform. */}
      <div
        className={cn('relative flex w-full flex-col', WIDTH[size], closing ? 'animate-sheet-fall' : 'animate-sheet-rise')}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) finish();
        }}
      >
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className="flex max-h-[calc(88dvh/var(--z))] w-full flex-col overflow-hidden rounded-t-3xl bg-card shadow-2xl outline-none sm:rounded-2xl sm:border"
        >
          {/* The grab handle: the affordance for the flick, phone only. */}
          <div
            {...handleProps}
            className="flex shrink-0 cursor-grab touch-none justify-center pb-1.5 pt-2.5 sm:hidden"
          >
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
          <div className={cn('min-h-0 flex-1 overflow-auto px-4 pb-4 pt-1 sm:pt-4', className)}>{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}
