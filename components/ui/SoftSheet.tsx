'use client';

import { m, useDragControls, type DragControls, type PanInfo } from 'framer-motion';
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
 * `.animate-sheet-rise` / `.animate-sheet-fall` (app/globals.css), never framer-motion:
 * a spring over the page stuttered on every device (25 Sep 2026).
 */

const WIDTH = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  '2xl': 'sm:max-w-2xl',
} as const;

/**
 * The flick-to-close, started from the handle only: the card's body is its own
 * scroller, and a drag that listened everywhere would eat every scroll.
 */
export function useSheetDrag(onDismiss: () => void) {
  const controls = useDragControls();
  return {
    controls,
    dragProps: {
      drag: 'y' as const,
      dragListener: false,
      dragControls: controls,
      dragConstraints: { top: 0, bottom: 0 },
      dragElastic: { top: 0, bottom: 0.4 },
      onDragEnd: (_: unknown, info: PanInfo) => {
        if (info.offset.y > 120 || info.velocity.y > 600) onDismiss();
      },
    },
  };
}

/** The grab handle: the affordance for the flick, phone only. */
export function SheetHandle({ controls }: { controls: DragControls }) {
  return (
    <div
      onPointerDown={(e) => controls.start(e)}
      className="flex shrink-0 cursor-grab touch-none justify-center pb-1.5 pt-2.5 sm:hidden"
    >
      <div className="h-1 w-10 rounded-full bg-border" />
    </div>
  );
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

  // Escape closes, the page behind is frozen, focus starts on the card (not a
  // control, whose ring would point at the way out first).
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cardRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const { controls, dragProps } = useSheetDrag(() => onCloseRef.current());

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
      {/* The slide lives on this wrapper and the drag on the card inside, so
          the two never write the same transform. */}
      <div
        className={cn('relative flex w-full flex-col', WIDTH[size], closing ? 'animate-sheet-fall' : 'animate-sheet-rise')}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) finish();
        }}
      >
        <m.div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          {...dragProps}
          className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-card shadow-2xl outline-none sm:rounded-2xl sm:border"
        >
          <SheetHandle controls={controls} />
          <div className={cn('min-h-0 flex-1 overflow-auto px-4 pb-4 pt-1 sm:pt-4', className)}>{children}</div>
        </m.div>
      </div>
    </div>,
    document.body
  );
}
