'use client';

import { pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import Spinner from '@/components/ui/Spinner';

// Shared confirm dialog with the same motion language as the other modals:
// the app's soft card (`.dialog-soft`, rises 12px and settles on --ease-ios)
// over a plain dark scrim (`.scrim-soft`), and the mirrored exit on close.
//
// NO BLUR (4 Oct 2026). The backdrop was `backdrop-blur-sm` over the whole
// screen, and blurring everything behind it is the most expensive paint a page
// can ask for: traced at 390px with CPU 4x, the first frame of the open took
// 60-90 ms from the EDL builder. Export Excel dropped its blur for the same
// reason; this dialog now opens the same way.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busyLabel,
  busy = false,
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Keep mounted briefly after close so the exit animation can play.
  const [visible, setVisible] = useState(open);
  // Opening shows it in the same render, not one effect later: an effect that
  // set it drew a frame of nothing first (and is what the lint rule flags).
  if (open && !visible) setVisible(true);
  useEffect(() => {
    if (open) return;
    // As long as `.dialog-soft`'s exit (0.24s), so the card finishes leaving.
    const t = window.setTimeout(() => setVisible(false), 240);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!visible) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div
        data-state={open ? 'open' : 'closed'}
        className="scrim-soft absolute inset-0 bg-black/40"
        onClick={() => !busy && onCancel()}
      />
      <div
        data-state={open ? 'open' : 'closed'}
        className="dialog-soft relative w-full max-w-sm rounded-2xl border bg-card p-5 shadow-xl sm:p-6"
      >
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <div className="mt-1 text-sm text-muted-foreground">{message}</div>

        {/* THE ACTION LEADS AND CANCEL FOLLOWS, on one row, the same way the
            project modals read. This dialog had them the other way round, so
            the two places in the app that ask "are you sure?" answered in
            opposite directions and muscle memory from one was wrong in the
            other. The action keeps `flex-1` so it is unmistakably the primary
            even when its label is short. */}
        <div className="mt-6 flex gap-2">
          <m.button {...pressMotion}
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium shadow-sm transition-colors duration-200 ease-ios hover:shadow-md disabled:opacity-60 ${
              destructive
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                : 'btn-primary'
            }`}
          >
            {busy && <Spinner />}
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </m.button>
          <m.button {...pressMotion}
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </m.button>
        </div>
      </div>
    </div>,
    document.body
  );
}
